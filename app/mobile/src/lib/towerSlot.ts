// 建物の「次の階」の枠を出すかどうか。オプションが無ければ出さない。0 階でも出す（地面の上に置く）。
export function showNextSlot(nextSlot: boolean | undefined, _blockCount: number): boolean {
  return nextSlot === true;
}

// 階 1 つぶんの分数の既定（mock・サーバーの既定と同じ。サーバーは環境変数で変えられる）
export const DEFAULT_MINUTES_PER_FLOOR = 15;

// 次の階の枠をどれだけ塗るか（0〜1）。今回の集中の分のうち、階にならなかった端数が埋める量。
// 例: 15 分ごとに 1 階で 0.6 分 → 0.04、7.5 分 → 0.5、20 分（1 階）→ 約 0.33。
export function slotFill(focusMin: number, minutesPerFloor: number = DEFAULT_MINUTES_PER_FLOOR): number {
  if (!(focusMin > 0) || !(minutesPerFloor > 0)) return 0;
  const rest = focusMin % minutesPerFloor;
  return Math.min(1, Math.max(0, rest / minutesPerFloor));
}

// 枠の中の塗りの高さ（px）。0 より大きければ最低 4px は見せる
export function slotFillHeight(fill: number, slotHeight: number): number {
  if (!(fill > 0)) return 0;
  return Math.round(Math.min(slotHeight, Math.max(4, slotHeight * fill)));
}

// 読み上げ用: 次の階の枠の名前
export function slotLabel(fill: number): string {
  return fill > 0 ? `次の階の空き ${Math.round(fill * 100)} パーセント埋まっている` : '次の階の空き';
}
