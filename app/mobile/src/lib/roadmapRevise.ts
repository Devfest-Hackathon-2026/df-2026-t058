// ロードマップの見直し（契約 §3.3・#353・#359）の純関数。
// - 進み具合 pace の決まった規則（サーバーの app/api/src/roadmap/pace.js と同じ規則・見本 mock が使う）
// - 振り返りの最後に持ちかけるかどうか（遅れ・先行で、その目標にまだ今日持ちかけていない時だけ）
// - 見本の下書きの直し方（サーバーの GEMINI_MODE=fake と同じ・behind＝最後を外す／ahead＝仕上げを足す／ok＝そのまま）
// - 見直しの画面のロードマップの絵の並び（終わった物を前に、下書きの残りをその後に）
// 画面に時間や日付は出さない（判定にだけ使う）。

import type { Checkpoint, CheckpointInput, Roadmap, RoadmapPace } from '../api/types';
import type { RoadStep } from '../components/PlanRoad';

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
export const DEFAULT_ESTIMATE_MIN = 30; // 見込みの無い行
export const DEFAULT_MINUTES_PER_DAY = 60; // 1 日の時間が null（おまかせ）の時
export const AHEAD_MIN_DAYS = 3;
export const REVISE_DRAFT_MAX = 8;
export const REVISE_TOTAL_MIN = 3;
export const REVISE_TOTAL_MAX = 12;
// 見本の「仕上げ」の 1 個（ahead の時に最後に足す）
export const FINISH_STEP: Required<CheckpointInput> = { title: '仕上げ', doneMark: '全体を見直して、仕上げができた', estimateMin: 30 };

// 日本時間の暦日の番号（日の差を数える用）
export const jstDayNumber = (t: number): number => Math.floor((t + JST_MS) / DAY_MS);
// 日本時間の暦日の文字（端末に覚える「持ちかけた日」）
export const jstDayKey = (t: number): string => new Date(t + JST_MS).toISOString().slice(0, 10);

// 進み具合（契約 §3.3）。ロードマップが無い・期限が無い・期限を過ぎた・未完了が 0 は null
export function paceOf(input: {
  roadmap: Pick<Roadmap, 'checkpoints'> | null;
  deadline: string | null | undefined;
  minutesPerDay: number | null | undefined;
  now: number;
}): RoadmapPace {
  const { roadmap, deadline, minutesPerDay, now } = input;
  if (!roadmap || !deadline) return null;
  const end = Date.parse(deadline);
  if (!Number.isFinite(end) || end < now) return null;
  const left = roadmap.checkpoints.filter((c) => c.state !== 'done');
  if (left.length === 0) return null;
  const need = left.reduce((a, c) => a + (typeof c.estimateMin === 'number' && c.estimateMin > 0 ? c.estimateMin : DEFAULT_ESTIMATE_MIN), 0);
  const days = jstDayNumber(end) - jstDayNumber(now) + 1; // 今日を含む
  const perDay = typeof minutesPerDay === 'number' && minutesPerDay > 0 ? minutesPerDay : DEFAULT_MINUTES_PER_DAY;
  const avail = days * perDay;
  if (need > avail) return 'behind';
  if (need * 3 <= avail && days >= AHEAD_MIN_DAYS) return 'ahead';
  return 'ok';
}

// 振り返りの最後に見直しを持ちかけるか。遅れか先行で、その目標にまだ今日持ちかけていない時だけ
export function shouldOfferRevise(pace: RoadmapPace | undefined, lastOfferedDay: string | null, today: string): pace is 'behind' | 'ahead' {
  if (pace !== 'behind' && pace !== 'ahead') return false;
  return lastOfferedDay !== today;
}

// 今の残り（未完了のチェックポイント）を下書きの形にする
export function remainingDraft(checkpoints: Checkpoint[]): Required<CheckpointInput>[] {
  return checkpoints
    .filter((c) => c.state !== 'done')
    .map((c) => ({ title: c.title, doneMark: c.doneMark, estimateMin: c.estimateMin }));
}

// 応答の下書きの形にそろえる（空の行は外す・見込みは 5〜240 の整数・8 件まで）
export function normalizeDraft(draft: CheckpointInput[]): Required<CheckpointInput>[] {
  return draft
    .filter((c) => c && c.title?.trim() && c.doneMark?.trim())
    .slice(0, REVISE_DRAFT_MAX)
    .map((c) => ({
      title: Array.from(c.title.trim()).slice(0, 100).join(''),
      doneMark: Array.from(c.doneMark.trim()).slice(0, 200).join(''),
      estimateMin: Math.min(240, Math.max(5, Math.round(c.estimateMin ?? DEFAULT_ESTIMATE_MIN))),
    }));
}

// 見本の直し方（fake と同じ）。合計が 3〜12 個に収まる時だけ外す・足す
export function fakeRevise(pace: RoadmapPace, draft: Required<CheckpointInput>[], doneCount: number): Required<CheckpointInput>[] {
  if (pace === 'behind' && draft.length > 1 && doneCount + draft.length - 1 >= REVISE_TOTAL_MIN) return draft.slice(0, -1);
  if (pace === 'ahead' && draft.length < REVISE_DRAFT_MAX && doneCount + draft.length + 1 <= REVISE_TOTAL_MAX) return [...draft, { ...FINISH_STEP }];
  return draft;
}

// 見直しの画面のロードマップの絵: 終わった物（済みの見た目）を前に、下書きの残りをその後に
export function reviseRoadSteps(checkpoints: Checkpoint[], draft: CheckpointInput[]): RoadStep[] {
  const done = checkpoints.filter((c) => c.state === 'done').map((c) => ({ title: c.title, doneMark: c.doneMark, done: true }));
  return [...done, ...draft.map((c) => ({ title: c.title, doneMark: c.doneMark }))];
}
