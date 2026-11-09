import { C } from '../common/collections.js';

// 今日の提案（POST /api/today・#183）の候補づくりと、提案の選び方（ルール・AI の返事の検査）。
// 候補は「各目標の道の次の未完了のチェックポイント」だけ（道に無い物は足さない）。
export const MINUTES_CHOICES = [15, 30, 60, 120];
// minutes を省略した時（#265）の今日の合計の目安（分）。利用者に時間を先に決めさせない。
export const TARGET_MINUTES = 60;
export const MAX_PROPOSALS = 3;
export const MAX_REASON_CHARS = 80;
export const MAX_GREETING_CHARS = 80;
export const DEFAULT_ESTIMATE_MIN = 30; // チェックポイントに見積りが無い時（仮）
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_MS = 9 * 60 * 60 * 1000;

export const EMPTY_GREETING = '目標を足すと、今日の提案が出ます';
export const RULES_GREETING = '期限の近い順に、今日の時間に収まる分を並べました。';

const clip = (s, n) => Array.from(s).slice(0, n).join('');
// 改行・タブだけを空白にする（全角の空白は残す）。
export const oneLine = (s, n) => clip(String(s).replace(/[\r\n\t]+/g, ' ').trim(), n).trim();

// 期限までの日数（日本時間の暦日）。読めない期限は null。
export function daysLeft(deadline, now) {
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return null;
  const day = (ms) => Math.floor((ms + JST_MS) / DAY_MS);
  // 「YYYY-MM-DD」だけの期限は UTC の 0 時として読まれる＝日本時間でも同じ日。
  return day(t) - day(now.getTime());
}

function nextCheckpoint(roadmap) {
  const cps = Array.isArray(roadmap?.checkpoints) ? [...roadmap.checkpoints] : [];
  cps.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return cps.find((c) => c && c.state !== 'done') ?? null;
}

// 本人の終わっていない目標ごとの次の一歩。期限の近い順（同じなら作った順）。
export async function loadCandidates(store, userId, now) {
  // やめた目標（archivedAt あり・#231）は候補にしない。
  const goals = (await store.list(C.goals, { userId })).filter(
    (g) => g.userId === userId && g.status === 'active' && !g.archivedAt,
  );
  const out = [];
  for (const goal of goals) {
    const roadmap = await store.get(C.roadmaps, goal.id);
    if (!roadmap || roadmap.userId !== userId) continue;
    const cp = nextCheckpoint(roadmap);
    if (!cp) continue;
    const est = Number(cp.estimateMin);
    out.push({
      goal,
      checkpoint: cp,
      minutes: Number.isFinite(est) && est > 0 ? est : DEFAULT_ESTIMATE_MIN,
      days: daysLeft(goal.deadline, now),
    });
  }
  const key = (c) => (c.days === null ? Infinity : c.days);
  return out.sort((a, b) => key(a) - key(b) || String(a.goal.createdAt).localeCompare(String(b.goal.createdAt)));
}

export function ruleReason(days) {
  if (days === null) return '道の次の一歩です';
  if (days < 0) return '期限を過ぎています';
  if (days === 0) return '期限は今日です';
  return `期限まであと ${days} 日`;
}

const toProposal = (c, reason) => ({
  goalId: c.goal.id,
  checkpointId: c.checkpoint.id,
  title: c.checkpoint.title,
  minutes: c.minutes,
  reason,
});

// 並び順どおりに、3 件まで・合計が minutes 以内で足す（1 件目は超えてもよい＝最低 1 件）。収まらない物は飛ばす。
function fill(items, minutes) {
  const out = [];
  let total = 0;
  for (const { cand, reason } of items) {
    if (out.length >= MAX_PROPOSALS) break;
    if (out.length > 0 && total + cand.minutes > minutes) continue;
    out.push(toProposal(cand, reason));
    total += cand.minutes;
  }
  return out;
}

// 今日の時間の量（#265）。省略（キーが無い）なら目安の 60 分、それ以外は 15|30|60|120 だけ。読めなければ null（呼ぶ側が 400）。
export function readMinutes(v) {
  if (v === undefined) return { minutes: TARGET_MINUTES, given: false };
  return MINUTES_CHOICES.includes(v) ? { minutes: v, given: true } : null;
}

export function result({ greeting, minutes, proposals, source }) {
  return {
    greeting,
    minutes,
    proposals,
    totalMinutes: proposals.reduce((s, p) => s + p.minutes, 0),
    source,
  };
}

// 本人の今日の希望（POST /api/today の note・#222）。200 字まで。ログに出さない・保存しない。
export const MAX_NOTE_CHARS = 200;

// 希望の言葉を区切る（空白・全角の空白・句読点など）。2 文字以上の語だけ使う。
function noteWords(note) {
  return note
    .split(/[\s　、。，．,.!！?？・「」『』（）()]+/)
    .filter((w) => Array.from(w).length >= 2);
}

// 希望と候補が部分一致するか（希望の語が候補の名前に入る・候補の名前が希望に入る）。候補の名前＝チェックポイント名と目標の文。
export function matchesNote(cand, note) {
  if (!note) return false;
  const names = [String(cand.checkpoint?.title ?? ''), String(cand.goal?.text ?? '')].filter((s) => Array.from(s).length >= 2);
  const words = noteWords(note);
  return names.some((n) => note.includes(n) || words.some((w) => n.includes(w)));
}

// 希望に合う候補を先頭に寄せる（中の順は保つ）。希望が無ければそのまま。
export function preferByNote(candidates, note) {
  if (!note) return candidates;
  const hit = candidates.filter((c) => matchesNote(c, note));
  return [...hit, ...candidates.filter((c) => !hit.includes(c))];
}

// ルールの提案（期限の近い順）。candidates は loadCandidates の並び。
export function rulesProposals(candidates, minutes) {
  return fill(
    candidates.map((cand) => ({ cand, reason: ruleReason(cand.days) })),
    minutes,
  );
}

// AI の返事（schema 合格済み）を検査して提案にする。使える物が 1 件も無ければ null（呼ぶ側がルールに落とす）。
// 番号は 1 から。候補に無い番号・重複・理由が空の物は無視する。
export function aiProposals(out, candidates, minutes) {
  const seen = new Set();
  const items = [];
  for (const p of out.picks) {
    const i = p.index;
    if (!Number.isInteger(i) || i < 1 || i > candidates.length || seen.has(i)) continue;
    const reason = oneLine(p.reason, MAX_REASON_CHARS);
    if (reason === '') continue;
    seen.add(i);
    const cand = candidates[i - 1];
    if (cand) items.push({ cand, reason });
  }
  const proposals = fill(items, minutes);
  return proposals.length > 0 ? proposals : null;
}
