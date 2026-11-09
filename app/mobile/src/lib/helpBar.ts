// 「AI の手助け」の棒の長さ。回数を 0〜1 の割合にする（画面は幅にこの割合をかける）。

// 棒が一杯になる回数（#196）。ヒント（small）は 20 回・やり方（medium）は 8 回。これ以上は一杯のまま。
// 一杯になっても聞けなくならない（警告の色・文言・ロックは出さない。長さが変わるだけ）。
export const HELP_BAR_FULL_SMALL = 20;
export const HELP_BAR_FULL_MEDIUM = 8;

// 0 回は空、1 回以上は見える長さ、full 回以上は一杯
export function barFill(count: number, full: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(full) || full <= 0) return 1;
  return Math.min(count, full) / full;
}

// 返事の横の小さい棒。小 = 小の棒だけ、中 = 小・中の両方が点く。none（問い返しだけ）は何も灯さない
export function miniLit(level: 'none' | 'small' | 'medium'): { small: boolean; medium: boolean } {
  return { small: level === 'small' || level === 'medium', medium: level === 'medium' };
}
