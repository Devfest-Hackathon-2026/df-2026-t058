// #315 ホームの「今日の一歩」のカード: モルティの 1 つ目のボタンから中身を決める
import type { Checkpoint, HomeData } from '../api/types';
import { homeCard } from '../lib/homeCard';

type Entry = HomeData['goals'][number];
const cp = (id: string, order: number) => ({ id, order, title: `t-${id}`, doneMark: '', estimateMin: 20, state: 'todo', achievement: null }) as Checkpoint;
const entry = (id: string, cps: Checkpoint[] | null, kind?: 'task'): Entry =>
  ({
    goal: { id, userId: 'u', text: `goal-${id}`, deadline: '2026-11-20T14:59:00.000Z', minutesPerDay: null, status: 'active', ...(kind ? { kind } : {}) },
    roadmap: cps ? { id: `r${id}`, goalId: id, userId: 'u', adopted: 'own', why: '', checkpoints: cps, createdAt: '' } : null,
  }) as Entry;

describe('homeCard', () => {
  const goals = [entry('a', [cp('a1', 1), cp('a2', 2)]), entry('b', null), entry('t', [cp('t1', 1)], 'task')];

  it('始める: 目標・その一歩・期限・道の丸', () => {
    const c = homeCard({ kind: 'start', goalId: 'a', checkpointId: 'a2' }, goals);
    expect(c).toMatchObject({ goalId: 'a', goalText: 'goal-a', deadline: '2026-11-20T14:59:00.000Z' });
    expect(c?.step?.id).toBe('a2');
    expect(c?.checkpoints).toHaveLength(2);
  });
  it('進め方を決める: 一歩は無し', () => {
    expect(homeCard({ kind: 'plan', goalId: 'b' }, goals)).toMatchObject({ goalId: 'b', step: null, checkpoints: [] });
  });
  it('タスクは道の丸を出さない', () => {
    expect(homeCard({ kind: 'start', goalId: 't', checkpointId: 't1' }, goals)?.checkpoints).toEqual([]);
  });
  it('続き・振り返り・目標なし・知らない目標や一歩はカードを出さない', () => {
    expect(homeCard(undefined, goals)).toBeNull();
    expect(homeCard({ kind: 'resume', sessionId: 's' }, goals)).toBeNull();
    expect(homeCard({ kind: 'import' }, goals)).toBeNull();
    expect(homeCard({ kind: 'start', goalId: 'x', checkpointId: 'a1' }, goals)).toBeNull();
    expect(homeCard({ kind: 'start', goalId: 'a', checkpointId: 'zz' }, goals)).toBeNull();
  });
});
