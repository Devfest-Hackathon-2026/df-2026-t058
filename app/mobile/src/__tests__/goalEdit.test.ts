import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';

// 目標を直す・やめる・戻す（#231・契約 §3.3）の窓口。
type Call = { url: string; init: RequestInit };
function fakeFetch(body: string, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe('目標を直す・やめる・戻す', () => {
  test('http: 契約どおりの方法と URL と本文で送る', async () => {
    const calls: Call[] = [];
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: fakeFetch('{"id":"g"}', calls) });
    await api.updateGoal('g/1', { text: '直した題', minutesPerDay: null });
    await api.archiveGoal('g/1');
    await api.restoreGoal('g/1');
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['PUT', 'http://api.test/api/goals/g%2F1'],
      ['POST', 'http://api.test/api/goals/g%2F1/archive'],
      ['POST', 'http://api.test/api/goals/g%2F1/restore'],
    ]);
    expect(JSON.parse(String(calls[0]?.init.body ?? '{}'))).toEqual({ text: '直した題', minutesPerDay: null });
  });

  test('mock: 直す・検査・やめるとホームと今日の提案から外れる・戻せる', async () => {
    const api = createMockApi({ now: () => Date.parse('2026-11-08T01:00:00Z'), aiDelayMs: 0 });
    const goal = await api.createGoal({ text: '二次方程式', deadline: '2026-11-12T14:59:00Z', minutesPerDay: 30 });
    const { candidates } = await api.makeCandidates(goal.id);
    const cand = candidates[0];
    if (!cand) throw new Error('案が無い');
    const rm = await api.decideRoadmap(goal.id, { source: 'candidate', candidateId: cand.id, why: '自分で選んだ', checkpoints: [] });

    const fixed = await api.updateGoal(goal.id, { text: '　二次方程式を解く　', deadline: '2026-11-20T14:59:00Z' });
    expect(fixed.text).toBe('二次方程式を解く');
    expect(fixed.minutesPerDay).toBe(30);
    expect((await api.getGoal(goal.id)).roadmap).toEqual(rm);
    await expect(api.updateGoal(goal.id, {})).rejects.toMatchObject({ status: 400 });
    await expect(api.updateGoal(goal.id, { minutesPerDay: 4 })).rejects.toMatchObject({ status: 400 });
    await expect(api.archiveGoal('none')).rejects.toMatchObject({ status: 404 });

    const archived = await api.archiveGoal(goal.id);
    expect(typeof archived.archivedAt).toBe('string');
    expect((await api.home()).goals).toHaveLength(0);
    expect((await api.today(60)).proposals).toHaveLength(0);
    expect((await api.listGoals()).goals[0]?.archivedAt).toBe(archived.archivedAt);

    const back = await api.restoreGoal(goal.id);
    expect(back.archivedAt).toBeUndefined();
    expect((await api.home()).goals).toHaveLength(1);
    expect((await api.today(60)).proposals.length).toBeGreaterThan(0);
  });
});
