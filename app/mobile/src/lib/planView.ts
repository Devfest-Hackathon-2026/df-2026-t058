// 案の画面の判断を、画面から切り出した関数。

import { COPY_REASON_NEEDED } from './copy';
import { percent } from './editRatio';
import { columnsFor } from './navLayout';

// 理由が空（空白だけも空）か
export const whyEmpty = (why: string): boolean => why.trim().length === 0;

// 「これで決める」を押した時にすること。
// 'flash': 理由が空なので、欄を点滅させてカーソルを入れる / 'decide': 決める / 'none': 決められない（案が無い・欄の不備）
export type DecideAction = 'flash' | 'decide' | 'none';

export function decideAction(p: { why: string; hasTarget: boolean; problem: string | null }): DecideAction {
  if (!p.hasTarget) return 'none';
  if (whyEmpty(p.why)) return 'flash';
  return p.problem ? 'none' : 'decide';
}

// 薄い例文は「例:」を付けて、入力済みに見えなくする
export const WHY_EXAMPLE = '例: 本番に近い問題から始めたい';

// 理由が空のまま「これで決める」を押した時に、欄の下へ出す 1 行
export const WHY_REQUIRED = COPY_REASON_NEEDED;

// その行を出すか: 空のまま押した後で、まだ空の間だけ
export const showWhyRequired = (pressedEmpty: boolean, why: string): boolean => pressedEmpty && whyEmpty(why);

// 「始める」画面で実際に使う一行: 入力が空なら、欄の例（今のチェックポイント名）を使う
export const startLine = (oneLine: string, fallback: string | null | undefined): string =>
  oneLine.trim() || (fallback ?? '').trim();

// 案への希望（#223）: 「希望を足して、もう一度案を出す」の 1 行。サーバーと同じ 200 字まで。
export const REMAKE_NOTE_MAX = 200;

// 送る本文: 前後の空白（全角も）を落として空なら note を送らない（{}・今までどおりの呼び出し）
export function candidatesBody(note: string | undefined): { note?: string } {
  const t = (note ?? '').trim();
  return t ? { note: t } : {};
}

// レーダーの線を強く出すか: 未選択の間は 3 本とも同じ強さ（全部強く）、選んだ後は選んだ案だけ
export const emphasizedAt = (sel: number | null, i: number): boolean => sel === null || i === sel;

// 案が置き換わった後の選択: 前の案の選択・直した中身は外す（案の ID が変わるので使えない）。
// 「自分で作る」に入っていたらそのまま（書きかけを隠さない）。理由の札と欄はここでは触らない（残す）
export type PlanMode = 'pick' | 'edit' | 'own';
export function selectionAfterRemake(mode: PlanMode): { sel: number | null; mode: PlanMode; edits: Record<string, never> } {
  return { sel: null, mode: mode === 'own' ? 'own' : 'pick', edits: {} };
}

// 案の画面の並べ方。
// 1 列（スマホ・タブレット）: 下の固定帯は「これで決める」だけ。理由の欄は流れる中身の末尾に置く（「決め方」の札を帯で隠さない）
// 2 列（PC）: 左にレーダーと案の札、右に案の中身。右の列の下に理由の欄と「これで決める」を固定する
export type PlanFooterItem = 'why' | 'decide';

export interface PlanLayout {
  columns: 1 | 2;
  footer: PlanFooterItem[];
  whyInScroll: boolean;
}

export function planLayoutFor(width: number): PlanLayout {
  return columnsFor(width) === 2
    ? { columns: 2, footer: ['why', 'decide'], whyInScroll: false }
    : { columns: 1, footer: ['decide'], whyInScroll: true };
}

// 案をタップした後の方式: 必ず「そのまま使う」に戻す（直した中身・自分で作った中身は消さない）
export const modeAfterChoose = (): PlanMode => 'pick';

// 「これで決める」の直上に出す 1 行: いま何が決まるか。案が選ばれていない時は null（何も出さない）
export function decideTargetLine(p: { mode: PlanMode; chosenName: string | null; ratio: number }): string | null {
  if (p.mode === 'own') return '自分で作った道で決めます';
  if (p.chosenName === null) return null;
  if (p.mode === 'edit' && p.ratio > 0) return `「${p.chosenName}」を ${percent(p.ratio)} 直して決めます`;
  return `「${p.chosenName}」で決めます`;
}

// 送る内容。上の 1 行と必ず一致する（own は candidateId なし、pick と割合 0 の edit は選んだ案の ID）
export interface DecideRequest {
  source: 'candidate' | 'edited' | 'own';
  candidateId?: string;
  why: string;
  checkpoints: { title: string; doneMark: string; estimateMin?: number }[];
}

type Step = { title: string; doneMark: string; estimateMin?: number };
const stepKey = (s: { title: string; doneMark: string }) => `${s.title.trim()}\u0000${s.doneMark.trim()}`;

// 見積りの分は本人に聞かない（#268）。案から来た行（題と完了の目印が案のどれかと同じ）は元の分を付け、
// 足した行・題や目印を直した行は付けない（サーバーが Gemini で決める）。「自分で作る」は案が無いので全部付けない
export function decideRequest(p: {
  mode: PlanMode;
  chosen: { id: string; checkpoints?: Step[] } | null;
  ratio: number;
  steps: Step[];
  why: string;
}): DecideRequest {
  const source = p.mode === 'own' ? 'own' : p.mode === 'edit' && p.ratio > 0 ? 'edited' : 'candidate';
  const original = new Map<string, number>();
  if (source !== 'own') {
    for (const c of p.chosen?.checkpoints ?? []) {
      if (typeof c.estimateMin === 'number' && !original.has(stepKey(c))) original.set(stepKey(c), c.estimateMin);
    }
  }
  return {
    source,
    ...(source === 'own' || !p.chosen ? {} : { candidateId: p.chosen.id }),
    why: p.why,
    checkpoints: p.steps.map((s) => {
      const min = original.get(stepKey(s));
      return { title: s.title.trim(), doneMark: s.doneMark.trim(), ...(min === undefined ? {} : { estimateMin: min }) };
    }),
  };
}
