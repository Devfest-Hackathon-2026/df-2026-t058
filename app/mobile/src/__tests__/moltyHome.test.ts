// ホームのモルティ（UI 刷新・11/9）: 最初に言うことと、並べるボタン。ボタンの行き先とラベル。会話の履歴の上限
import type { Checkpoint, HomeData, Session } from '../api/types';
import { pushTurns } from '../components/MoltyPanel';
import { firstSentences, sentences } from '../lib/agentLines';
import { actionLabel, actionPath } from '../lib/moltyActions';
import { HOME_EMPTY_LINE, moltyHome } from '../lib/moltyHome';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../api', () => ({ api: {}, errorText: () => '' }));

type GoalEntry = HomeData['goals'][number];

const cp = (id: string, order: number, state: Checkpoint['state'] = 'todo'): Checkpoint =>
  ({ id, order, title: `一歩${order}`, doneMark: '', estimateMin: 25, state, achievement: null }) as unknown as Checkpoint;
const goal = (id: string, deadline: string, cps: Checkpoint[] | null): GoalEntry =>
  ({
    goal: { id, text: `目標${id}`, deadline, status: 'active' },
    roadmap: cps ? { checkpoints: cps } : null,
  }) as unknown as GoalEntry;
const base = { goals: [] as GoalEntry[], active: null, toReflect: [] as Session[], feed: [] as HomeData['feed'] };

describe('moltyHome', () => {
  it('目標が無い時は取り込む→書くの順', () => {
    const v = moltyHome(base, []);
    expect(v.line).toBe(HOME_EMPTY_LINE);
    expect(v.actions.map((a) => a.kind)).toEqual(['import', 'write']);
  });
  it('進行中の集中が最優先、次に振り返り待ち', () => {
    const g = goal('a', '2026-11-20T00:00:00Z', [cp('c1', 1)]);
    const active = { id: 's1', goalId: 'a' } as unknown as Session;
    expect(moltyHome({ ...base, goals: [g], active, toReflect: [{ id: 's2' } as Session] }, []).actions).toEqual([{ kind: 'resume', sessionId: 's1' }]);
    expect(moltyHome({ ...base, goals: [g], toReflect: [{ id: 's2' } as Session] }, []).actions).toEqual([{ kind: 'reflect', sessionId: 's2' }]);
  });
  it('今日の提案があれば 1 件目を言い、提案を最大 3 つボタンにする（古い提案は捨てる）', () => {
    const g = goal('a', '2026-11-20T00:00:00Z', [cp('c1', 1), cp('c2', 2)]);
    const v = moltyHome({ ...base, goals: [g] }, [
      { goalId: 'a', checkpointId: 'c2', title: '古い', minutes: 10, reason: 'x' },
      { goalId: 'a', checkpointId: 'c1', title: '一歩1', minutes: 25, reason: '期限まであと 3 日' },
    ]);
    expect(v.line.text).toContain('「一歩1」');
    expect(v.line.text).toContain('期限まであと 3 日。');
    expect(v.actions).toEqual([{ kind: 'start', goalId: 'a', checkpointId: 'c1' }]);
  });
  it('友達が集中していれば 2 文目で言う。発言は 2 文まで', () => {
    const g = goal('a', '2026-11-20T00:00:00Z', [cp('c1', 1)]);
    const v = moltyHome({ ...base, goals: [g], feed: [{ userId: 'u', displayName: 'たろう', oneLine: '', at: '' }] }, [
      { goalId: 'a', checkpointId: 'c1', title: '一歩1', minutes: 25, reason: '期限まであと 3 日' },
    ]);
    expect(v.line.text).toContain('たろうさんも');
    expect(sentences(v.line.text).length).toBeLessThanOrEqual(3);
    expect(firstSentences(v.line.text, 2)).toContain('「一歩1」');
  });
  it('一覧で選んだ目標は、その目標の次の一歩を言う。道が無ければ案を比べる', () => {
    const a = goal('a', '2026-11-20T00:00:00Z', [cp('c1', 1, 'done'), cp('c2', 2)]);
    const b = goal('b', '2026-11-30T00:00:00Z', null);
    expect(moltyHome({ ...base, goals: [a, b] }, [], 'a').actions).toEqual([{ kind: 'start', goalId: 'a', checkpointId: 'c2' }]);
    expect(moltyHome({ ...base, goals: [a, b] }, [], 'b').actions).toEqual([{ kind: 'plan', goalId: 'b' }]);
  });
  it('提案が取れない時は、道の無い目標→次の一歩→全部終わり', () => {
    const a = goal('a', '2026-11-20T00:00:00Z', [cp('c1', 1, 'done')]);
    expect(moltyHome({ ...base, goals: [a] }, []).done).toBe(true);
    const b = goal('b', '2026-11-30T00:00:00Z', null);
    expect(moltyHome({ ...base, goals: [a, b] }, []).actions[0]).toEqual({ kind: 'plan', goalId: 'b' });
  });
  it('文は敬語（です・ます）で、「だね」「してみて」を使わない', () => {
    const g = goal('a', '2026-11-20T00:00:00Z', [cp('c1', 1)]);
    const texts = [moltyHome(base, []), moltyHome({ ...base, goals: [g] }, []), moltyHome({ ...base, goals: [g] }, [], 'a')].map((v) => v.line.text);
    for (const t of texts) expect(t).not.toMatch(/だね|してみて/);
  });
});

describe('ボタン', () => {
  const g = goal('a', '2026-11-20T00:00:00Z', [cp('c1', 1)]);
  it('行き先', () => {
    expect(actionPath({ kind: 'start', goalId: 'a', checkpointId: 'c1' })).toBe('/start/a/c1');
    expect(actionPath({ kind: 'resume', sessionId: 's' })).toBe('/focus/s');
    expect(actionPath({ kind: 'plan', goalId: 'a' })).toBe('/plan/a');
    expect(actionPath({ kind: 'import' })).toBe('/goal/import');
  });
  it('主ボタンは「始める」だけ（分を書かない）。2 件目以降は一歩の名前', () => {
    expect(actionLabel({ kind: 'start', goalId: 'a', checkpointId: 'c1' }, [g], true)).toBe('始める');
    expect(actionLabel({ kind: 'start', goalId: 'a', checkpointId: 'c1' }, [g], false)).toBe('一歩1');
  });
});

describe('会話の履歴', () => {
  it('直近 6 件・1 件 300 字まで・空は捨てる', () => {
    let h = pushTurns([], { from: 'me', text: 'あ'.repeat(400) }, { from: 'agent', text: ' ' });
    expect(h).toHaveLength(1);
    expect(Array.from(h[0]!.text)).toHaveLength(300);
    for (let i = 0; i < 10; i++) h = pushTurns(h, { from: 'me', text: String(i) });
    expect(h).toHaveLength(6);
    expect(h[5]!.text).toBe('9');
  });
});
