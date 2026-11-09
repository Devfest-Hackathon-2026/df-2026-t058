// mock の中だけで使う点の計算。本物はサーバーが決める（契約 §3.6 と contract-changes §2・すべて仮）。
// 速さの項は無い（P4）。

import type { Achievement, Floor, RoadmapSource } from '../api/types';

export interface FocusEventLike {
  type: string;
  at: number; // ミリ秒
}

// 作業時間（分・小数 1 桁）。開始〜終了から、離れていた間を除く（サーバーの focus.js と同じ考え方）。
export function focusMinutes(events: FocusEventLike[], start: number, end: number): number {
  if (!(end > start)) return 0;
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const clip = (t: number) => Math.min(end, Math.max(start, t));
  let away = 0;
  let leftAt: number | null = null;
  for (const e of sorted) {
    if (e.type === 'leave' && leftAt === null) leftAt = e.at;
    else if (e.type === 'return' && leftAt !== null) {
      away += clip(e.at) - clip(leftAt);
      leftAt = null;
    }
  }
  if (leftAt !== null) away += end - clip(leftAt);
  const min = (end - start - away) / 60000;
  return Math.round(Math.max(0, min) * 10) / 10;
}

// 階数: 15 分ごとに 1 階。5 分以上なら最低 1 階。
export function floorsFor(focusMin: number): number {
  if (!(focusMin >= 5)) return 0;
  return Math.max(1, Math.floor(focusMin / 15));
}

// 自分で決めた度（0〜100）: 出どころ −10×中（40 まで）。small（問い返し・考えの確認）では引かない（11/9）。サーバーと同じ式。
// 引数 small は使わない（呼び出し側の形を保つために残している）。
export function ownScore(adopted: RoadmapSource, editRatio: number | undefined, _small: number, medium: number): number {
  const r = Math.min(1, Math.max(0, editRatio ?? 0));
  const origin = adopted === 'own' ? 70 : adopted === 'edited' ? 50 + 20 * r : 40;
  const raw = origin - Math.min(40, 10 * medium);
  return Math.round(Math.min(100, Math.max(0, raw)));
}

export function colorFor(own: number, achievement: Achievement | null): Floor['color'] {
  const a = achievement ?? 0;
  if (own >= 70 && a >= 2) return 'gold';
  if (own >= 40 && a >= 1) return 'silver';
  return 'bronze';
}
