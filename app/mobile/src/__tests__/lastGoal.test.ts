import { lastGoalId, pickGoalIndex, rememberLastGoal, rememberSession } from '../lib/local';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
});

describe('最後に集中した目標', () => {
  it('覚えて、読める', async () => {
    await rememberLastGoal('g2');
    expect(await lastGoalId()).toBe('g2');
  });

  it('集中を始めると、その目標を覚える', async () => {
    await rememberSession('s1', { goalId: 'g3', checkpointId: 'c1' });
    expect(await lastGoalId()).toBe('g3');
  });
});

describe('pickGoalIndex', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('進行中の目標を最優先する', () => {
    expect(pickGoalIndex(ids, 'c', 'b')).toBe(2);
  });
  it('進行中が無ければ最後に集中した目標', () => {
    expect(pickGoalIndex(ids, null, 'b')).toBe(1);
  });
  it('どちらも無い・一覧に無い時は先頭', () => {
    expect(pickGoalIndex(ids, null, null)).toBe(0);
    expect(pickGoalIndex(ids, 'x', 'y')).toBe(0);
    expect(pickGoalIndex([], 'x', 'y')).toBe(0);
  });
  it('進行中が一覧に無ければ最後の目標に落ちる', () => {
    expect(pickGoalIndex(ids, 'x', 'd')).toBe(3);
  });
});
