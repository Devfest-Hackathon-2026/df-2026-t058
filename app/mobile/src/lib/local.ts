// 端末の中だけに置く小さな覚え書き（表示用）。消えても流れは止まらない。
// - nextStep: 振り返りで選んだ次の一歩（次の集中の「今日やること」に入れる）
// - sessionGoal: 集中の ID → 目標とチェックポイントの ID（建物の記録用。Floor には目標の ID が無い）
// - goalAxes: 目標の ID → 案の軸の名前（GET /api/goals/:id が軸を返さないため）
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Axis } from '../api/types';

const K_NEXT = 'nextStep.v1';
const K_SESSION_GOAL = 'sessionGoal.v2';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても続ける
  }
}

export async function getNextStep(goalId: string): Promise<string | null> {
  const all = await readJson<Record<string, string>>(K_NEXT, {});
  return all[goalId] ?? null;
}

export async function setNextStep(goalId: string, text: string | null): Promise<void> {
  const all = await readJson<Record<string, string>>(K_NEXT, {});
  if (text) all[goalId] = text;
  else delete all[goalId];
  await writeJson(K_NEXT, all);
}

export interface SessionInfo {
  goalId: string;
  checkpointId: string;
}

export async function rememberSession(sessionId: string, info: SessionInfo): Promise<void> {
  const all = await readJson<Record<string, SessionInfo>>(K_SESSION_GOAL, {});
  all[sessionId] = info;
  await writeJson(K_SESSION_GOAL, all);
  // 集中を始めた目標を「最後に集中した目標」として覚える（ホームへ戻った時に開く）
  await rememberLastGoal(info.goalId);
}

// 最後に集中した目標の ID（端末に 1 つだけ）
const K_LAST_GOAL = 'lastGoal.v1';

export async function rememberLastGoal(goalId: string): Promise<void> {
  await writeJson(K_LAST_GOAL, goalId);
}

export async function lastGoalId(): Promise<string | null> {
  const v = await readJson<unknown>(K_LAST_GOAL, null);
  return typeof v === 'string' && v ? v : null;
}

// ホームで開く目標を決める。進行中の集中の目標 → 最後に集中した目標 → 先頭（ホームは期限順に渡すので、期限が最も近い目標）、の順。
// 一覧に無い ID（消えた目標）は飛ばす。
export function pickGoalIndex(goalIds: string[], activeGoalId: string | null, lastId: string | null): number {
  for (const id of [activeGoalId, lastId]) {
    if (!id) continue;
    const i = goalIds.indexOf(id);
    if (i >= 0) return i;
  }
  return 0;
}

export async function sessionInfo(sessionId: string): Promise<SessionInfo | null> {
  const all = await readJson<Record<string, SessionInfo>>(K_SESSION_GOAL, {});
  return all[sessionId] ?? null;
}

export async function goalForSession(sessionId: string): Promise<string | null> {
  return (await sessionInfo(sessionId))?.goalId ?? null;
}

// 「今日使える時間」（todayMinutes.v1）は #265 でやめた（時間はサーバーが決める）。端末に残った値は読まない（読み捨て）。

// 案を作った時の軸の名前（目標ごと）。起動し直しても、案を作り直さずに描けるように。
const K_AXES = 'goalAxes.v1';

export async function rememberAxes(goalId: string, axes: Axis[]): Promise<void> {
  const all = await readJson<Record<string, Axis[]>>(K_AXES, {});
  all[goalId] = axes;
  await writeJson(K_AXES, all);
}

// 集中中のメモ（#194）。集中の ID → 書いた順の配列。サーバーには送らない（振り返りのメモ欄の初期値にだけ使う）
const K_FOCUS_MEMOS = 'focusMemos.v1';

export async function focusMemos(sessionId: string): Promise<string[]> {
  const all = await readJson<Record<string, unknown>>(K_FOCUS_MEMOS, {});
  const v = all[sessionId];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

// 空の文は残さない。保存後の、その集中のメモ全部を返す
export async function addFocusMemo(sessionId: string, text: string): Promise<string[]> {
  const t = text.trim();
  const cur = await focusMemos(sessionId);
  if (!t) return cur;
  const next = [...cur, t];
  const all = await readJson<Record<string, string[]>>(K_FOCUS_MEMOS, {});
  all[sessionId] = next;
  await writeJson(K_FOCUS_MEMOS, all);
  return next;
}

// 振り返りのメモ欄の初期値（1 行ずつ。欄の上限で切る）
export function memoNote(memos: string[], max = 1000): string {
  return memos.join('\n').slice(0, max);
}

// ロードマップの見直しを最後に持ちかけた日（目標の ID → 日本時間の 'YYYY-MM-DD'・#359）。同じ日に 2 度持ちかけない
const K_REVISE_OFFER = 'reviseOffer.v1';

export async function reviseOfferedOn(goalId: string): Promise<string | null> {
  const all = await readJson<Record<string, unknown>>(K_REVISE_OFFER, {});
  const v = all[goalId];
  return typeof v === 'string' && v ? v : null;
}

export async function rememberReviseOffer(goalId: string, day: string): Promise<void> {
  const all = await readJson<Record<string, string>>(K_REVISE_OFFER, {});
  all[goalId] = day;
  await writeJson(K_REVISE_OFFER, all);
}

export async function axesFor(goalId: string): Promise<Axis[] | null> {
  const all = await readJson<Record<string, Axis[]>>(K_AXES, {});
  return all[goalId] ?? null;
}
