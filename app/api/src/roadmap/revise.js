import { randomUUID } from 'node:crypto';
import { C } from '../common/collections.js';
import { loadOwned } from '../common/owned.js';
import { body, num, oneOf } from '../common/validate.js';
import { HttpError } from '../http.js';
import { withLock as withSessionLock } from '../session/lock.js';
import { mascotName, TONE_RULE } from '../tutor/prompts.js';
import { DONE_MARK_MAX, ESTIMATE_MIN, OWN_CHECKPOINTS, TITLE_MAX } from './limits.js';
import { withLock } from './lock.js';
import { paceFor } from './pace.js';
import { buildReviseInput, REVISE } from './prompts.js';
import { REVISE_SCHEMA } from './schemas.js';

// ロードマップの見直し（契約 §3.3・#358）。確定した道の「残り」だけを直す。
//  - POST /roadmap/revise: 下書きを Gemini と作る（保存しない・確定しない）
//  - PUT /roadmap/remaining: 本人が決めた残りで置き換える（点は増えない）
// 入力・出力の本文はログに出さない。
export const REVISE_IN = { messageMax: 300, draftMax: 8, historyMax: 6, historyTextMax: 300, remainingMax: 8 };
const DEFAULT_ESTIMATE = 30;

const bad = (m) => new HttpError(400, 'invalid_argument', m);
const notFound = (m) => new HttpError(404, 'not_found', m);
const reject = (why) => {
  console.error('roadmap revise rejected:', why); // 理由だけ（本文は出さない）
  return new HttpError(502, 'upstream_invalid', 'AI の出力が期待した形ではありません');
};

// 文字数は見た目の 1 文字で数える。改行は 1 行にまとめる
function text(v, field, { min, max }) {
  if (typeof v !== 'string') throw bad(`${field}: string が必要です`);
  const t = v.replace(/[\r\n]+/g, ' ').trim();
  const n = Array.from(t).length;
  if (n < min || n > max) throw bad(`${field}: ${min}〜${max} 文字にしてください`);
  return t;
}

function list(v, field, max, min = 0) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length < min || v.length > max) throw bad(`${field}: ${min}〜${max} 件の配列にしてください`);
  return v;
}

const estimate = (v, field) => (v == null ? undefined : num(v, field, { ...ESTIMATE_MIN, int: true }));

export function parseRevise(b) {
  if (b === undefined || b === null) b = {};
  body(b);
  const message = b.message == null ? '' : text(b.message, 'message', { min: 1, max: REVISE_IN.messageMax });
  const draft = list(b.draft, 'draft', REVISE_IN.draftMax)?.map((p, i) => {
    body(p);
    const m = estimate(p.estimateMin, `draft[${i}].estimateMin`);
    return {
      title: text(p.title ?? '', `draft[${i}].title`, { min: 0, max: TITLE_MAX }),
      doneMark: text(p.doneMark ?? '', `draft[${i}].doneMark`, { min: 0, max: DONE_MARK_MAX }),
      ...(m !== undefined && { estimateMin: m }),
    };
  });
  const history = (list(b.history, 'history', REVISE_IN.historyMax) ?? []).map((h, i) => {
    body(h);
    return {
      from: oneOf(h.from, `history[${i}].from`, ['me', 'agent']),
      text: text(h.text, `history[${i}].text`, { min: 1, max: REVISE_IN.historyTextMax }),
    };
  });
  return { message, draft, history };
}

export function parseRemaining(b) {
  body(b);
  const raw = list(b.checkpoints, 'checkpoints', REVISE_IN.remainingMax, 1);
  if (!raw) throw bad(`checkpoints: 1〜${REVISE_IN.remainingMax} 件の配列が必要です`);
  return raw.map((p, i) => {
    body(p);
    return {
      title: text(p.title, `checkpoints[${i}].title`, { min: 1, max: TITLE_MAX }),
      doneMark: text(p.doneMark, `checkpoints[${i}].doneMark`, { min: 1, max: DONE_MARK_MAX }),
      estimateMin: estimate(p.estimateMin, `checkpoints[${i}].estimateMin`) ?? DEFAULT_ESTIMATE,
    };
  });
}

function out(v, max, where) {
  if (typeof v !== 'string') throw reject(`${where}: string ではありません`);
  const t = v.trim();
  if (t.length < 1 || Array.from(t).length > max) throw reject(`${where}: 1〜${max} 文字ではありません`);
  return t;
}

// 出力を個数・範囲・文字数まで検査する。外れたら 502。
export function checkReviseOutput(o) {
  const d = o?.draft;
  if (!Array.isArray(d) || d.length < REVISE.outMin || d.length > REVISE.outMax) throw reject(`draft の数: ${d?.length}`);
  return {
    reply: out(o.reply, REVISE.replyMax, 'reply'),
    draft: d.map((p, i) => {
      const m = p?.estimateMin;
      if (!Number.isInteger(m) || m < REVISE.minutes.min || m > REVISE.minutes.max) throw reject(`draft[${i}].estimateMin: ${m}`);
      return { title: out(p.title, TITLE_MAX, `draft[${i}].title`), doneMark: out(p.doneMark, DONE_MARK_MAX, `draft[${i}].doneMark`), estimateMin: m };
    }),
  };
}

const clampMin = (m) => Math.min(REVISE.minutes.max, Math.max(REVISE.minutes.min, Number.isFinite(m) ? Math.round(m) : DEFAULT_ESTIMATE));

// GEMINI_MODE=fake の見本: behind は最後の 1 個を外す・ahead は「仕上げ」を 1 個足す・ok はそのまま
export function fakeRoadmapRevise(input) {
  let draft = (input?.draft ?? [])
    .filter((c) => c.title && c.doneMark)
    .map((c) => ({ title: c.title, doneMark: c.doneMark, estimateMin: clampMin(c.estimateMin) }));
  if (draft.length === 0) draft = [{ title: '（見本）残りのステップ', doneMark: '（見本）残りのステップができた', estimateMin: DEFAULT_ESTIMATE }];
  draft = draft.slice(0, REVISE.outMax);
  if (input?.pace === 'behind' && draft.length > REVISE.outMin) {
    return { reply: '（見本の返事）残りの最後の 1 つを、今回は外す形にしてみました。', draft: draft.slice(0, -1) };
  }
  if (input?.pace === 'ahead') {
    const base = draft.slice(0, REVISE.outMax - 1);
    return {
      reply: '（見本の返事）最後に仕上げを 1 つ足してみました。',
      draft: [...base, { title: '（見本）仕上げ', doneMark: '（見本）仕上げができた', estimateMin: DEFAULT_ESTIMATE }],
    };
  }
  return { reply: '（見本の返事）今の残りのままにしてあります。', draft };
}

const pick = ({ title, doneMark, estimateMin }) => ({ title, doneMark, ...(estimateMin !== undefined && { estimateMin }) });

export function register(router, ctx) {
  const { store } = ctx;
  const nowOf = () => (ctx.now ? ctx.now() : new Date());

  router.add('POST', '/api/goals/:id/roadmap/revise', async ({ userId, params, body: b }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    const req = parseRevise(b);
    return withLock(`goal:${goal.id}`, async () => {
      const roadmap = await store.get(C.roadmaps, goal.id);
      if (!roadmap) throw notFound('ロードマップがまだありません');
      const now = nowOf();
      const pace = paceFor({ goal, roadmap, now });
      const cps = roadmap.checkpoints ?? [];
      const done = cps.filter((c) => c.state === 'done').map(pick);
      const draft = req.draft && req.draft.length ? req.draft : cps.filter((c) => c.state !== 'done').map(pick);
      const name = mascotName();
      const output = await ctx.gemini.generate({
        purpose: 'roadmap',
        input: buildReviseInput({ goal, now, pace, done, draft, history: req.history, message: req.message, name, toneRule: TONE_RULE }),
        schema: REVISE_SCHEMA,
        userId,
      });
      return { status: 200, body: { ...checkReviseOutput(output), pace } };
    });
  });

  router.add('PUT', '/api/goals/:id/roadmap/remaining', async ({ userId, params, body: b }) => {
    const goal = await loadOwned(store, C.goals, params.id, userId);
    const sent = parseRemaining(b);
    return withLock(`goal:${goal.id}`, () =>
      // 集中の開始（session/routes.js・ユーザーの鍵）と割り込まないよう、同じ鍵も取る
      withSessionLock(userId, async () => {
        const roadmap = await store.get(C.roadmaps, goal.id);
        if (!roadmap) throw notFound('ロードマップがまだありません');
        const cps = [...(roadmap.checkpoints ?? [])].sort((a, b2) => (a.order ?? 0) - (b2.order ?? 0));
        const done = cps.filter((c) => c.state === 'done');
        const total = done.length + sent.length;
        if (total < OWN_CHECKPOINTS.min || total > OWN_CHECKPOINTS.max) {
          throw bad(`checkpoints: 終わった物と合わせて ${OWN_CHECKPOINTS.min}〜${OWN_CHECKPOINTS.max} 個にしてください`);
        }
        const removed = new Set(cps.filter((c) => c.state !== 'done').map((c) => c.id));
        const sessions = await store.list(C.sessions, { userId });
        if (sessions.some((s) => !s.endedAt && s.goalId === goal.id && removed.has(s.checkpointId))) {
          throw new HttpError(409, 'conflict', '進行中の集中があるチェックポイントは消せません。先に終えてください');
        }
        const fresh = sent.map((p) => ({ id: randomUUID(), title: p.title, doneMark: p.doneMark, estimateMin: p.estimateMin, state: 'todo', achievement: null }));
        // adopted・editRatio・why・createdAt はそのまま（見直しで点は増えない）
        const saved = await store.put(C.roadmaps, goal.id, {
          ...roadmap,
          checkpoints: [...done, ...fresh].map((c, i) => ({ ...c, order: i + 1 })),
        });
        return { status: 200, body: saved };
      }),
    );
  });
}
