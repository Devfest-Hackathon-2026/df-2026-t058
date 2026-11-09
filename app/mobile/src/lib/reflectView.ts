// 振り返り画面の小さな判断。画面から切り出して試験する。

import type { Achievement, TutorIntent } from '../api/types';
import { copyLeaveLine, copyThoughtLine } from './copy';

// 0〜3 の言葉。完了（道が進む）は 3 だけ（サーバーの仕様）
export const LEVEL_WORD: Record<Achievement, string> = { 0: 'まだ', 1: '少し', 2: 'だいたい', 3: 'できた' };

// UI 刷新（11/9）: 「できた」の前の ✓ はやめた（選んだ印に見えて、まだ選んでいないのに選んだと誤解されたため）
export function levelWord(a: Achievement): string {
  return LEVEL_WORD[a];
}

export type JudgeStep = 'judge' | 'choose';

// 写真もメモも空なら材料なし。資料の初期値は材料に数えない
export function hasMaterial(input: { photoCount: number; note: string }): boolean {
  return input.photoCount > 0 || input.note.trim().length > 0;
}

// 材料が空なら、AI を呼ばずに「自分で選ぶ」へ
export function nextStepOnJudge(input: { photoCount: number; note: string }): JudgeStep {
  return hasMaterial(input) ? 'judge' : 'choose';
}

// 「自分で決めた度」は丸める（/100 は画面の単位で付ける）
export function ownScoreText(v: number): string {
  const n = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
  return `${n}`;
}

// 「集中した時間」は小数で出さない
export function focusMinText(v: number): string {
  return `${Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0}`;
}

// 結果の主役「どこまでできたか」。AI と自分の判定が違う時だけ 2 つ並べる（同じ・片方だけの時は 1 つ）
export type ResultLevel = { who: string | null; level: Achievement | null };
export function resultLevels(input: { judgeable: boolean; ai: Achievement | null; mine: Achievement | null }): ResultLevel[] {
  const { judgeable, ai, mine } = input;
  if (!judgeable || ai === null) return [{ who: null, level: mine }];
  if (mine === null || mine === ai) return [{ who: null, level: ai }];
  return [
    { who: 'AI', level: ai },
    { who: '自分', level: mine },
  ];
}

// 結果の札の小さな行。階の色・階数は出さない（積み上がる場面で初めて見せる）
export function resultSubLines(floor: { focusMin: number; ownScore: number }): string[] {
  return [`集中した時間　${focusMinText(floor.focusMin)} 分`, `自分で決めた度　${ownScoreText(floor.ownScore)}/100`];
}

// 階の色の名前（色の決め方はサーバー）
export const COLOR_NAME = { gold: '金', silver: '銀', bronze: '銅' } as const;
export type FloorColorKey = keyof typeof COLOR_NAME;

// 積み上がる場面の「+1 階」の下の 1 行。例: 「銀の階が 1 つ増えて、合計 35 階」（35 は建物の合計）
export function buildLine(c: FloorColorKey, total: number): string {
  const n = Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
  return `${COLOR_NAME[c]}の階が 1 つ増えて、合計 ${n} 階`;
}

// AI が判定できなかった時（写真・資料が無い時）に、結果の札へ足す 1 行
export const UNJUDGEABLE_LINE = '写真か資料があると判定できます';
export function unjudgeableLine(judgeable: boolean): string | null {
  return judgeable ? null : UNJUDGEABLE_LINE;
}

// 階が積み上がる場面の節目の 1 行。5・10・30 階をこの回でまたいだ時と、7 日連続の時だけ。階の節目を先に出す
export const FLOOR_MILESTONES = [5, 10, 30] as const;
export const STREAK_MILESTONE = 7;
export function milestoneLine(input: { gained: number; total: number; streak: number }): string | null {
  const gained = Number.isFinite(input.gained) ? Math.max(0, Math.round(input.gained)) : 0;
  const total = Number.isFinite(input.total) ? Math.max(0, Math.round(input.total)) : 0;
  const before = total - gained;
  if (gained > 0) {
    const hit = [...FLOOR_MILESTONES].reverse().find((m) => before < m && m <= total);
    if (hit !== undefined) return `${hit} 階に届きました`;
  }
  if (input.streak === STREAK_MILESTONE) return `${STREAK_MILESTONE} 日連続です`;
  return null;
}

// 離れた回数の 1 行（事実だけ）。0 回・負・数でない値は出さない
export function leaveLine(count: number): string | null {
  if (!Number.isFinite(count)) return null;
  const n = Math.round(count);
  return n >= 1 ? copyLeaveLine(n) : null;
}

// 「考えてから聞いた ◯/◯ 回」（事実だけ）。相談が 0 回・数でない値・負の値は出さない。◯ は相談の回数を超えない
export function thoughtLine(asks: number | undefined, thoughtAsks: number | undefined): string | null {
  if (typeof asks !== 'number' || !Number.isFinite(asks)) return null;
  const total = Math.round(asks);
  if (total < 1) return null;
  const t = typeof thoughtAsks === 'number' && Number.isFinite(thoughtAsks) ? Math.round(thoughtAsks) : 0;
  return copyThoughtLine(total, Math.min(total, Math.max(0, t)));
}

// 候補を押した時に送る相談の中身。質問文は「（札の名前）: （候補）」、thought は候補の文（ひとこと足したら後ろに足す）
export function optionAsk(
  cardLabel: string,
  intent: TutorIntent,
  option: string,
  extra: string,
): { text: string; thought: string; intent: TutorIntent } {
  const note = extra.trim();
  return { text: `${cardLabel}: ${option}`, thought: note ? `${option} ${note}` : option, intent };
}

// 「もっと書く」の開閉を覚える値（端末に保存する文字）
export const MORE_KEY = 'reflectMore.v1';
export function parseMoreOpen(v: string | null): boolean {
  return v === '1';
}
export function moreOpenValue(open: boolean): string {
  return open ? '1' : '0';
}
