import { C } from '../common/collections.js';
import { loadOwned } from '../common/owned.js';
import { body as bodyObj, oneOf } from '../common/validate.js';
import { HttpError } from '../http.js';
import { AGENT_SCHEMA, buildAgentInput } from './prompts.js';
import { AGENT, checkAgentOutput, fakeReply, loadState, rulesReply, SCREENS } from './state.js';

// モルティと話す（契約 §3.12・#307）。集中の外で、進め方を相談する窓口。
// 何も保存しない（会話の履歴は画面が持って送る）。入力・出力の本文はログに出さない。
// Gemini が失敗（形の不正・時間切れ・回数の上限）してもルールの返事で 200（502・429 にしない）。
export const AGENT_TIMEOUT_MS = 20_000;

const bad = (m) => new HttpError(400, 'invalid_argument', m);

// 見た目の 1 文字で数える。改行は空白にまとめる。中身はエラー文に出さない。
function text(v, field, max) {
  if (typeof v !== 'string') throw bad(`${field}: string が必要です`);
  const t = v.replace(/[\r\n]+/g, ' ').trim();
  const n = Array.from(t).length;
  if (n < 1 || n > max) throw bad(`${field}: 1〜${max} 文字にしてください`);
  return t;
}

export function parseAgentChat(b) {
  bodyObj(b);
  const screen = oneOf(b.screen, 'screen', SCREENS);
  let goalId;
  if (b.goalId !== undefined && b.goalId !== null) {
    if (typeof b.goalId !== 'string' || b.goalId === '' || b.goalId.length > 200) throw bad('goalId: string が必要です');
    goalId = b.goalId;
  }
  const message = text(b.message, 'message', AGENT.messageMax);
  const h = b.history ?? [];
  if (!Array.isArray(h) || h.length > AGENT.historyMax) throw bad(`history: ${AGENT.historyMax} 件までの配列にしてください`);
  const history = h.map((x, i) => {
    bodyObj(x);
    return {
      from: oneOf(x.from, `history[${i}].from`, ['me', 'agent']),
      text: text(x.text, `history[${i}].text`, AGENT.historyTextMax),
    };
  });
  return { screen, goalId, message, history };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function register(router, ctx) {
  router.add('POST', '/api/agent/chat', async ({ userId, body }) => {
    const req = parseAgentChat(body);
    if (req.goalId) await loadOwned(ctx.store, C.goals, req.goalId, userId); // 無い・他人の物は 404
    const now = ctx.now ? ctx.now() : new Date();
    const state = await loadState(ctx.store, userId, now, req.goalId);

    let out;
    try {
      out = await withTimeout(
        ctx.gemini.generate({
          purpose: 'agent',
          input: buildAgentInput({ state, screen: req.screen, focusGoalId: req.goalId, history: req.history, message: req.message, now }),
          schema: AGENT_SCHEMA,
          userId,
        }),
        ctx.config.agentTimeoutMs ?? AGENT_TIMEOUT_MS,
      );
    } catch (err) {
      console.error('agent chat: fallback to rules', err?.code || (err?.message === 'timeout' ? 'timeout' : 'error'));
      return { status: 200, body: rulesReply(state, req.message) };
    }
    // fake は、ルールの返事に source: ai（デモと試験用）。回数の上限は上の generate で数える。
    if (ctx.config.geminiMode === 'fake') return { status: 200, body: fakeReply(state, req.message) };
    const checked = checkAgentOutput(out, state);
    if (!checked) {
      console.error('agent chat: fallback to rules', 'empty_reply');
      return { status: 200, body: rulesReply(state, req.message) };
    }
    return { status: 200, body: checked };
  });
}
