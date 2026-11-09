import { jstDayKey } from '../score/streak.js';

// 進み具合（契約 §3.3 ロードマップの見直し・#358）。純粋関数・AI は呼ばない。
// 残りの見込み＝未完了のチェックポイントの estimateMin の合計（無い行は 30）。
// 使える時間＝期限までの日数（今日を含む・日本時間の暦日）× 1 日の時間（null なら 60）。
export const PACE_DEFAULT_ESTIMATE = 30;
export const PACE_DEFAULT_MINUTES_PER_DAY = 60;
export const PACE_AHEAD_MIN_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// 今日から期限の日までの日数（今日を含む）。期限を過ぎていれば 0 以下。
export function daysLeftJst(deadline, now) {
  const end = Date.parse(`${jstDayKey(deadline)}T00:00:00Z`);
  const today = Date.parse(`${jstDayKey(now)}T00:00:00Z`);
  return Math.round((end - today) / DAY_MS) + 1;
}

export function paceFor({ goal, roadmap, now }) {
  if (!roadmap || !Array.isArray(roadmap.checkpoints)) return null;
  if (!goal?.deadline || Number.isNaN(Date.parse(goal.deadline))) return null;
  const days = daysLeftJst(goal.deadline, now);
  if (days < 1) return null; // 期限を過ぎた
  const left = roadmap.checkpoints.filter((c) => c && c.state !== 'done');
  if (left.length === 0) return null;
  const need = left.reduce((s, c) => s + (Number.isFinite(c.estimateMin) ? c.estimateMin : PACE_DEFAULT_ESTIMATE), 0);
  const perDay = typeof goal.minutesPerDay === 'number' ? goal.minutesPerDay : PACE_DEFAULT_MINUTES_PER_DAY;
  const avail = days * perDay;
  if (need > avail) return 'behind';
  if (need * 3 <= avail && days >= PACE_AHEAD_MIN_DAYS) return 'ahead';
  return 'ok';
}
