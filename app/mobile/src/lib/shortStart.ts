// 「5 分だけやる」。5 分たったら、帯を 1 回だけ出す（純粋関数）。
// 出した後・「続ける」を押した後・終えた後は dismissed を true にして、二度と出さない。

export const SHORT_START_MS = 5 * 60_000;

export function shortStartDue(startedAtMs: number, nowMs: number, dismissed: boolean): boolean {
  if (dismissed) return false;
  return nowMs - startedAtMs >= SHORT_START_MS;
}
