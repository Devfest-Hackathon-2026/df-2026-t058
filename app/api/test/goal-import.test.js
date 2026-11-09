import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './helpers.js';
import { loadCandidates } from '../src/today/pick.js';
import { computeStats } from '../src/weekly/routes.js';

// 取り込んだ課題を「タスク」にする（#261・契約 §3.3 POST /api/goals/import）。AI は呼ばない。
const NOW = new Date('2026-11-08T03:00:00.000Z');
const SHAPES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'contract-shapes.json'), 'utf8'));
// 見本（contract-shapes.json）のキーだけを持ち、必須のキーがそろっているか（型の細かい検査は contract-shapes.test.js）。
const objectErrors = (spec, v, where) => [
  ...Object.keys(spec.required).filter((k) => !(k in v)).map((k) => `${where}.${k}: 無い`),
  ...Object.keys(v).filter((k) => !(k in spec.required) && !(k in spec.optional)).map((k) => `${where}.${k}: 契約に無いキー`),
];
const call = async (s, user, method, path, payload) => {
  const res = await fetch(`${s.base}${path}`, {
    method,
    headers: { 'x-dev-user': user, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json() };
};
const item = (i, extra = {}) => ({ title: `課題 ${i}`, deadline: '2026-11-12T23:59:00+09:00', ...extra });

test('作成: kind task の目標と、チェックポイント 1 つの既定のロードマップ（auto・理由なし）', async () => {
  let t = NOW.getTime();
  const s = await start({ now: () => new Date((t += 1000)) });
  let geminiCalls = 0;
  const gen = s.ctx.gemini.generate.bind(s.ctx.gemini);
  s.ctx.gemini.generate = (...a) => ((geminiCalls += 1), gen(...a));
  const r = await call(s, 'u1', 'POST', '/api/goals/import', {
    items: [item(1, { minutes: 45, notes: '　p.12〜15　' }), { title: '　レポート　', deadline: null }],
  });
  assert.equal(r.status, 201);
  assert.equal(geminiCalls, 0);
  assert.equal(r.json.goals.length, 2);
  for (const g of r.json.goals) assert.deepEqual(objectErrors(SHAPES.models.Goal, g, 'goal'), []);
  const [a, b] = r.json.goals;
  assert.equal(a.kind, 'task');
  assert.equal(a.text, '課題 1');
  assert.equal(a.deadline, new Date('2026-11-12T23:59:00+09:00').toISOString());
  assert.equal(a.materials, 'p.12〜15');
  assert.equal(a.minutesPerDay, null);
  assert.equal(b.text, 'レポート');
  assert.equal(b.deadline, null);
  assert.equal('materials' in b, false);

  const one = (await call(s, 'u1', 'GET', `/api/goals/${a.id}`)).json;
  assert.deepEqual(objectErrors(SHAPES.models.Roadmap, one.roadmap, 'roadmap'), []);
  assert.equal(one.roadmap.adopted, 'auto');
  assert.equal(one.roadmap.why, '');
  assert.equal('editRatio' in one.roadmap, false);
  assert.equal(one.roadmap.checkpoints.length, 1);
  const cp = one.roadmap.checkpoints[0];
  assert.deepEqual({ order: cp.order, title: cp.title, doneMark: cp.doneMark, estimateMin: cp.estimateMin, state: cp.state }, {
    order: 1, title: '課題 1', doneMark: '終わった', estimateMin: 45, state: 'todo',
  });
  const other = (await call(s, 'u1', 'GET', `/api/goals/${b.id}`)).json.roadmap;
  assert.equal(other.checkpoints[0].estimateMin, 30); // 見積りが無い時の既定

  // ホームにも出る
  const home = (await call(s, 'u1', 'GET', '/api/home')).json;
  assert.equal(home.goals.length, 2);
  await s.close();
});

test('検査: 件数 1〜10・題 1〜200・見積り 5〜600・メモ 500 字まで・期限は ISO か null', async () => {
  const s = await start({ now: () => NOW });
  const bads = [
    {},
    { items: [] },
    { items: Array.from({ length: 11 }, (_, i) => item(i)) },
    { items: [{ title: '', deadline: null }] },
    { items: [{ title: 'あ'.repeat(201), deadline: null }] },
    { items: [{ title: 'x' }] }, // 期限のキーが無い
    { items: [{ title: 'x', deadline: 'きのう' }] },
    { items: [item(1, { minutes: 4 })] },
    { items: [item(1, { minutes: 601 })] },
    { items: [item(1, { minutes: '30' })] },
    { items: [item(1, { notes: 'あ'.repeat(501) })] },
    { items: ['x'] },
  ];
  for (const b of bads) {
    const r = await call(s, 'u1', 'POST', '/api/goals/import', b);
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80));
    assert.equal(r.json.error.code, 'invalid_argument');
  }
  assert.equal((await call(s, 'u1', 'GET', '/api/goals')).json.goals.length, 0);
  const ten = await call(s, 'u1', 'POST', '/api/goals/import', { items: Array.from({ length: 10 }, (_, i) => item(i)) });
  assert.equal(ten.status, 201);
  assert.equal(ten.json.goals.length, 10);
  await s.close();
});

test('上限: 目標と合わせて 20 件を超える取り込みは 409（1 件も作らない）', async () => {
  const s = await start({ now: () => NOW });
  await call(s, 'u1', 'POST', '/api/goals/import', { items: Array.from({ length: 10 }, (_, i) => item(i)) });
  await call(s, 'u1', 'POST', '/api/goals/import', { items: Array.from({ length: 5 }, (_, i) => item(i)) });
  const r = await call(s, 'u1', 'POST', '/api/goals/import', { items: Array.from({ length: 6 }, (_, i) => item(i)) });
  assert.equal(r.status, 409);
  assert.equal((await call(s, 'u1', 'GET', '/api/goals')).json.goals.length, 15);
  await s.close();
});

test('他人のデータ: 取り込んだタスクは本人にだけ見え、他人は読めない・集中できない', async () => {
  const s = await start({ now: () => NOW });
  const { goals } = (await call(s, 'u1', 'POST', '/api/goals/import', { items: [item(1)] })).json;
  const id = goals[0].id;
  assert.equal((await call(s, 'u2', 'GET', `/api/goals/${id}`)).status, 404);
  assert.equal((await call(s, 'u2', 'GET', '/api/goals')).json.goals.length, 0);
  assert.equal((await loadCandidates(s.ctx.store, 'u2', NOW)).length, 0);
  const cp = (await call(s, 'u1', 'GET', `/api/goals/${id}`)).json.roadmap.checkpoints[0].id;
  assert.equal((await call(s, 'u2', 'POST', '/api/sessions', { goalId: id, checkpointId: cp, oneLine: 'x' })).status, 404);
  await s.close();
});

test('why の要否: 目標は今までどおり必須。タスクは省ける（確定済みなので 409 になる）', async () => {
  const s = await start({ now: () => NOW });
  const cps = [1, 2, 3].map((i) => ({ title: `例 ${i}`, doneMark: 'できた', estimateMin: 30 }));
  const g = (await call(s, 'u1', 'POST', '/api/goals', { text: '目標', deadline: '2026-11-12T00:00:00+09:00' })).json;
  assert.equal('kind' in g, false); // 既存の目標は kind 無し＝goal（後方互換）
  const noWhy = await call(s, 'u1', 'POST', `/api/goals/${g.id}/roadmap`, { source: 'own', checkpoints: cps });
  assert.equal(noWhy.status, 400);
  assert.equal((await call(s, 'u1', 'POST', `/api/goals/${g.id}/roadmap`, { source: 'own', why: '', checkpoints: cps })).status, 400);
  const { goals } = (await call(s, 'u1', 'POST', '/api/goals/import', { items: [item(1)] })).json;
  const task = await call(s, 'u1', 'POST', `/api/goals/${goals[0].id}/roadmap`, { source: 'own', checkpoints: cps });
  assert.equal(task.status, 409); // why の検査は通り、確定は 1 回だけ
  // タスクにまだ道が無い時（途中で切れた等）は、理由なしで確定できる
  await s.ctx.store.put('goals', 'bare', { ...goals[0], id: 'bare' });
  const ok = await call(s, 'u1', 'POST', '/api/goals/bare/roadmap', { source: 'own', checkpoints: cps });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.why, '');
  await s.close();
});

test('今日の提案はタスクも拾う（期限の近い順・期限なしは後ろ）', async () => {
  let t = NOW.getTime();
  const s = await start({ now: () => new Date((t += 1000)) });
  await call(s, 'u1', 'POST', '/api/goals/import', {
    items: [{ title: '期限なし', deadline: null }, item('近い', { deadline: '2026-11-09T23:59:00+09:00', minutes: 20 })],
  });
  const cands = await loadCandidates(s.ctx.store, 'u1', NOW);
  assert.deepEqual(cands.map((c) => c.checkpoint.title), ['課題 近い', '期限なし']);
  assert.equal(cands[0]?.minutes, 20);
  assert.equal(cands[1]?.days, null);
  const today = await call(s, 'u1', 'POST', '/api/today', { minutes: 60 });
  assert.equal(today.status, 200);
  assert.ok(today.json.proposals.length > 0);
  await s.close();
});

test('自分で決めた度の平均（週のまとめ）から、タスク（auto）の集中を外す', () => {
  const at = '2026-11-08T01:00:00.000Z';
  const sessions = [
    { id: 's1', goalId: 'g1', endedAt: at },
    { id: 's2', goalId: 't1', endedAt: at },
  ];
  const floors = [
    { sessionId: 's1', ownScore: 70, focusMin: 10, floors: 1 },
    { sessionId: 's2', ownScore: 40, focusMin: 10, floors: 1 },
  ];
  const roadmaps = [
    { goalId: 'g1', adopted: 'own' },
    { goalId: 't1', adopted: 'auto' },
  ];
  const from = new Date('2026-11-02T00:00:00Z');
  const to = new Date('2026-11-09T00:00:00Z');
  const withTask = computeStats({ sessions, events: [], floors, roadmaps }, from, to);
  assert.equal(withTask.selfDecided, 70);
  assert.equal(withTask.sessions, 2); // 回数・時間には数える
  assert.equal(withTask.focusMinutes, 20);
  const onlyTask = computeStats({ sessions: [sessions[1]], events: [], floors, roadmaps }, from, to);
  assert.equal(onlyTask.selfDecided, null);
  // roadmaps を渡さない（今までの呼び方）は今までどおり
  assert.equal(computeStats({ sessions, events: [], floors }, from, to).selfDecided, 55);
});
