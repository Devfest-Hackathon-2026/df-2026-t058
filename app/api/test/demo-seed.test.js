import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { C } from '../src/common/collections.js';
import { SEED_GOAL_TEXT } from '../src/demo/seed.js';

const H = { 'x-dev-user': 'u1', 'content-type': 'application/json' };
const seed = (s, user = 'u1') =>
  fetch(`${s.base}/api/demo/seed`, { method: 'POST', headers: { ...H, 'x-dev-user': user }, body: '{}' });
const get = async (s, path) => (await fetch(`${s.base}${path}`, { headers: H })).json();

test('DEMO_SEED が無い時は、health に demoSeed が無く、経路は 404', async () => {
  const s = await start();
  assert.deepEqual(await (await fetch(`${s.base}/api/health`)).json(), { ok: true, auth: 'fake', store: 'memory' });
  assert.equal((await seed(s)).status, 404);
  await s.close();
});

test('DEMO_SEED=on で health に demoSeed: true（他の項目はそのまま）', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  assert.deepEqual(await (await fetch(`${s.base}/api/health`)).json(), { ok: true, auth: 'fake', store: 'memory', demoSeed: true });
  await s.close();
});

test('見本: 目標 1・チェックポイント 4（3 完了）・階 1/2/1・銅銀金・連続 3 日', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  const res = await seed(s);
  assert.equal(res.status, 201);

  const { goals } = await get(s, '/api/goals');
  assert.equal(goals.length, 4);
  assert.equal(new Set(goals.map((g) => g.deadline)).size, 4);
  const main = goals.find((g) => g.text === SEED_GOAL_TEXT);
  assert.ok(main);

  const { roadmap } = await get(s, `/api/goals/${main.id}`);
  assert.equal(roadmap.checkpoints.length, 4);
  const done = roadmap.checkpoints.filter((c) => c.state === 'done');
  assert.deepEqual(done.map((c) => c.achievement), [0, 1, 3]);

  const tower = await get(s, '/api/tower');
  assert.deepEqual(tower.floors.map((f) => f.floors), [1, 2, 1]);
  assert.deepEqual(tower.floors.map((f) => f.color), ['bronze', 'silver', 'gold']);
  assert.equal(tower.totalFloors, 4);
  assert.equal(tower.streak, 3);

  const home = await get(s, '/api/home');
  assert.equal(home.me.streak, 3);
  assert.equal(home.toReflect.length, 0);
  await s.close();
});

test('すでに目標がある人には入れない（409 conflict）。二度目も同じ', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  assert.equal((await seed(s)).status, 201);
  const again = await seed(s);
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, 'conflict');
  assert.equal((await get(s, '/api/goals')).goals.length, 4);
  await s.close();
});

test('足した目標 3 つ: 道・完了・今日の分・おまかせ。集中の記録は主の目標だけ', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  await seed(s);
  const { goals } = await get(s, '/api/goals');
  const extras = goals.filter((g) => g.text !== SEED_GOAL_TEXT);
  assert.equal(extras.length, 3);
  assert.ok(extras.every((g) => g.minutesPerDay === null));
  const expected = [
    { days: 2, cps: 5, done: 1, today: 25 },
    { days: 9, cps: 4, done: 0, today: 40 },
    { days: 21, cps: 6, done: 2, today: 30 },
  ];
  const sorted = extras.sort((a, b) => a.deadline.localeCompare(b.deadline));
  for (const [i, e] of expected.entries()) {
    const g = sorted[i];
    const dayDiff = Math.round((Date.parse(g.deadline) - Date.now()) / 86400000);
    assert.ok(Math.abs(dayDiff - e.days) <= 1);
    const { roadmap } = await get(s, `/api/goals/${g.id}`);
    assert.equal(roadmap.checkpoints.length, e.cps);
    assert.equal(roadmap.checkpoints.filter((c) => c.state === 'done').length, e.done);
    assert.equal(roadmap.checkpoints.find((c) => c.state !== 'done').estimateMin, e.today);
  }
  const extraIds = new Set(extras.map((g) => g.id));
  const sessions = await s.ctx.store.list(C.sessions);
  assert.ok(!sessions.some((x) => extraIds.has(x.goalId)));
  await s.close();
});

test('他の人の見本は、その人だけに入る', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  assert.equal((await seed(s, 'u1')).status, 201);
  const other = await (await fetch(`${s.base}/api/goals`, { headers: { ...H, 'x-dev-user': 'u2' } })).json();
  assert.equal(other.goals.length, 0);
  await s.close();
});

const getAs = async (s, path, user) => (await fetch(`${s.base}${path}`, { headers: { ...H, 'x-dev-user': user } })).json();

test('見本の友達: 2 人・承認済み・1 人が集中中・フィードに「始めた」が 1 件', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  await seed(s);
  const { friends } = await get(s, '/api/friends');
  assert.equal(friends.length, 2);
  assert.deepEqual(friends.map((f) => f.user.displayName).sort(), ['こうた', 'みどり']);
  assert.ok(friends.every((f) => f.friendship.status === 'accepted'));
  assert.ok(friends.every((f) => f.user.id.startsWith('demo-friend-')));
  const active = friends.filter((f) => f.activeNow);
  assert.deepEqual(active.map((f) => f.user.displayName), ['こうた']);

  const { items } = await get(s, '/api/feed');
  assert.equal(items.length, 1);
  assert.equal(items[0].displayName, 'こうた');
  assert.ok(items[0].oneLine);
  const agoMin = (Date.now() - Date.parse(items[0].at)) / 60000;
  assert.ok(agoMin > 1 && agoMin < 30);

  const floors = (await s.ctx.store.list(C.floors)).filter((f) => f.userId?.startsWith?.('demo-friend-'));
  assert.ok(floors.length >= 4);
  await s.close();
});

test('焦りの強さは全員 strong 固定（11/9）: off を送っても、見本の友達のフィードは出る', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  await seed(s);
  await fetch(`${s.base}/api/me`, { method: 'PUT', headers: H, body: JSON.stringify({ nudgeLevel: 'off' }) });
  assert.ok((await get(s, '/api/feed')).items.length > 0);
  await s.close();
});

test('見本の友達は、ID が u_ で始まるログインの形と混ざらない', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  await seed(s);
  const users = (await s.ctx.store.list(C.users)).filter((u) => u.displayName === 'みどり' || u.displayName === 'こうた');
  assert.equal(users.length, 2);
  assert.ok(users.every((u) => !u.id.startsWith('u_')));
  await s.close();
});

test('別の本人が見本を入れても、見本の友達は増えず、その人にも友達として結ぶ', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  await seed(s, 'u1');
  await seed(s, 'u2');
  const demoUsers = (await s.ctx.store.list(C.users)).filter((u) => u.id.startsWith('demo-friend-'));
  assert.equal(demoUsers.length, 2);
  const demoSessions = (await s.ctx.store.list(C.sessions)).filter((x) => x.userId.startsWith('demo-friend-'));
  assert.equal(demoSessions.length, 5);
  assert.equal((await getAs(s, '/api/friends', 'u1')).friends.length, 2);
  assert.equal((await getAs(s, '/api/friends', 'u2')).friends.length, 2);
  await s.close();
});

test('events は作らない（追記のみの規則に触れない）', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  await seed(s);
  assert.equal((await s.ctx.store.list(C.events)).length, 0);
  await s.close();
});
