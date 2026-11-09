// 設定の画面の、表示名の検査と通知の強さの選び。画面から切り出して試験する。

import type { NudgeLevel } from '../api/types';

export const NAME_MIN = 1; // サーバーが受ける範囲（契約 §3.2）
export const NAME_MAX = 30;

// 通知の札の名前。友達の画面と設定の画面で同じ物を使う
// hint は、選ぶと何が届くかの 1 行（強さの中身は契約で未決なので、断定しすぎない言い方にする）
export const NUDGE_OPTIONS: { key: NudgeLevel; label: string; hint: string }[] = [
  { key: 'off', label: 'なし', hint: '友達が始めた知らせは出ません' },
  { key: 'friend_start', label: '始めた時', hint: '友達が取り組みを始めた時に知らせます' },
  { key: 'strong', label: '強め', hint: '始めた時の知らせを、より目立つ形で出します' },
];

// 選んでいる通知の強さの 1 行説明
export function nudgeHint(level: NudgeLevel): string {
  return NUDGE_OPTIONS.find((o) => o.key === level)?.hint ?? '';
}

// 名前の欄の薄い例（薄い字だと分かるように「例:」を付ける）
export const NAME_PLACEHOLDER = '例: ゆうき';

// 戻る矢印を押した時の動き。履歴があれば 1 つ戻る、無ければ（URL で直接開いた時）ホームへ
export function backAction(canGoBack: boolean): 'back' | 'home' {
  return canGoBack ? 'back' : 'home';
}

// 前後の空白を除いて 1〜30 字なら、その名前。それ以外は null。
export function validName(s: string): string | null {
  const t = s.trim();
  return t.length >= NAME_MIN && t.length <= NAME_MAX ? t : null;
}

// 保存できるか: 検査を通り、いまの値と違う時だけ。
export function canSaveName(input: string, saved: string): boolean {
  const t = validName(input);
  return t !== null && t !== saved;
}

export function nudgeLabel(level: NudgeLevel): string {
  return NUDGE_OPTIONS.find((o) => o.key === level)?.label ?? '';
}
