// 計画の分数に対する進み具合（0〜1）。計画の分を超えても 1 のまま（急かさない）。
// 計画の分が無い・0・負・数でない時は 0（棒は出さない側で扱う）。

export function planRatio(elapsedMs: number, estimateMin: number | null | undefined): number {
  const planMs = Number(estimateMin) * 60_000;
  if (!Number.isFinite(planMs) || planMs <= 0) return 0;
  const e = Number(elapsedMs);
  if (!Number.isFinite(e) || e <= 0) return 0;
  return Math.min(1, e / planMs);
}

export const hasPlan = (estimateMin: number | null | undefined): boolean =>
  Number.isFinite(Number(estimateMin)) && Number(estimateMin) > 0;
