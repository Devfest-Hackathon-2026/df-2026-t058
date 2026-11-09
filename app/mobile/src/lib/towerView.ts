// 建物の札の言葉。数字ではなく、判定の画面と同じ言葉（まだ／少し／だいたい／できた）で言う。

import type { Achievement } from '../api/types';
import { COPY_HELP_MEDIUM, COPY_HELP_SMALL } from './copy';
import { canvasHeight, GROUND_PAD } from './isoTower';
import { LEVEL_WORD } from './reflectView';

// ---- 建物の画面のスクロール（#269）----

export const SCROLL_MAX_BLOCKS = 300; // 画面に描く階の上限（これより古い階は描かない）

// 中身が見える高さを超える時だけ、スクロールと「地面まで」「最新へ」のボタンを出す
export function towerNeedsScroll(contentH: number, viewH: number): boolean {
  return viewH > 0 && contentH > viewH + 1;
}

// 「最新へ」の位置: 次の階の枠と最上階の下の端が、画面の下から 48 上に見える位置。上の余白で見えるなら 0
export function latestScrollY(towerY: number, scale: number, viewH: number): number {
  const topFloorBottom = (canvasHeight(2) - GROUND_PAD) * scale;
  return Math.max(0, Math.round(towerY + topFloorBottom + 48 - viewH));
}

const word = (n: number): string => LEVEL_WORD[Math.min(3, Math.max(0, Math.round(n))) as Achievement];

// 「どこまでできたか」。AI と自分が違う時だけ両方を出す。判定が無ければ null
export function achievementWords(ai: number | null, mine: number | null): string | null {
  if (ai === null && mine === null) return null;
  if (ai === null) return `自分 ${word(mine as number)}`;
  if (mine === null || ai === mine) return word(mine ?? ai);
  return `モルティ ${word(ai)}・自分 ${word(mine)}`;
}

// 「AI の手助け」。無ければ「なし」。0 の方は省く
export function helpWords(h: { small: number; medium: number }): string {
  const parts: string[] = [];
  if (h.small > 0) parts.push(`${COPY_HELP_SMALL} ${h.small}`);
  if (h.medium > 0) parts.push(`${COPY_HELP_MEDIUM} ${h.medium}`);
  return parts.length ? parts.join('・') : 'なし';
}

// 「自分で決めた度」（0〜100）。判定の画面の「/100」付きの形に合わせる
export function ownScoreWords(v: number): string {
  const n = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
  return `${n}/100`;
}

// 色ごとの階の数。階（Floor）の floors を足す
export function colorTally(floors: readonly { color: 'gold' | 'silver' | 'bronze'; floors: number }[]) {
  const t = { gold: 0, silver: 0, bronze: 0, total: 0 };
  for (const f of floors) {
    t[f.color] += f.floors;
    t.total += f.floors;
  }
  return t;
}

export function tallyText(t: { gold: number; silver: number; bronze: number; total: number }): string {
  return `金 ${t.gold}・銀 ${t.silver}・銅 ${t.bronze}・合計 ${t.total}`;
}
