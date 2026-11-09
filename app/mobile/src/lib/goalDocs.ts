// 目標の資料の数（前からの materials も 1 つと数える・11/9）
import type { Goal } from '../api/types';

export function docsCount(goal: Pick<Goal, 'docs' | 'materials'> | null | undefined): number {
  return (goal?.docs?.length ?? 0) + (goal?.materials?.trim() ? 1 : 0);
}

// 集中・振り返りの画面の札用: home の goals から目標を引く（取れなければ null＝札を出さない）
export function pickGoal(goals: { goal: Goal }[] | null | undefined, goalId: string | null | undefined): Goal | null {
  if (!goalId) return null;
  return goals?.find((g) => g.goal.id === goalId)?.goal ?? null;
}

// 札の文字。目標が取れない時は null（札を出さない）。文言は道を決める画面と同じ作り
export function docsChipText(goal: Pick<Goal, 'docs' | 'materials'> | null | undefined, label: string): string | null {
  if (!goal) return null;
  const n = docsCount(goal);
  return n > 0 ? `📄 ${label} ${n}` : `＋ ${label}`;
}
