import { C } from '../common/collections.js';
import { loadCandidates, rulesProposals, TARGET_MINUTES } from '../today/pick.js';

// モルティと話す（契約 §3.12・#307）の材料づくりと、ルールの返事・返事の検査。
// 何も保存しない。本人の文（目標の文・題・会話）はログに出さない。
export const AGENT = {
  messageMax: 300,
  historyMax: 6,
  historyTextMax: 300,
  replyMax: 200,
  actionsMax: 3,
};
export const SCREENS = ['home', 'tower', 'friends', 'settings', 'plan', 'start', 'reflect'];
export const TOPICS = ['plan', 'content', 'app'];
export const ACTION_KINDS = ['start', 'resume', 'reflect', 'plan', 'write', 'import', 'tower', 'friends', 'settings'];
const TO_REFLECT_MAX = 3; // ホームと同じ（home/routes.js）

// ルールの返事の決まった文（ホームの主ボタンと同じ順）
export const RULES_REPLY = Object.freeze({
  resume: '進行中の集中がありますよ。続きから戻りましょう。',
  reflect: '終えた集中の振り返りがまだですね。先に済ませておきましょう。',
  start: '今日の分は、道の次の一歩からどうでしょう。始めるなら下のボタンからどうぞ。',
  plan: '道がまだ決まっていない目標がありますね。案から選んでみましょう。',
  write: 'まずは目標を 1 つ書いてみましょう。そこから道を一緒に考えます。',
  import: '課題は、カレンダーや Classroom から取り込めますよ。取り込みの画面へどうぞ。',
});
// 課題の中身を聞かれた時の返事（答えず集中へ誘導する）
export const CONTENT_REPLY = '中身の話は、集中を始めてから一緒に考えましょう。まずは始めるところからどうぞ。';
// 「答え」「解き方」「教えて」を含む時は中身の相談として扱う（fake の見本だけ。本物は AI の topic に従う）
export const CONTENT_WORDS = /答え|解き方|教えて/;

// 本人の今の状態。進行中・振り返り待ち・今日の候補・道が未決定の目標・目標。
export async function loadState(store, userId, now, focusGoalId) {
  const goals = (await store.list(C.goals, { userId })).filter((g) => g.userId === userId && !g.archivedAt);
  const active = goals.filter((g) => g.status === 'active');
  const roadmaps = new Map();
  for (const g of active) {
    const r = await store.get(C.roadmaps, g.id);
    if (r && r.userId === userId) roadmaps.set(g.id, r);
  }
  const sessions = (await store.list(C.sessions, { userId })).filter((x) => x.userId === userId);
  const running = sessions.find((x) => !x.endedAt) ?? null;
  const toReflect = sessions
    .filter((x) => x.endedAt && !x.reflectedAt)
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
    .slice(0, TO_REFLECT_MAX);
  // 今日の提案と同じ候補（道の次の一歩・期限の近い順）。画面が見ている目標があれば先頭に寄せる。
  let candidates = await loadCandidates(store, userId, now);
  if (focusGoalId) {
    candidates = [...candidates.filter((c) => c.goal.id === focusGoalId), ...candidates.filter((c) => c.goal.id !== focusGoalId)];
  }
  const today = rulesProposals(candidates, TARGET_MINUTES);
  const undecided = active.filter((g) => !roadmaps.has(g.id));
  if (focusGoalId) undecided.sort((a, b) => (b.id === focusGoalId) - (a.id === focusGoalId));
  return { goals, active, roadmaps, running, toReflect, sessions, candidates, today, undecided };
}

const startOf = (p) => ({ kind: 'start', goalId: p.goalId, checkpointId: p.checkpointId });

// ホームの主ボタンと同じ順の 1 件（進行中 → 振り返り待ち → 今日の分 → 道が未決定 → 目標なし）
export function primaryAction(state) {
  if (state.running) return { key: 'resume', action: { kind: 'resume', sessionId: state.running.id } };
  if (state.toReflect.length) return { key: 'reflect', action: { kind: 'reflect', sessionId: state.toReflect[0].id } };
  if (state.today.length) return { key: 'start', action: startOf(state.today[0]) };
  if (state.undecided.length) return { key: 'plan', action: { kind: 'plan', goalId: state.undecided[0].id } };
  return { key: 'write', action: { kind: 'write' } };
}

// 言い方から「目標を足したい」「取り込みたい」が分かる時の action（当たらなければ null）。本文は保存しない。
const WANT_WRITE = /(目標|タスク).*(足し|追加|増や|新しい|書き)|(足し|追加|増や|新しい|書き).*(目標|タスク)/;
const WANT_IMPORT = /取り込|課題を入れ|カレンダー|Classroom/i;
export function intentAction(message) {
  if (typeof message !== 'string' || message === '') return null;
  if (WANT_IMPORT.test(message)) return { key: 'import', action: { kind: 'import' } };
  if (WANT_WRITE.test(message)) return { key: 'write', action: { kind: 'write' } };
  return null;
}

export function rulesReply(state, message) {
  const { key, action } = intentAction(message) ?? primaryAction(state);
  return { reply: RULES_REPLY[key], actions: [action], topic: 'app', source: 'rules' };
}

// 中身の相談の先頭に置く物（進行中なら resume、無ければ今日の最初の start）。どちらも無ければ null。
export function focusAction(state) {
  if (state.running) return { kind: 'resume', sessionId: state.running.id };
  if (state.today.length) return startOf(state.today[0]);
  return null;
}

// GEMINI_MODE=fake の見本: ルールの返事に source: ai。中身の相談らしい時は topic: content の形。
export function fakeReply(state, message) {
  if (CONTENT_WORDS.test(message)) {
    const first = focusAction(state);
    return { reply: CONTENT_REPLY, actions: first ? [first] : [primaryAction(state).action], topic: 'content', source: 'ai' };
  }
  return { ...rulesReply(state, message), source: 'ai' };
}

const clip = (s, n) => Array.from(s).slice(0, n).join('');

// その action が本人の物で、いま押せる物か（ID が無い・他人の・終わった物は落とす）
function validAction(a, state) {
  const s = (v) => (typeof v === 'string' && v !== '' ? v : null);
  switch (a?.kind) {
    case 'start': {
      const goalId = s(a.goalId);
      const checkpointId = s(a.checkpointId);
      const r = goalId && state.roadmaps.get(goalId);
      const cp = r && Array.isArray(r.checkpoints) ? r.checkpoints.find((c) => c && c.id === checkpointId) : null;
      return cp && cp.state !== 'done' ? { kind: 'start', goalId, checkpointId } : null;
    }
    case 'resume': {
      const id = s(a.sessionId);
      return id && state.running?.id === id ? { kind: 'resume', sessionId: id } : null;
    }
    case 'reflect': {
      const id = s(a.sessionId);
      return id && state.sessions.some((x) => x.id === id && x.endedAt && !x.reflectedAt) ? { kind: 'reflect', sessionId: id } : null;
    }
    case 'plan': {
      const id = s(a.goalId);
      return id && state.active.some((g) => g.id === id) ? { kind: 'plan', goalId: id } : null;
    }
    case 'write':
    case 'import':
    case 'tower':
    case 'friends':
    case 'settings':
      return { kind: a.kind };
    default:
      return null;
  }
}

// AI の返事（schema 合格済み）を検査する。reply が空なら null（呼ぶ側がルールに落とす）。
// actions: 本人の物で存在する物だけ・重複なし・3 件まで。content の時は先頭を start（進行中なら resume）にする。
export function checkAgentOutput(out, state) {
  const reply = clip(String(out.reply).replace(/[\r\n\t]+/g, ' ').trim(), AGENT.replyMax).trim();
  if (reply === '') return null;
  const topic = TOPICS.includes(out.topic) ? out.topic : 'app';
  let actions = (Array.isArray(out.actions) ? out.actions : []).map((a) => validAction(a, state)).filter(Boolean);
  if (topic === 'content') {
    const first = focusAction(state);
    if (first) actions = [first, ...actions];
  }
  const seen = new Set();
  actions = actions.filter((a) => {
    const k = JSON.stringify(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { reply, actions: actions.slice(0, AGENT.actionsMax), topic, source: 'ai' };
}
