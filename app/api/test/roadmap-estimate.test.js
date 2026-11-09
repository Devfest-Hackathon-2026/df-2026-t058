import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { createGemini } from '../src/gemini/index.js';
import { demoFakeResponses } from '../src/gemini/fake.js';
import { createLimiter } from '../src/limiter.js';
import { fakeRoadmap } from '../src/roadmap/candidates.js';
import { ESTIMATE_DEFAULT_MIN, fillEstimates } from '../src/roadmap/estimate.js';

// #268: 分の無い行はサーバーが Gemini（purpose extract）で見積もる。失敗は 30 分。
const NOW = new Date('2026-11-05T00:00:00.000Z');
const h = { 'x-dev-user': 'u1', 'content-type': 'application/json' };
const SECRET = '秘密っぽい目標の文';
const goalBody = { text: SECRET, deadline: '2026-11-20T00:00:00+09:00', minutesPerDay: 60 };

async function boot(estimateFn, { limiter } = {}) {
  const calls = [];
  const gemini = createGemini({
    mode: 'fake',
    limiter,
    fakeResponses: {
      roadmap: async () => fakeRoadmap(),
      extract: async (input) => (calls.push(input), estimateFn(input)),
    },
  });
  const s = await start({ gemini, now: () => NOW });
  const call = async (method, path, payload) => {
    const res = await fetch(`${s.base}${path}`, { method, headers: h, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: res.status, json: await res.json() };
  };
  const g = (await call('POST', '/api/goals', goalBody)).json;
  const c = (await call('POST', `/api/goals/${g.id}/candidates`, {})).json.candidates;
  return { s, call, g, c, calls };
}
const pick = (cps) => cps.map(({ title, doneMark, estimateMin }) => ({ title, doneMark, estimateMin }));

test('edited: 分の無い行だけ見積りが入る（1 回の呼び出し・元の行はそのまま）', async () => {
  const { s, call, g, c, calls } = await boot(async (input) => {
    const n = (input.user.match(/^\d+\.$/gm) || []).length;
    return { minutes: Array.from({ length: n }, (_, i) => 100 + i) };
  });
  const edited = pick(c[0].checkpoints);
  edited[1] = { title: '直した題', doneMark: '直した目印' }; // 題を直した行は分を付けない
  edited.push({ title: '足した行', doneMark: '足した目印' });
  const r = await call('POST', `/api/goals/${g.id}/roadmap`, { source: 'edited', candidateId: c[0].id, why: '直した', checkpoints: edited });
  assert.equal(r.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'estimate');
  assert.ok(calls[0].user.includes('<user_text>') && calls[0].user.includes('直した題') && calls[0].user.includes(SECRET));
  const mins = r.json.checkpoints.map((p) => p.estimateMin);
  const n = edited.length;
  assert.deepEqual(mins, edited.map((e, i) => e.estimateMin ?? 100 + i));
  assert.equal(mins.length, n);
  await s.close();
});

test('全部の行に分がある時は Gemini を呼ばない／candidate は元の分のまま', async () => {
  const { s, call, g, c, calls } = await boot(async () => ({ minutes: [] }));
  const own = [1, 2, 3].map((i) => ({ title: `t${i}`, doneMark: `d${i}`, estimateMin: 15 }));
  const r = await call('POST', `/api/goals/${g.id}/roadmap`, { source: 'own', why: 'w', checkpoints: own });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.checkpoints.map((p) => p.estimateMin), [15, 15, 15]);
  assert.equal(calls.length, 0);
  await s.close();

  const b = await boot(async () => ({ minutes: [] }));
  const r2 = await b.call('POST', `/api/goals/${b.g.id}/roadmap`, { source: 'candidate', candidateId: b.c[1].id, why: 'w' });
  assert.equal(r2.status, 201);
  assert.deepEqual(r2.json.checkpoints.map((p) => p.estimateMin), b.c[1].checkpoints.map((p) => p.estimateMin));
  assert.equal(b.calls.length, 0);
  await b.s.close();
  void c;
});

test('失敗・行数の不一致・範囲外・制限は既定の 30 分で埋め、確定は止めない', async () => {
  const fns = {
    失敗: async () => {
      throw new Error('boom');
    },
    行数違い: async () => ({ minutes: [10] }),
    範囲外: async () => ({ minutes: [10, 10, 999] }),
    形違い: async () => ({ other: 1 }),
  };
  for (const [name, fn] of Object.entries(fns)) {
    const { s, call, g } = await boot(fn);
    const own = [1, 2, 3].map((i) => ({ title: `t${i}`, doneMark: `d${i}` }));
    const r = await call('POST', `/api/goals/${g.id}/roadmap`, { source: 'own', why: 'w', checkpoints: own });
    assert.equal(r.status, 201, name);
    assert.deepEqual(r.json.checkpoints.map((p) => p.estimateMin), [30, 30, 30], name);
    await s.close();
  }
  // 点の制限: 案づくりで使い切った後でも、確定は 30 分で通る
  const limiter = createLimiter({ perUserPerDay: 1, totalPerDay: 100 });
  const { s, call, g } = await boot(async () => ({ minutes: [20, 20, 20] }), { limiter });
  const own = [1, 2, 3].map((i) => ({ title: `t${i}`, doneMark: `d${i}` }));
  const r = await call('POST', `/api/goals/${g.id}/roadmap`, { source: 'own', why: 'w', checkpoints: own });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.checkpoints.map((p) => p.estimateMin), [30, 30, 30]);
  await s.close();
});

test('fake の見本（demoFakeResponses）でも行の数だけ分が出る／ログに本文を出さない', async () => {
  const gemini = createGemini({ mode: 'fake', fakeResponses: demoFakeResponses });
  const cps = [1, 2, 3, 4].map((i) => ({ title: `題${SECRET}${i}`, doneMark: `目印${i}` }));
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => lines.push(a.map(String).join(' '));
  let out;
  try {
    out = await fillEstimates({ gemini, goal: { text: SECRET, deadline: '2026-11-20' }, checkpoints: cps, userId: 'u1' });
    const bad = createGemini({ mode: 'fake', fakeResponses: { extract: async () => ({ minutes: 'x' }) } });
    const fallback = await fillEstimates({ gemini: bad, goal: { text: SECRET, deadline: null }, checkpoints: cps, userId: 'u1' });
    assert.deepEqual(fallback.map((p) => p.estimateMin), [1, 2, 3, 4].map(() => ESTIMATE_DEFAULT_MIN));
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(out.map((p) => p.estimateMin), [30, 30, 30, 30]);
  assert.ok(lines.every((l) => !l.includes(SECRET) && !l.includes('目印')), 'ログに本文が出ない');
});
