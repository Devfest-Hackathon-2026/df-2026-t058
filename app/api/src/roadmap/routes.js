import { randomUUID } from 'node:crypto';
import { C } from '../common/collections.js';
import { loadOwned } from '../common/owned.js';
import { nowIso } from '../common/time.js';
import { body, isoDate, num, oneOf, str } from '../common/validate.js';
import { HttpError } from '../http.js';
import { publicAxes } from './axes.js';
import { toCandidates } from './candidates.js';
import { register as registerChat } from './chat.js';
import { editRatio } from './edit-ratio.js';
import { fillEstimates } from './estimate.js';
import {
  DONE_MARK_MAX,
  ESTIMATE_MIN,
  GOAL_TEXT_MAX,
  IMPORT_ITEMS,
  IMPORT_MINUTES,
  IMPORT_NOTES_MAX,
  IMPORT_TITLE_MAX,
  MAX_GOALS_PER_USER,
  MINUTES_PER_DAY,
  NOTE_MAX,
  OWN_CHECKPOINTS,
  TASK_DEFAULT_MIN,
  TASK_DONE_MARK,
  TITLE_MAX,
  WHY_MAX,
} from './limits.js';
import { DOC_FROM, GOAL_DOC_TEXT_MAX, GOAL_DOC_TITLE_MAX, GOAL_DOCS_MAX, newDoc } from './goalDocs.js';
import { withLock } from './lock.js';
import { paceFor } from './pace.js';
import { buildInput } from './prompts.js';
import { register as registerRevise } from './revise.js';
import { roadmapResponseSchema } from './schemas.js';
import { streamCandidates } from './stream.js';

// I-3 ロードマップ（契約 §3.3）。
// P1: 目標は本人の言葉のまま。AI は候補を出すだけで、確定は POST /roadmap（理由つき）だけ。
const bad = (m) => new HttpError(400, 'invalid_argument', m);
const conflict = (m) => new HttpError(409, 'conflict', m);

// 本人が送るチェックポイント（自作・直した後）を検査する。order は 1 始まりでサーバーが付ける。
function parseCheckpoints(raw) {
  if (!Array.isArray(raw)) throw bad('checkpoints: 配列が必要です');
  if (raw.length < OWN_CHECKPOINTS.min || raw.length > OWN_CHECKPOINTS.max) {
    throw bad(`checkpoints: ${OWN_CHECKPOINTS.min}〜${OWN_CHECKPOINTS.max} 個にしてください`);
  }
  return raw.map((p, i) => {
    const w = `checkpoints[${i}]`;
    body(p);
    return {
      title: str(p.title, `${w}.title`, { max: TITLE_MAX }),
      doneMark: str(p.doneMark, `${w}.doneMark`, { max: DONE_MARK_MAX }),
      // 省略可（#268）。無い行はサーバーが見積もる（estimate.js）。
      ...(p.estimateMin !== undefined && {
        estimateMin: num(p.estimateMin, `${w}.estimateMin`, { ...ESTIMATE_MIN, int: true }),
      }),
    };
  });
}

// 案への本人の希望（#223）。本文なし・note 省略・null・空白だけは「無い」（''）。
// 中身はエラー文にもログにも出さない。改行は 1 行にまとめる（全角の空白は残す）。
function readNote(b) {
  if (b === undefined || b === null) return '';
  body(b);
  if (b.note === undefined || b.note === null) return '';
  if (typeof b.note !== 'string') throw bad('note: string が必要です');
  const t = b.note.replace(/[\r\n]+/g, ' ').trim();
  if (Array.from(t).length > NOTE_MAX) throw bad(`note: ${NOTE_MAX} 文字までにしてください`);
  return t;
}

// 取り込んだ課題（#261）を検査する。期限・見積り・メモは無くてもよい（null・省略）。
function parseImportItems(b) {
  body(b);
  const raw = b.items;
  if (!Array.isArray(raw) || raw.length < IMPORT_ITEMS.min || raw.length > IMPORT_ITEMS.max) {
    throw bad(`items: ${IMPORT_ITEMS.min}〜${IMPORT_ITEMS.max} 件の配列が必要です`);
  }
  return raw.map((p, i) => {
    const w = `items[${i}]`;
    body(p);
    const notes = p.notes == null ? '' : str(p.notes, `${w}.notes`, { min: 0, max: IMPORT_NOTES_MAX });
    return {
      title: str(p.title, `${w}.title`, { max: IMPORT_TITLE_MAX }),
      deadline: p.deadline === null ? null : isoDate(p.deadline, `${w}.deadline`),
      minutes: p.minutes == null ? null : num(p.minutes, `${w}.minutes`, IMPORT_MINUTES),
      notes,
    };
  });
}

const toRoadmapCheckpoints = (cps) =>
  cps.map((p, i) => ({
    id: randomUUID(), // 案の ID とは別（採用後の別の物）
    order: i + 1,
    title: p.title,
    doneMark: p.doneMark,
    estimateMin: p.estimateMin,
    state: 'todo',
    achievement: null,
  }));

export function register(router, ctx) {
  const { store } = ctx;

  // 目標を作る。AI は呼ばない（P1）。
  router.add('POST', '/api/goals', async ({ userId, body: b }) => {
    body(b);
    const input = {
      text: str(b.text, 'text', { max: GOAL_TEXT_MAX }),
      deadline: isoDate(b.deadline, 'deadline'),
      // 省略・null は「おまかせ」（null で保存。案を出す時に AI が 1 日の時間を決める）
      minutesPerDay: b.minutesPerDay == null ? null : num(b.minutesPerDay, 'minutesPerDay', MINUTES_PER_DAY),
    };
    const materials = str(b.materials, 'materials', { min: 0, max: 2000, optional: true });
    if (materials !== undefined) input.materials = materials;
    return withLock(`goals:${userId}`, async () => {
      const mine = await store.list(C.goals, { userId });
      if (mine.length >= MAX_GOALS_PER_USER) {
        throw conflict(`目標は ${MAX_GOALS_PER_USER} 件までです`);
      }
      const id = randomUUID();
      const goal = await store.put(C.goals, id, { userId, ...input, status: 'active', createdAt: nowIso(ctx) });
      return { status: 201, body: goal };
    });
  });

  // 取り込んだ課題を「タスク」にする（#261）。目標の文も理由も要らない。AI は呼ばない。
  // 各件に、チェックポイント 1 つの既定のロードマップ（adopted: 'auto'）を付け、すぐ今日の提案・集中に使えるようにする。
  router.add('POST', '/api/goals/import', async ({ userId, body: b }) => {
    const items = parseImportItems(b);
    return withLock(`goals:${userId}`, async () => {
      const mine = await store.list(C.goals, { userId });
      if (mine.length + items.length > MAX_GOALS_PER_USER) {
        throw conflict(`目標とタスクは合わせて ${MAX_GOALS_PER_USER} 件までです`);
      }
      const goals = [];
      for (const it of items) {
        const id = randomUUID();
        const createdAt = nowIso(ctx);
        const goal = await store.put(C.goals, id, {
          userId,
          kind: 'task',
          text: it.title,
          deadline: it.deadline,
          minutesPerDay: null,
          ...(it.notes && { materials: it.notes }),
          status: 'active',
          createdAt,
        });
        await store.put(C.roadmaps, id, {
          goalId: id,
          userId,
          adopted: 'auto',
          why: '',
          checkpoints: toRoadmapCheckpoints([
            { title: it.title, doneMark: TASK_DONE_MARK, estimateMin: it.minutes ?? TASK_DEFAULT_MIN },
          ]),
          createdAt,
        });
        goals.push(goal);
      }
      return { status: 201, body: { goals } };
    });
  });

  router.add('GET', '/api/goals', async ({ userId }) => {
    const goals = (await store.list(C.goals, { userId })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { status: 200, body: { goals } };
  });

  router.add('GET', '/api/goals/:id', async ({ userId, params }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    const roadmap = await store.get(C.roadmaps, goal.id);
    const set = await store.get(C.candidateSets, goal.id);
    // 進み具合（#358・後方互換の追加）。決まった規則だけで出す（AI は呼ばない）
    const pace = paceFor({ goal, roadmap, now: ctx.now ? ctx.now() : new Date() });
    return {
      status: 200,
      body: { goal, roadmap: roadmap ?? null, candidates: set ? set.candidates : [], axes: publicAxes(), pace },
    };
  });

  // 目標を直す（題・期限・1 日の時間）。AI は呼ばない（P1）。確定済みの道・階は変えない（題だけの変更）。
  router.add('PUT', '/api/goals/:id', async ({ userId, params, body: b }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    body(b);
    const patch = {};
    if (b.text !== undefined) patch.text = str(b.text, 'text', { max: GOAL_TEXT_MAX });
    if (b.deadline !== undefined) patch.deadline = isoDate(b.deadline, 'deadline');
    if (b.minutesPerDay !== undefined) {
      patch.minutesPerDay = b.minutesPerDay === null ? null : num(b.minutesPerDay, 'minutesPerDay', MINUTES_PER_DAY);
    }
    if (Object.keys(patch).length === 0) throw bad('text・deadline・minutesPerDay のどれかが必要です');
    return withLock(`goal:${goal.id}`, async () => {
      const cur = await loadOwned(store, C.goals, goal.id, userId);
      const saved = await store.put(C.goals, goal.id, { ...cur, ...patch });
      return { status: 200, body: saved };
    });
  });

  // やめる（アーカイブ）・戻す。記録・道・階は消さない。ホームと今日の提案からだけ外れる。
  const setArchived = (archived) => async ({ userId, params }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    return withLock(`goal:${goal.id}`, async () => {
      const { archivedAt, ...cur } = await loadOwned(store, C.goals, goal.id, userId);
      const next = archived ? { ...cur, archivedAt: archivedAt ?? nowIso(ctx) } : cur;
      return { status: 200, body: await store.put(C.goals, goal.id, next) };
    });
  };
  // 目標の資料（契約 §3.3 GoalDoc・11/9）。文字だけ・10 件まで・AI は呼ばない。やめた目標・確定後にも足せる
  router.add('POST', '/api/goals/:id/docs', async ({ userId, params, body: b }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    body(b);
    const text = str(b.text, 'text', { max: GOAL_DOC_TEXT_MAX });
    const title = str(b.title, 'title', { max: GOAL_DOC_TITLE_MAX, optional: true });
    const from = oneOf(b.from, 'from', DOC_FROM);
    return withLock(`goal:${goal.id}`, async () => {
      const cur = await loadOwned(store, C.goals, goal.id, userId);
      const docs = cur.docs ?? [];
      if (docs.length >= GOAL_DOCS_MAX) throw conflict(`資料は ${GOAL_DOCS_MAX} 件までです`);
      const doc = newDoc({ text, title, from }, nowIso(ctx));
      await store.put(C.goals, goal.id, { ...cur, docs: [...docs, doc] });
      return { status: 201, body: doc };
    });
  });
  router.add('PUT', '/api/goals/:id/docs/:docId', async ({ userId, params, body: b }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    body(b);
    const patch = {};
    if (b.text !== undefined) patch.text = str(b.text, 'text', { max: GOAL_DOC_TEXT_MAX });
    if (b.title !== undefined) patch.title = str(b.title, 'title', { max: GOAL_DOC_TITLE_MAX });
    if (Object.keys(patch).length === 0) throw bad('text・title のどれかが必要です');
    return withLock(`goal:${goal.id}`, async () => {
      const cur = await loadOwned(store, C.goals, goal.id, userId);
      const docs = cur.docs ?? [];
      const i = docs.findIndex((d) => d.id === params.docId);
      if (i < 0) throw new HttpError(404, 'not_found', '資料が見つかりません');
      const doc = { ...docs[i], ...patch, updatedAt: nowIso(ctx) };
      await store.put(C.goals, goal.id, { ...cur, docs: docs.map((d, j) => (j === i ? doc : d)) });
      return { status: 200, body: doc };
    });
  });
  router.add('DELETE', '/api/goals/:id/docs/:docId', async ({ userId, params }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    return withLock(`goal:${goal.id}`, async () => {
      const cur = await loadOwned(store, C.goals, goal.id, userId);
      const docs = cur.docs ?? [];
      if (docs.some((d) => d.id === params.docId)) {
        await store.put(C.goals, goal.id, { ...cur, docs: docs.filter((d) => d.id !== params.docId) });
      }
      return { status: 204 };
    });
  });

  router.add('POST', '/api/goals/:id/archive', setArchived(true));
  router.add('POST', '/api/goals/:id/restore', setArchived(false));

  // AI の案を最大 3 つ。呼び直すと置き換え。note（本人の希望・省略可）は案の参考にだけ使い、保存もログもしない（#223）。
  router.add('POST', '/api/goals/:id/candidates', async ({ userId, params, body: b }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    const note = readNote(b);
    return withLock(`goal:${goal.id}`, async () => {
      // 確定後は案を作り直しても使い道が無い（確定は 1 回だけ）。予算も守る。
      if (await store.get(C.roadmaps, goal.id)) throw conflict('ロードマップはもう確定しています');
      const now = ctx.now ? ctx.now() : new Date();
      const output = await ctx.gemini.generate({
        purpose: 'roadmap',
        input: buildInput({ goal, now, note }),
        schema: roadmapResponseSchema(),
        userId,
      });
      const candidates = toCandidates(output);
      await store.put(C.candidateSets, goal.id, {
        goalId: goal.id,
        userId,
        axes: publicAxes(),
        candidates,
        createdAt: nowIso(ctx),
      });
      return { status: 200, body: { axes: publicAxes(), candidates } };
    });
  });

  // 同じ案づくりを、できた順に 1 つずつ流す（SSE・#235）。開く前の失敗（400・404・409）は普通の JSON で返す。
  router.add('POST', '/api/goals/:id/candidates/stream', async ({ userId, params, body: b, res }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    const note = readNote(b);
    return withLock(`goal:${goal.id}`, async () => {
      if (await store.get(C.roadmaps, goal.id)) throw conflict('ロードマップはもう確定しています');
      await streamCandidates({ res, ctx, goal, userId, note });
      return { streamed: true };
    });
  });

  // ロードマップを確定する（採る／直す／自作）。理由（why）は必須（P1）。
  router.add('POST', '/api/goals/:id/roadmap', async ({ userId, params, body: b }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    body(b);
    const source = oneOf(b.source, 'source', ['candidate', 'edited', 'own']);
    // 理由はタスク（kind: 'task'・#261）だけ省ける。目標（kind 無し＝goal）は今までどおり必須。
    const why =
      goal.kind === 'task' && (b.why === undefined || b.why === null)
        ? ''
        : str(b.why, 'why', { min: goal.kind === 'task' ? 0 : 1, max: WHY_MAX });
    let candidateId;
    if (source !== 'own') candidateId = str(b.candidateId, 'candidateId', { max: 100 });
    const sent = source === 'candidate' ? undefined : parseCheckpoints(b.checkpoints);

    return withLock(`goal:${goal.id}`, async () => {
      if (await store.get(C.roadmaps, goal.id)) throw conflict('ロードマップはもう確定しています');

      let checkpoints;
      let ratio;
      if (source === 'own') {
        checkpoints = sent;
      } else {
        const set = await store.get(C.candidateSets, goal.id);
        const base = set?.candidates.find((c) => c.id === candidateId);
        if (!base) throw new HttpError(404, 'not_found', '選んだ案が見つかりません');
        if (source === 'candidate') {
          checkpoints = base.checkpoints; // そのまま採用（送られた checkpoints は見ない）
        } else {
          checkpoints = sent;
          ratio = editRatio(base.checkpoints, sent);
        }
      }
      // 直した・自作で分の無い行は、Gemini がまとめて見積もる（失敗は既定の 30 分・確定は止めない）
      if (source !== 'candidate') {
        checkpoints = await fillEstimates({ gemini: ctx.gemini, goal, checkpoints, userId });
      }

      const roadmap = await store.put(C.roadmaps, goal.id, {
        goalId: goal.id,
        userId,
        adopted: source,
        ...(ratio !== undefined && { editRatio: ratio }),
        why,
        checkpoints: toRoadmapCheckpoints(checkpoints),
        createdAt: nowIso(ctx),
      });
      return { status: 201, body: roadmap };
    });
  });

  // エージェントと話して道の下書きを作る・直す（#262・確定はしない・保存しない）
  registerChat(router, ctx);
  // 確定した道の残りを、進み具合に合わせて直す（#358・下書き＝revise／置き換え＝remaining）
  registerRevise(router, ctx);
}
