// 目標の資料（契約 §3.3 GoalDoc・11/9）: 文字だけ・足す・直す・外す・10 件まで・案づくりに渡す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { createGemini } from '../src/gemini/index.js';
import { fakeRoadmap } from '../src/roadmap/candidates.js';
import { goalMaterials, GOAL_MATERIALS_MAX } from '../src/roadmap/goalDocs.js';

const NOW = new Date('2026-11-05T00:00:00.000Z');
const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const call = async (s, user, method, path, payload) => {
  const res = await fetch(`${s.base}${path}`, { method, headers: h(user), body: payload === undefined ? undefined : JSON.stringify(payload) });
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
};

async function boot() {
  const calls = [];
  const gemini = createGemini({ mode: 'fake', fakeResponses: { roadmap: async (input) => (calls.push(input), fakeRoadmap()) } });
  const s = await start({ gemini, now: () => NOW });
  const g = await call(s, 'u1', 'POST', '/api/goals', { text: '線形代数の期末', deadline: '2026-11-20T00:00:00+09:00' });
  return { s, calls, goal: g.json };
}

test('足す・直す・外す。題が無ければ最初の行。他人の目標は 404', async () => {
  const { s, goal } = await boot();
  try {
    const a = await call(s, 'u1', 'POST', `/api/goals/${goal.id}/docs`, { text: '試験範囲\n第 1〜4 章', from: 'goal' });
    assert.equal(a.status, 201);
    assert.equal(a.json.title, '試験範囲');
    assert.equal(a.json.from, 'goal');
    const got = await call(s, 'u1', 'GET', `/api/goals/${goal.id}`);
    assert.deepEqual(got.json.goal.docs.map((d) => d.id), [a.json.id]);

    const u = await call(s, 'u1', 'PUT', `/api/goals/${goal.id}/docs/${a.json.id}`, { text: '第 1〜5 章' });
    assert.equal(u.status, 200);
    assert.equal(u.json.text, '第 1〜5 章');
    assert.ok(u.json.updatedAt);
    assert.equal((await call(s, 'u1', 'PUT', `/api/goals/${goal.id}/docs/${a.json.id}`, {})).status, 400);
    assert.equal((await call(s, 'u1', 'PUT', `/api/goals/${goal.id}/docs/nope`, { text: 'x' })).status, 404);

    assert.equal((await call(s, 'u2', 'POST', `/api/goals/${goal.id}/docs`, { text: 'x', from: 'goal' })).status, 404);
    assert.equal((await call(s, 'u1', 'POST', `/api/goals/${goal.id}/docs`, { text: '', from: 'goal' })).status, 400);
    assert.equal((await call(s, 'u1', 'POST', `/api/goals/${goal.id}/docs`, { text: 'x', from: 'other' })).status, 400);

    assert.equal((await call(s, 'u1', 'DELETE', `/api/goals/${goal.id}/docs/${a.json.id}`)).status, 204);
    assert.equal((await call(s, 'u1', 'DELETE', `/api/goals/${goal.id}/docs/${a.json.id}`)).status, 204);
    assert.deepEqual((await call(s, 'u1', 'GET', `/api/goals/${goal.id}`)).json.goal.docs, []);
  } finally {
    await s.close();
  }
});

test('10 件まで（11 件目は 409）', async () => {
  const { s, goal } = await boot();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await call(s, 'u1', 'POST', `/api/goals/${goal.id}/docs`, { text: `資料${i}`, from: 'plan' })).status, 201);
    assert.equal((await call(s, 'u1', 'POST', `/api/goals/${goal.id}/docs`, { text: '11', from: 'plan' })).status, 409);
  } finally {
    await s.close();
  }
});

test('案づくりに目標の資料を渡す', async () => {
  const { s, calls, goal } = await boot();
  try {
    await call(s, 'u1', 'POST', `/api/goals/${goal.id}/docs`, { text: '教科書 第 4 章の例題 8 問', from: 'plan' });
    assert.equal((await call(s, 'u1', 'POST', `/api/goals/${goal.id}/candidates`, {})).status, 200);
    assert.match(JSON.stringify(calls.at(-1)), /第 4 章の例題 8 問/);
  } finally {
    await s.close();
  }
});

test('goalMaterials: 前からの materials と docs をつなぎ、上限を超えたら古い方から削る', () => {
  assert.equal(goalMaterials({}), '');
  assert.match(goalMaterials({ materials: '範囲', docs: [{ title: 'a', text: 'A' }] }), /範囲[\s\S]*【a】\nA/);
  const big = 'x'.repeat(2000);
  const docs = Array.from({ length: 5 }, (_, i) => ({ title: `d${i}`, text: big }));
  const out = goalMaterials({ docs });
  assert.ok([...out].length <= GOAL_MATERIALS_MAX);
  assert.ok(!out.includes('【d0】'));
  assert.ok(out.includes('【d4】'));
});
