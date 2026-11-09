import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { createMemoryStore } from '../src/store/index.js';
import { C } from '../src/common/collections.js';

const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const T0 = Date.parse('2026-11-06T01:00:00.000Z');

// 時計を動かせるアプリ（保管の at と ctx.now を同じ時計にする）。
async function setup() {
  let t = T0;
  const clock = () => new Date(t);
  const s = await start({ store: createMemoryStore({ now: clock }), now: clock });
  const advance = (min) => (t += min * 60000);
  const call = async (method, path, user, payload) => {
    const res = await fetch(`${s.base}${path}`, {
      method,
      headers: user ? h(user) : {},
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: res.status, json: await res.json() };
  };
  // 目標とロードマップ(チェックポイント c1=todo, c2=done)を直接置く。
  const seed = async (user = 'u1', goalId = 'g1', adopted = 'own') => {
    await s.ctx.store.put(C.goals, goalId, { userId: user, text: '課題を終える', status: 'active' });
    await s.ctx.store.put(C.roadmaps, goalId, {
      goalId,
      adopted,
      checkpoints: [
        { id: 'c1', order: 1, title: 'a', doneMark: 'x', estimateMin: 30, state: 'todo', achievement: null },
        { id: 'c2', order: 2, title: 'b', doneMark: 'y', estimateMin: 30, state: 'done', achievement: 2 },
      ],
    });
  };
  return { s, call, seed, advance };
}
const startBody = { goalId: 'g1', checkpointId: 'c1', oneLine: 'まず第1問を解く' };

test('集中を始めると 201 で Session・focus_start・チェックポイント doing になる', async () => {
  const { s, call, seed } = await setup();
  await seed();
  const r = await call('POST', '/api/sessions', 'u1', startBody);
  assert.equal(r.status, 201);
  assert.equal(r.json.userId, 'u1');
  assert.equal(r.json.oneLine, 'まず第1問を解く');
  assert.equal(r.json.leaveCount, 0);
  assert.equal(r.json.endedAt, undefined);
  const events = await s.ctx.store.list(C.events, { sessionId: r.json.id });
  assert.deepEqual(events.map((e) => e.type), ['focus_start']);
  assert.equal(events[0].userId, 'u1');
  const roadmap = await s.ctx.store.get(C.roadmaps, 'g1');
  assert.equal(roadmap.checkpoints.find((c) => c.id === 'c1').state, 'doing');
  assert.equal(roadmap.checkpoints.find((c) => c.id === 'c2').state, 'done');
  const active = await call('GET', '/api/sessions/active', 'u1');
  assert.equal(active.json.session.id, r.json.id);
  await s.close();
});

test('認証が無いと 401、進行中が無ければ active は null', async () => {
  const { s, call } = await setup();
  assert.equal((await call('GET', '/api/sessions/active')).status, 401);
  assert.equal((await call('POST', '/api/sessions', null, startBody)).status, 401);
  const a = await call('GET', '/api/sessions/active', 'u1');
  assert.equal(a.status, 200);
  assert.deepEqual(a.json, { session: null });
  await s.close();
});

test('入力不正は 400', async () => {
  const { s, call, seed } = await setup();
  await seed();
  const bads = [
    undefined,
    {},
    { ...startBody, goalId: 1 },
    { ...startBody, checkpointId: '' },
    { ...startBody, oneLine: '' },
    { ...startBody, oneLine: '   ' },
    { ...startBody, oneLine: 'あ'.repeat(201) },
  ];
  for (const b of bads) assert.equal((await call('POST', '/api/sessions', 'u1', b)).status, 400, JSON.stringify(b));
  assert.equal((await call('POST', '/api/sessions', 'u1', { ...startBody, oneLine: 'あ'.repeat(200) })).status, 201);
  await s.close();
});

test('他人の目標・無い目標・無いチェックポイント・ロードマップ無しは 404', async () => {
  const { s, call, seed } = await setup();
  await seed('u1');
  assert.equal((await call('POST', '/api/sessions', 'u2', startBody)).status, 404); // 他人の目標
  assert.equal((await call('POST', '/api/sessions', 'u1', { ...startBody, goalId: 'nope' })).status, 404);
  assert.equal((await call('POST', '/api/sessions', 'u1', { ...startBody, checkpointId: 'zz' })).status, 404);
  await s.ctx.store.put(C.goals, 'g9', { userId: 'u1', text: 'x', status: 'active' });
  assert.equal((await call('POST', '/api/sessions', 'u1', { goalId: 'g9', checkpointId: 'c1', oneLine: 'x' })).status, 404);
  assert.equal((await s.ctx.store.list(C.sessions)).length, 0);
  await s.close();
});

test('完了済みチェックポイントと、進行中がある時の開始は 409', async () => {
  const { s, call, seed } = await setup();
  await seed();
  const done = await call('POST', '/api/sessions', 'u1', { ...startBody, checkpointId: 'c2' });
  assert.equal(done.status, 409);
  assert.equal(done.json.error.code, 'conflict');
  assert.equal((await call('POST', '/api/sessions', 'u1', startBody)).status, 201);
  const second = await call('POST', '/api/sessions', 'u1', startBody);
  assert.equal(second.status, 409);
  assert.equal((await s.ctx.store.list(C.sessions)).length, 1);
  await s.close();
});

test('同時に 2 本の開始を送っても進行中は 1 つだけ', async () => {
  const { s, call, seed } = await setup();
  await seed();
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', '/api/sessions', 'u1', startBody)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal((await s.ctx.store.list(C.sessions, { userId: 'u1' })).length, 1);
  await s.close();
});

test('他のユーザーの進行中は開始を妨げない', async () => {
  const { s, call, seed } = await setup();
  await seed('u1', 'g1');
  await seed('u2', 'g2');
  assert.equal((await call('POST', '/api/sessions', 'u1', startBody)).status, 201);
  assert.equal((await call('POST', '/api/sessions', 'u2', { ...startBody, goalId: 'g2' })).status, 201);
  await s.close();
});

test('離れた/戻った: 順序の検査・Event の形・leaveCount', async () => {
  const { s, call, seed, advance } = await setup();
  await seed();
  const { json: session } = await call('POST', '/api/sessions', 'u1', startBody);
  const ev = (type) => call('POST', `/api/sessions/${session.id}/events`, 'u1', { type });

  assert.equal((await ev('return')).status, 409); // 離れていない
  advance(5);
  const leave = await ev('leave');
  assert.equal(leave.status, 201);
  assert.equal(leave.json.type, 'leave');
  assert.equal(leave.json.userId, 'u1');
  assert.equal(leave.json.sessionId, session.id);
  assert.equal(leave.json.at, new Date(T0 + 5 * 60000).toISOString()); // 時刻はサーバー
  assert.equal((await ev('leave')).status, 409); // 二重の leave
  assert.equal((await call('GET', '/api/sessions/active', 'u1')).json.session.leaveCount, 1);
  advance(2);
  assert.equal((await ev('return')).status, 201);
  assert.equal((await ev('return')).status, 409);
  assert.equal((await ev('leave')).status, 201);
  assert.equal((await call('GET', '/api/sessions/active', 'u1')).json.session.leaveCount, 2);
  await s.close();
});

test('events の入力不正は 400、他人の集中は 404', async () => {
  const { s, call, seed } = await setup();
  await seed();
  const { json: session } = await call('POST', '/api/sessions', 'u1', startBody);
  const p = `/api/sessions/${session.id}/events`;
  assert.equal((await call('POST', p, 'u1', { type: 'sleep' })).status, 400);
  assert.equal((await call('POST', p, 'u1', {})).status, 400);
  assert.equal((await call('POST', p, 'u1', { type: 'focus_end' })).status, 400); // 端末から終わりは送れない
  assert.equal((await call('POST', p, 'u2', { type: 'leave' })).status, 404);
  assert.equal((await call('POST', '/api/sessions/nope/events', 'u1', { type: 'leave' })).status, 404);
  assert.equal((await s.ctx.store.list(C.events, { sessionId: session.id })).length, 1); // focus_start だけ
  await s.close();
});

test('終了: 離れていた間を除いた作業時間と階を返し、Floor を保存する', async () => {
  const { s, call, seed, advance } = await setup();
  await seed();
  const { json: session } = await call('POST', '/api/sessions', 'u1', startBody);
  const ev = (type) => call('POST', `/api/sessions/${session.id}/events`, 'u1', { type });
  advance(20);
  await ev('leave');
  advance(5);
  await ev('return');
  advance(15);
  const end = await call('POST', `/api/sessions/${session.id}/end`, 'u1', {});
  assert.equal(end.status, 200);
  assert.equal(end.json.session.focusMin, 35); // 40 分 - 離席 5 分
  assert.equal(end.json.session.leaveCount, 1);
  assert.equal(end.json.session.endedAt, new Date(T0 + 40 * 60000).toISOString());
  const f = end.json.floor;
  assert.equal(f.id, session.id);
  assert.equal(f.userId, 'u1');
  assert.equal(f.focusMin, 35);
  assert.equal(f.timeScore, 35);
  assert.equal(f.floors, 2);
  assert.equal(f.achievementScore, 0);
  assert.equal(f.ownScore, 70); // 自作・加減点なし
  assert.equal(f.color, 'bronze'); // 達成度 0
  assert.equal(f.derivedFrom.length, 4); // start, leave, return, end
  assert.deepEqual(await s.ctx.store.get(C.floors, session.id), f);
  assert.equal((await call('GET', '/api/sessions/active', 'u1')).json.session, null);
  await s.close();
});

test('終了時に離れたままなら leave〜終了も除く', async () => {
  const { s, call, seed, advance } = await setup();
  await seed();
  const { json: session } = await call('POST', '/api/sessions', 'u1', startBody);
  advance(10);
  await call('POST', `/api/sessions/${session.id}/events`, 'u1', { type: 'leave' });
  advance(30);
  const end = await call('POST', `/api/sessions/${session.id}/end`, 'u1', {});
  assert.equal(end.json.session.focusMin, 10);
  assert.equal(end.json.floor.floors, 1);
  await s.close();
});

test('5 分未満は 0 階。終了本文が空でも終われる', async () => {
  const { s, call, seed, advance } = await setup();
  await seed();
  const { json: session } = await call('POST', '/api/sessions', 'u1', startBody);
  advance(4);
  const res = await fetch(`${s.base}/api/sessions/${session.id}/end`, { method: 'POST', headers: { 'x-dev-user': 'u1' } });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.floor.focusMin, 4);
  assert.equal(j.floor.floors, 0);
  await s.close();
});

test('終了済みの end・events は 409、他人の end は 404', async () => {
  const { s, call, seed, advance } = await setup();
  await seed();
  const { json: session } = await call('POST', '/api/sessions', 'u1', startBody);
  advance(10);
  assert.equal((await call('POST', `/api/sessions/${session.id}/end`, 'u2', {})).status, 404);
  assert.equal((await call('POST', `/api/sessions/${session.id}/end`, 'u1', {})).status, 200);
  assert.equal((await call('POST', `/api/sessions/${session.id}/end`, 'u1', {})).status, 409);
  assert.equal((await call('POST', `/api/sessions/${session.id}/events`, 'u1', { type: 'leave' })).status, 409);
  assert.equal((await call('POST', '/api/sessions/nope/end', 'u1', {})).status, 404);
  // 終えた後は同じチェックポイントでまた始められる（doing のままで done ではない）
  assert.equal((await call('POST', '/api/sessions', 'u1', startBody)).status, 201);
  await s.close();
});

test('end は集中中の相談の度合い(help_small・help_medium の Event)を ownScore に反映する', async () => {
  const { s, call, seed, advance } = await setup();
  await seed('u1', 'g1', 'candidate'); // 出どころ 40
  const { json: session } = await call('POST', '/api/sessions', 'u1', startBody);
  // 相談(I-5)が追記する Event を模す
  for (const type of ['help_small', 'help_small', 'help_medium']) {
    await s.ctx.store.append(C.events, { userId: 'u1', sessionId: session.id, type });
  }
  advance(30);
  const end = await call('POST', `/api/sessions/${session.id}/end`, 'u1', {});
  assert.equal(end.json.floor.ownScore, 30); // 40 - 10（small は引かない・11/9）
  assert.equal(end.json.floor.floors, 2);
  await s.close();
});
