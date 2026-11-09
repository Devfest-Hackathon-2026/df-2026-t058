import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { loadCandidates } from '../src/today/pick.js';

// 目標を直す・やめる・戻す（#231・契約 §3.3）。AI は呼ばない。
const NOW = new Date('2026-11-08T03:00:00.000Z');
const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const call = async (s, user, method, path, payload) => {
  const res = await fetch(`${s.base}${path}`, {
    method,
    headers: h(user),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json() };
};
const cps = () => [1, 2, 3].map((i) => ({ title: `例題 ${i}`, doneMark: `${i} 問解けた`, estimateMin: 30 }));

async function goalWithRoadmap(s, user, text) {
  const g = await call(s, user, 'POST', '/api/goals', { text, deadline: '2026-11-12T00:00:00+09:00', minutesPerDay: 30 });
  assert.equal(g.status, 201);
  const r = await call(s, user, 'POST', `/api/goals/${g.json.id}/roadmap`, { source: 'own', why: '自分で決めたい', checkpoints: cps() });
  assert.equal(r.status, 201);
  return { goal: g.json, roadmap: r.json };
}

test('PUT /api/goals/:id: 題・期限・1 日の時間を直せる。確定済みの道は変わらない', async () => {
  const s = await start({ now: () => NOW });
  const { goal, roadmap } = await goalWithRoadmap(s, 'u1', '二次方程式');
  const r = await call(s, 'u1', 'PUT', `/api/goals/${goal.id}`, { text: '　二次方程式を解く　', deadline: '2026-11-20T00:00:00+09:00', minutesPerDay: null });
  assert.equal(r.status, 200);
  assert.equal(r.json.text, '二次方程式を解く'); // POST と同じく前後の空白は落とす
  assert.equal(r.json.deadline, new Date('2026-11-20T00:00:00+09:00').toISOString());
  assert.equal(r.json.minutesPerDay, null);
  assert.equal(r.json.createdAt, goal.createdAt);
  assert.equal(r.json.status, 'active');
  // 一部だけ送ると、ほかは残る
  const p = await call(s, 'u1', 'PUT', `/api/goals/${goal.id}`, { minutesPerDay: 45 });
  assert.equal(p.json.text, '二次方程式を解く');
  assert.equal(p.json.minutesPerDay, 45);
  const one = (await call(s, 'u1', 'GET', `/api/goals/${goal.id}`)).json;
  assert.deepEqual(one.goal, p.json);
  assert.deepEqual(one.roadmap, roadmap);
  await s.close();
});

test('PUT /api/goals/:id: 検査は POST と同じ。空の要求は 400、他人・無い目標は 404', async () => {
  const s = await start({ now: () => NOW });
  const { goal } = await goalWithRoadmap(s, 'u1', '目標');
  const bads = [{}, { text: '' }, { text: 'あ'.repeat(501) }, { deadline: 'きのう' }, { minutesPerDay: 4 }, { minutesPerDay: 601 }, { minutesPerDay: '30' }];
  for (const b of bads) {
    const r = await call(s, 'u1', 'PUT', `/api/goals/${goal.id}`, b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(r.json.error.code, 'invalid_argument');
  }
  assert.equal((await call(s, 'u2', 'PUT', `/api/goals/${goal.id}`, { text: '乗っ取り' })).status, 404);
  assert.equal((await call(s, 'u1', 'PUT', '/api/goals/none', { text: 'x' })).status, 404);
  for (const path of ['archive', 'restore']) {
    assert.equal((await call(s, 'u2', 'POST', `/api/goals/${goal.id}/${path}`, {})).status, 404);
    assert.equal((await call(s, 'u1', 'POST', `/api/goals/none/${path}`, {})).status, 404);
  }
  assert.equal((await call(s, 'u1', 'GET', `/api/goals/${goal.id}`)).json.goal.text, '目標');
  await s.close();
});

test('やめる: ホームと今日の提案から外れ、一覧と階は残る。戻すと元に戻る', async () => {
  let t = NOW.getTime();
  const s = await start({ now: () => new Date((t += 1000)) });
  const a = await goalWithRoadmap(s, 'u1', 'やめる目標');
  const b = await goalWithRoadmap(s, 'u1', '続ける目標');
  await s.ctx.store.put('floors', 'f1', { userId: 'u1', sessionId: 'x', floors: 2, at: new Date(t).toISOString() });
  const floorsBefore = (await call(s, 'u1', 'GET', '/api/tower')).json.totalFloors;

  const ar = await call(s, 'u1', 'POST', `/api/goals/${a.goal.id}/archive`, {});
  assert.equal(ar.status, 200);
  assert.equal(typeof ar.json.archivedAt, 'string');
  // 2 回やめても時刻は変わらない
  assert.equal((await call(s, 'u1', 'POST', `/api/goals/${a.goal.id}/archive`, {})).json.archivedAt, ar.json.archivedAt);

  const home = (await call(s, 'u1', 'GET', '/api/home')).json;
  assert.deepEqual(home.goals.map((x) => x.goal.id), [b.goal.id]);
  assert.equal(home.tower.totalFloors, floorsBefore);
  const all = (await call(s, 'u1', 'GET', '/api/goals')).json.goals;
  assert.ok(all.some((g) => g.id === a.goal.id && g.archivedAt));
  assert.deepEqual((await loadCandidates(s.ctx.store, 'u1', NOW)).map((c) => c.goal.id), [b.goal.id]);
  // 道は消えない
  assert.deepEqual((await call(s, 'u1', 'GET', `/api/goals/${a.goal.id}`)).json.roadmap, a.roadmap);

  const rs = await call(s, 'u1', 'POST', `/api/goals/${a.goal.id}/restore`, {});
  assert.equal(rs.status, 200);
  assert.equal('archivedAt' in rs.json, false);
  const home2 = (await call(s, 'u1', 'GET', '/api/home')).json;
  assert.deepEqual(home2.goals.map((x) => x.goal.id).sort(), [a.goal.id, b.goal.id].sort());
  assert.equal((await loadCandidates(s.ctx.store, 'u1', NOW)).length, 2);
  assert.equal(home2.tower.totalFloors, floorsBefore);
  await s.close();
});
