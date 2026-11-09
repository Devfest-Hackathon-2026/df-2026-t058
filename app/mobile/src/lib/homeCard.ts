// ホームの「今日の一歩」のカード（#315）に出す中身。モルティが今出しているボタンの 1 つ目から決める。
// 始める（start）・進め方を決める（plan）の時だけカードを出す。続き・振り返り・目標なしは、一言とボタンだけ。

import type { AgentAction, Checkpoint, HomeData } from '../api/types';

type GoalEntry = HomeData['goals'][number];

export type HomeCard = {
  goalId: string;
  goalText: string;
  step: Checkpoint | null; // plan の時は null（進め方がまだ）
  deadline: string;
  checkpoints: Checkpoint[]; // 道の丸（タスクは出さないので空）
};

export function homeCard(action: AgentAction | undefined, goals: readonly GoalEntry[]): HomeCard | null {
  if (!action || (action.kind !== 'start' && action.kind !== 'plan')) return null;
  const g = goals.find((x) => x.goal.id === action.goalId);
  if (!g) return null;
  const cps = g.roadmap?.checkpoints ?? [];
  const step = action.kind === 'start' ? (cps.find((c) => c.id === action.checkpointId) ?? null) : null;
  if (action.kind === 'start' && !step) return null;
  return {
    goalId: g.goal.id,
    goalText: g.goal.text,
    step,
    deadline: g.goal.deadline,
    checkpoints: g.goal.kind === 'task' ? [] : cps,
  };
}
