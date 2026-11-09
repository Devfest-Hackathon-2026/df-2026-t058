// モルティが返すボタン（契約 §3.12 の Action）を、ラベルと行き先に変える。押した時だけ移る（モルティは自分で移らない・P1）
import type { AgentAction, HomeData } from '../api/types';
import {
  COPY_ACTION_FRIENDS,
  COPY_ACTION_IMPORT,
  COPY_ACTION_PLAN,
  COPY_ACTION_REFLECT,
  COPY_ACTION_RESUME,
  COPY_ACTION_SETTINGS,
  COPY_ACTION_TOWER,
  COPY_ACTION_WRITE,
  COPY_START,
} from './copy';

type GoalEntry = HomeData['goals'][number];

export function actionPath(a: AgentAction): string {
  switch (a.kind) {
    case 'start':
      return `/start/${a.goalId}/${a.checkpointId}`;
    case 'resume':
      return `/focus/${a.sessionId}`;
    case 'reflect':
      return `/reflect/${a.sessionId}`;
    case 'plan':
      return `/plan/${a.goalId}`;
    case 'write':
      return '/goal/new';
    case 'import':
      return '/goal/import';
    case 'tower':
      return '/tower';
    case 'friends':
      return '/friends';
    case 'settings':
      return '/settings';
  }
}

// 始めるのボタンは、分が分かれば「始める　30 分」。2 件目以降（primary でない）は一歩の名前で出す
export function actionLabel(a: AgentAction, goals: GoalEntry[], primary = true): string {
  switch (a.kind) {
    case 'start': {
      const cp = goals.find((g) => g.goal.id === a.goalId)?.roadmap?.checkpoints.find((c) => c.id === a.checkpointId);
      // 主ボタンは「始める」だけ（分は書かない・11/9 本人指示）。2 件目以降は一歩の名前
      if (!primary && cp) return cp.title;
      return COPY_START;
    }
    case 'resume':
      return COPY_ACTION_RESUME;
    case 'reflect':
      return COPY_ACTION_REFLECT;
    case 'plan':
      return COPY_ACTION_PLAN;
    case 'write':
      return COPY_ACTION_WRITE;
    case 'import':
      return COPY_ACTION_IMPORT;
    case 'tower':
      return COPY_ACTION_TOWER;
    case 'friends':
      return COPY_ACTION_FRIENDS;
    case 'settings':
      return COPY_ACTION_SETTINGS;
  }
}

export function actionKey(a: AgentAction): string {
  return [a.kind, 'goalId' in a ? a.goalId : '', 'checkpointId' in a ? a.checkpointId : '', 'sessionId' in a ? a.sessionId : ''].join(':');
}
