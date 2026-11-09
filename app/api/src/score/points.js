import { scoredAchievement } from './rules.js';
import { jstDayKey } from './streak.js';

// 考えポイント（純粋関数・正典は docs/points.md）。保存せず、記録から毎回計算する（連続日数と同じ作り・P5）。
// 規則の数はここ 1 か所だけ。**すべて仮**（本人の確認待ち）。
// 守り: 速さは加点しない（P4）・AI に聞いても減らさない（減点の項は作らない）・順位は作らない（P7）。
export const POINT_RULES = Object.freeze({
  focus: Object.freeze({ minutesPerPt: 5, dailyMax: 12 }), // 離れていない時間 5 分ごとに 1・1 日 12 まで
  thought: Object.freeze({ pt: 2, dailyMax: 10 }), // 考えを書いて聞いた 1 回 2・1 日 10 まで
  decide: Object.freeze({ own: 10, editedBase: 4, editedRange: 6, candidate: 3, auto: 0 }), // 目標 1 つにつき 1 回
  done: Object.freeze([0, 5, 10, 15]), // 達成度 0〜3 → pt（集中 1 回につき 1 回）
  streak: Object.freeze({ perDay: 1, max: 7 }), // 連続日数（最大 7）× 1・1 日 1 回
  itemsMax: 50,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const shiftDay = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const nonNeg = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

// 1 回の集中の pt（1 日の上限の前）。離れていない分だけを見る（速さ・開始から終了までの長さは見ない）。
export function pointsForSession({ focusMin } = {}, rules = POINT_RULES) {
  return Math.min(rules.focus.dailyMax, Math.floor(nonNeg(focusMin) / rules.focus.minutesPerPt));
}

// ロードマップを確定した時の pt。'auto'（取り込んだタスク）・不明な値は 0。
export function pointsForRoadmap(adopted, editRatio, rules = POINT_RULES) {
  const d = rules.decide;
  if (adopted === 'own') return d.own;
  if (adopted === 'edited') {
    const r = Number.isFinite(editRatio) ? Math.min(1, Math.max(0, editRatio)) : 0;
    return Math.floor(d.editedBase + d.editedRange * r);
  }
  if (adopted === 'candidate') return d.candidate;
  return d.auto;
}

// 振り返りの確定（達成度 0〜3）の pt。範囲外・null は 0。
export function pointsForAchievement(level, rules = POINT_RULES) {
  return Number.isInteger(level) ? rules.done[level] ?? 0 : 0;
}

// 1 日に考えを書いて聞いた回数 → pt（1 日の上限まで）。
export function pointsForThought(count, rules = POINT_RULES) {
  return Math.min(rules.thought.dailyMax, Math.floor(nonNeg(count)) * rules.thought.pt);
}

// 連続日数 → その日の pt。
export function streakPoints(streak, rules = POINT_RULES) {
  return Math.min(rules.streak.max, Math.floor(nonNeg(streak))) * rules.streak.perDay;
}

const DECIDE_LABEL = { own: 'ロードマップを自分で作った', edited: '案を直してロードマップを決めた', candidate: '案を選んでロードマップを決めた' };

// 1 日の上限を、時刻順に足していって守る。
function capDaily(list, dailyMax) {
  const used = new Map();
  return list.map((x) => {
    const day = jstDayKey(x.at);
    const before = used.get(day) ?? 0;
    const pt = Math.max(0, Math.min(x.pt, dailyMax - before));
    used.set(day, before + pt);
    return { ...x, pt };
  });
}

const byAt = (a, b) => Date.parse(a.at) - Date.parse(b.at);
const validAt = (at) => typeof at === 'string' && Number.isFinite(Date.parse(at));

// 全部の加点（pt 0 も含む・古い順）。sessionId は建物の階に pt を載せる用（外には出さない）。
// results は省略可（{ sessionId, at, achievement, aiAchievement? }[]）。無い時は振り返り済みの sessions から作る。
// 振り返りの pt は、本人の判定と AI の判定の低い方（scoredAchievement・契約 §3.6）。aiAchievement が無ければ本人の値。
// goalId も内部用（目標ごとの内訳 byGoal 用・外には出さない）。focus・done＝その集中の目標、thought＝その相談の集中の目標、
// decide＝ロードマップの目標、streak＝無し。
export function pointItems({ sessions = [], roadmaps = [], tutorMessages = [], results } = {}, rules = POINT_RULES) {
  const ended = sessions.filter((s) => validAt(s?.endedAt)).sort((a, b) => byAt({ at: a.endedAt }, { at: b.endedAt }));
  const goalOfSession = new Map(sessions.filter((s) => s?.id && s.goalId).map((s) => [s.id, s.goalId]));
  const goalOf = (sessionId) => goalOfSession.get(sessionId) ?? null;

  const focus = capDaily(
    ended.map((s) => ({
      at: s.endedAt, kind: 'focus', sessionId: s.id, goalId: s.goalId ?? null,
      pt: pointsForSession(s, rules), label: `集中した ${Math.floor(nonNeg(s.focusMin))} 分`,
    })),
    rules.focus.dailyMax,
  );

  const thought = capDaily(
    tutorMessages
      .filter((m) => m?.role === 'user' && m.hasThought === true && validAt(m.at))
      .map((m) => ({ at: m.at, kind: 'thought', goalId: goalOf(m.sessionId), pt: pointsForThought(1, rules), label: '考えを書いて相談した' }))
      .sort(byAt),
    rules.thought.dailyMax,
  );

  const seenGoal = new Set();
  const decide = [...roadmaps]
    .filter((r) => validAt(r?.createdAt))
    .sort((a, b) => byAt({ at: a.createdAt }, { at: b.createdAt }))
    .filter((r) => (seenGoal.has(r.goalId) ? false : seenGoal.add(r.goalId)))
    .map((r) => ({
      at: r.createdAt, kind: 'decide', goalId: r.goalId ?? null,
      pt: pointsForRoadmap(r.adopted, r.editRatio, rules), label: DECIDE_LABEL[r.adopted] ?? 'タスクを取り込んだ',
    }));

  const res = results ?? sessions
    .filter((s) => s?.reflectedAt)
    .map((s) => ({ sessionId: s.id, at: s.reflectedAt, achievement: s.achievement, aiAchievement: s.aiAchievement ?? null }));
  const seenSession = new Set();
  const done = res
    .filter((r) => validAt(r?.at) && Number.isInteger(r.achievement))
    .filter((r) => (seenSession.has(r.sessionId) ? false : seenSession.add(r.sessionId)))
    .map((r) => {
      const level = scoredAchievement(r.achievement, r.aiAchievement ?? null);
      return {
        at: r.at, kind: 'done', sessionId: r.sessionId, goalId: goalOf(r.sessionId),
        pt: pointsForAchievement(level, rules), label: `チェックポイントを終えた（達成度 ${level}）`,
      };
    });

  // 続けた日: 集中を終えた日ごとに 1 回。その日までの連続日数で pt。時刻はその日の最初の終了。
  const firstOfDay = new Map();
  for (const s of ended) {
    const day = jstDayKey(s.endedAt);
    if (!firstOfDay.has(day)) firstOfDay.set(day, s.endedAt);
  }
  const streak = [...firstOfDay].map(([day, at]) => {
    let n = 0;
    for (let d = day; firstOfDay.has(d); d = shiftDay(d, -1)) n += 1;
    return { at, kind: 'streak', pt: streakPoints(n, rules), label: `${n} 日続けた` };
  });

  return [...focus, ...thought, ...decide, ...done, ...streak].sort(byAt);
}

// 目標ごとの合計（契約 §3.6b の byGoal）。items は pointItems の結果（1 日の上限の後）。
// goals（{ id, text, archivedAt? }[]）にある目標だけ・pt 0 は入れない・連続（goalId 無し）は入れない。
// 並びは最後に pt が増えた時刻の新しい順（多い順にしない＝順位にしない・P7）。
export function pointsByGoal(items, goals = []) {
  const goalById = new Map(goals.filter((g) => g?.id).map((g) => [g.id, g]));
  const sum = new Map();
  for (const x of items) {
    if (!x.goalId || !(x.pt > 0) || !goalById.has(x.goalId)) continue;
    const cur = sum.get(x.goalId) ?? { pt: 0, lastAt: x.at };
    cur.pt += x.pt;
    if (Date.parse(x.at) >= Date.parse(cur.lastAt)) cur.lastAt = x.at;
    sum.set(x.goalId, cur);
  }
  return [...sum]
    .sort(([, a], [, b]) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .map(([goalId, { pt }]) => {
      const g = goalById.get(goalId);
      return { goalId, text: typeof g.text === 'string' ? g.text : '', pt, archived: Boolean(g.archivedAt) };
    });
}

// 集計。total＝全部・today＝今日（日本時間）・week＝今日を含む直近 7 日。items は新しい順・最大 itemsMax・pt 0 は出さない。
// byGoal＝目標ごとの内訳（goals を渡した時だけ中身が入る）。
export function computePoints({ sessions, roadmaps, tutorMessages, results, goals, now = new Date() } = {}, rules = POINT_RULES) {
  const all = pointItems({ sessions, roadmaps, tutorMessages, results }, rules);
  const today = jstDayKey(now);
  const weekFrom = shiftDay(today, -6);
  let total = 0;
  let todayPt = 0;
  let week = 0;
  for (const x of all) {
    const day = jstDayKey(x.at);
    total += x.pt;
    if (day === today) todayPt += x.pt;
    if (day >= weekFrom && day <= today) week += x.pt;
  }
  const items = all
    .filter((x) => x.pt > 0)
    .reverse()
    .slice(0, rules.itemsMax)
    .map(({ at, kind, pt, label }) => ({ at, kind, pt, label }));
  return { total, today: todayPt, week, items, byGoal: pointsByGoal(all, goals) };
}

// 集中 1 回ごとに得た pt（集中＋振り返り）。建物の階に載せる用（契約 §3.6 の Floor.pt）。
export function pointsBySession(items) {
  const m = new Map();
  for (const x of items) if (x.sessionId) m.set(x.sessionId, (m.get(x.sessionId) ?? 0) + x.pt);
  return m;
}
