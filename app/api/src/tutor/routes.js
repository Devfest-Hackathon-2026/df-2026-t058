import { randomUUID } from 'node:crypto';
import { C } from '../common/collections.js';
import { loadOwned } from '../common/owned.js';
import { nowIso } from '../common/time.js';
import { body as bodyObj, oneOf, str } from '../common/validate.js';
import { HttpError } from '../http.js';
import { INTENTS, MAX_REPLY_CHARS, MAX_THOUGHT_CHARS, REPLY_SCHEMA, SAFE_REPLY, buildInput, cleanSources, limitReply, parseHelpLevel } from './prompts.js';
import { parseImages } from '../reflect/routes.js';
import { HELP_EVENT, helpTotalOf } from './state.js';
import { registerOptions } from './options.js';

const MAX_TUTOR_IMAGES = 2;

// I-5: AI との相談（契約の変更点 §1・11/5）。
// ふつうに聞ける（鍵は無い）。AI は課題の答えを言わない。返事ごとに手を貸した度合い（none／small／medium）を
// Gemini の構造化出力で受け、サーバーが検査して events に追記する（点は score/rules.js が events から出す）。

const KINDS = ['ask', 'research'];

// 安全網で返事を置き換えた回数（プロセス内の累計・ログに数だけ出す）。
let replacedCount = 0;

// 同じセッションへの要求を 1 つずつ処理する（メッセージの並び seq を崩さない。1 プロセス内）。
const queues = new Map();
function exclusive(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

// 画面へ返す形。内部の並び・持ち主は出さない。古い形の記録（stage つき・helpLevel なし）も同じ形にそろえる。
// hasThought（#253）は数える用の内部の印なので出さない（契約の TutorMessage に無い）。
const publicMessage = ({ seq, userId, stage, helpLevel, hasThought, ...m }) => {
  void seq;
  void userId;
  void stage;
  void hasThought;
  return { ...m, helpLevel: m.role === 'ai' ? (parseHelpLevel(helpLevel) ?? 'none') : 'none' };
};

async function loadMessages(store, sessionId) {
  const all = await store.list(C.tutorMessages, { sessionId });
  return all.sort((a, b) => a.seq - b.seq);
}

async function loadHelpTotal(store, sessionId) {
  return helpTotalOf(await store.list(C.events, { sessionId }));
}

// 相談の材料（目標・チェックポイント）。無くても相談はできる。
async function loadContext(store, session, userId) {
  const goal = await store.get(C.goals, session.goalId);
  const own = goal && goal.userId === userId ? goal : null;
  const roadmap = own ? await store.get(C.roadmaps, session.goalId) : null;
  const checkpoint = roadmap?.checkpoints?.find((c) => c.id === session.checkpointId) || null;
  return { goal: own, checkpoint };
}

const upstreamInvalid = (why) => {
  console.error('tutor: AI の出力を採用できません:', why);
  return new HttpError(502, 'upstream_invalid', 'AI の出力が期待した形ではありません');
};
const ended = () => new HttpError(409, 'conflict', '終わった集中には相談できません');

export function register(router, ctx) {
  const { store, gemini } = ctx;
  registerOptions(router, ctx); // POST /api/sessions/:id/stuck-options（#253）

  router.add('GET', '/api/sessions/:id/tutor', async ({ params, userId }) => {
    await loadOwned(store, C.sessions, params.id, userId);
    const messages = (await loadMessages(store, params.id)).map(publicMessage);
    return { status: 200, body: { messages, helpTotal: await loadHelpTotal(store, params.id) } };
  });

  router.add('POST', '/api/sessions/:id/tutor', async ({ params, userId, body }) => {
    const first = await loadOwned(store, C.sessions, params.id, userId);
    bodyObj(body);
    // kind は省略できる（省略＝ask・#191）。research は後方互換で受け付ける。
    const kind = body.kind === undefined ? 'ask' : oneOf(body.kind, 'kind', KINDS);
    // intent は省略できる（省略＝free・#193）。stuck・check は ask の場面なので research には付けられない。
    const intent = body.intent === undefined ? 'free' : oneOf(body.intent, 'intent', INTENTS);
    if (kind === 'research' && intent !== 'free') {
      throw new HttpError(400, 'invalid_argument', 'intent: 調べたいこと（research）には free 以外を付けられません');
    }
    const text = str(body.text, 'text', { min: 1, max: 2000 });
    // thought（省略可・#253）: 本人が選んだ「いまの考え」。前後の空白を除き 0〜300 字。空は「無し」と同じ。ask の時だけ。
    const thought = str(body.thought, 'thought', { min: 0, max: MAX_THOUGHT_CHARS, optional: true }) || '';
    if (kind === 'research' && thought) {
      throw new HttpError(400, 'invalid_argument', 'thought: 調べたいこと（research）には付けられません');
    }
    // 写真は 0〜2 枚・ask だけ。検査は振り返りと同じ物。この 1 回の相談にだけ使い、保存しない。
    if (Array.isArray(body.images) && body.images.length > MAX_TUTOR_IMAGES) {
      throw new HttpError(400, 'invalid_argument', `images: ${MAX_TUTOR_IMAGES} 枚までにしてください`);
    }
    const images = parseImages(body.images);
    if (kind === 'research' && images.length > 0) {
      throw new HttpError(400, 'invalid_argument', 'images: 調べたいこと（research）には写真を付けられません');
    }
    if (first.endedAt) throw ended();

    return exclusive(first.id, async () => {
      // 待っている間に終わったかもしれないので読み直す。
      const session = await loadOwned(store, C.sessions, first.id, userId);
      if (session.endedAt) throw ended();

      const history = await loadMessages(store, session.id);
      const { goal, checkpoint } = await loadContext(store, session, userId);
      const input = buildInput({ kind, intent, text, thought, goal, checkpoint, oneLine: session.oneLine, materials: session.materials, images, history });

      // 失敗（429・502）の時は何も保存しない。purpose は窓口の一覧に合わせる（ask は hint）。
      // 検索（grounding）は research と、写真の無い ask に付ける。ask では Gemini が要ると判断した時だけ使う（#191）。
      const grounding = kind === 'research' || images.length === 0;
      const out = await gemini.generate({
        purpose: kind === 'research' ? 'research' : 'hint',
        input,
        schema: REPLY_SCHEMA,
        userId,
        ...(grounding && { grounding: true }),
      });
      let helpLevel = parseHelpLevel(out.helpLevel);
      if (!helpLevel) throw upstreamInvalid('helpLevel が範囲外');
      if (typeof out.answerRevealed !== 'boolean') throw upstreamInvalid('answerRevealed が無い・型が違う');
      let reply = limitReply(out.reply, MAX_REPLY_CHARS[kind]);
      if (reply === null) throw upstreamInvalid('返答が空');
      // 安全網: 答えが出た返事は固定の文に置き換える（502 にはしない）。ログは数だけ（文は出さない）。
      const revealed = out.answerRevealed === true;
      if (revealed) {
        reply = SAFE_REPLY;
        helpLevel = 'small';
        replacedCount += 1;
        console.warn(`tutor: 答えを含む返事を置き換えました（累計 ${replacedCount} 回）`);
      }
      // 出典は検索した時だけ付ける。ask で検索しなかった（空）時は付けない。置き換えた時も付けない。
      const cleaned = grounding && !revealed ? cleanSources(out.sources) : [];
      const sources = kind === 'research' ? cleaned : cleaned.length > 0 ? cleaned : undefined;

      const at = nowIso(ctx);
      let seq = history.reduce((m, x) => Math.max(m, x.seq || 0), 0);
      const base = { sessionId: session.id, userId, kind, at };
      const userMsg = { ...base, seq: ++seq, role: 'user', text, helpLevel: 'none', ...(thought && { hasThought: true }) };
      const aiMsg = { ...base, seq: ++seq, role: 'ai', text: reply, helpLevel, ...(sources && { sources }) };
      const saveMsg = async (m) => store.put(C.tutorMessages, randomUUID(), m);
      const [u, a] = [await saveMsg(userMsg), await saveMsg(aiMsg)];

      // events は追記のみ。本文は残さず、種類だけ meta に置く（P10）。
      const ev = (type, meta) => store.append(C.events, { userId, sessionId: session.id, type, meta });
      if (kind === 'research') await ev('research', {});
      // intent は種類だけ（free は今までと同じ形にするため付けない・#193）。
      // none（問い返しだけ）は数えないので help_* を追記しない（返事のメッセージは上で保存済み・#196）。
      if (helpLevel !== 'none') await ev(HELP_EVENT[helpLevel], { kind, ...(intent !== 'free' && { intent }) });

      return {
        status: 200,
        body: { messages: [publicMessage(u), publicMessage(a)], helpTotal: await loadHelpTotal(store, session.id) },
      };
    });
  });
}
