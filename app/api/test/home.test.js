import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { createRouter } from '../src/router.js';
import { corsHeaders, parseCorsOrigins } from '../src/http.js';
import { AXES } from '../src/roadmap/axes.js';
import { createMemoryStore } from '../src/store/index.js';

const NOW = new Date('2026-11-05T03:00:00.000Z');
const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const call = async (s, user, method, path, payload) => {
  const res = await fetch(`${s.base}${path}`, {
    method,
    headers: h(user),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json() };
};
const cps = (n = 3) => Array.from({ length: n }, (_, i) => ({ title: `例題 ${i + 1}`, doneMark: `${i + 1} 問解けた`, estimateMin: 30 }));

// 目標 1 つ＋自作のロードマップを作る。
async function goalWithRoadmap(s, user, text) {
  const g = await call(s, user, 'POST', '/api/goals', { text, deadline: '2026-11-12T00:00:00+09:00', minutesPerDay: 30 });
  assert.equal(g.status, 201);
  const r = await call(s, user, 'POST', `/api/goals/${g.json.id}/roadmap`, { source: 'own', why: '自分で決めたい', checkpoints: cps() });
  assert.equal(r.status, 201);
  return { goal: g.json, roadmap: r.json };
}

// ---------- GET /api/home ----------

test('GET /api/home: 初めての人は、空の形で返る（me は作られる）', async () => {
  const s = await start({ now: () => NOW });
  const r = await call(s, 'u1', 'GET', '/api/home');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['active', 'feed', 'friends', 'goals', 'me', 'toReflect', 'tower']);
  assert.deepEqual(r.json.friends, []);
  assert.deepEqual(r.json.toReflect, []);
  assert.equal(r.json.me.streak, 0);
  assert.equal(r.json.me.id, 'u1');
  assert.match(r.json.me.friendCode, /^[A-Z0-9]{6}$/);
  assert.deepEqual(r.json.goals, []);
  assert.equal(r.json.active, null);
  assert.deepEqual(r.json.tower, { totalFloors: 0, streak: 0 });
  assert.deepEqual(r.json.feed, []);
  // 2 回目は同じ me（作り直さない）
  const again = await call(s, 'u1', 'GET', '/api/home');
  assert.deepEqual(again.json.me, r.json.me);
  await s.close();
});

test('GET /api/home: 中身は既存の経路と同じ形', async () => {
  let t = NOW.getTime();
  // 保管側の時計（events・集中の終了時刻）も同じ t に揃える。揃えないと終了時刻が実際の日付になり、
  // 実行した日が NOW の日（JST）と違うと連続記録が 0 になって落ちる（11/6 0 時に実際に落ちた）。
  const s = await start({ now: () => new Date((t += 1000)), store: createMemoryStore({ now: () => new Date(t) }) });
  const me = (await call(s, 'u1', 'GET', '/api/me')).json;
  const a = await goalWithRoadmap(s, 'u1', '二次方程式を解けるようにする');
  const b = await call(s, 'u1', 'POST', '/api/goals', { text: '単語を覚える', deadline: '2026-11-20T00:00:00+09:00', minutesPerDay: 15 });

  // 1 回終えて階を作り、もう 1 回始めて進行中にする
  const s1 = await call(s, 'u1', 'POST', '/api/sessions', { goalId: a.goal.id, checkpointId: a.roadmap.checkpoints[0].id, oneLine: '例題を解く' });
  assert.equal(s1.status, 201);
  t += 20 * 60 * 1000;
  assert.equal((await call(s, 'u1', 'POST', `/api/sessions/${s1.json.id}/end`, {})).status, 200);
  const s2 = await call(s, 'u1', 'POST', '/api/sessions', { goalId: a.goal.id, checkpointId: a.roadmap.checkpoints[1].id, oneLine: '次の例題' });
  assert.equal(s2.status, 201);
  // 階の数が 0 だと tower の比較が弱いので、本人の階を 1 つ直接足す（events の時刻は保管側の時計で、ここでは揃えられない）。
  await s.ctx.store.put('floors', 'extra', { userId: 'u1', sessionId: 'extra', floors: 2, at: new Date(t).toISOString() });

  const home = (await call(s, 'u1', 'GET', '/api/home')).json;
  const goals = (await call(s, 'u1', 'GET', '/api/goals')).json.goals;
  const active = (await call(s, 'u1', 'GET', '/api/sessions/active')).json.session;
  const tower = (await call(s, 'u1', 'GET', '/api/tower')).json;
  const feed = (await call(s, 'u1', 'GET', '/api/feed')).json.items;

  // me は GET /api/me と同じ。連続記録は保存値（いつも 0）でなく、tower と同じ計算で埋める
  assert.equal(me.streak, 0);
  assert.deepEqual(home.me, (await call(s, 'u1', 'GET', '/api/me')).json);
  assert.equal(home.me.streak, tower.streak);
  assert.equal(home.me.streak, 1);
  assert.equal((await call(s, 'u1', 'PUT', '/api/me', { displayName: 'いち' })).json.streak, 1);
  // 終えたがまだ振り返っていない集中が、振り返りの入口として出る（進行中の集中は出ない）
  assert.deepEqual(home.toReflect.map((x) => x.id), [s1.json.id]);
  assert.deepEqual(home.active, active);
  assert.equal(home.active.id, s2.json.id);
  assert.deepEqual(home.tower, { totalFloors: tower.totalFloors, streak: tower.streak });
  assert.ok(home.tower.totalFloors >= 2);
  assert.equal(home.tower.streak, 1);
  assert.deepEqual(home.feed, feed);
  // goals は GET /api/goals と同じ順・同じ goal、roadmap は GET /api/goals/:id と同じ
  assert.deepEqual(home.goals.map((x) => x.goal), goals);
  for (const x of home.goals) {
    const one = (await call(s, 'u1', 'GET', `/api/goals/${x.goal.id}`)).json;
    assert.deepEqual(x, { goal: one.goal, roadmap: one.roadmap });
  }
  assert.equal(home.goals.find((x) => x.goal.id === b.json.id).roadmap, null);
  assert.equal(home.goals.find((x) => x.goal.id === a.goal.id).roadmap.checkpoints[1].state, 'doing');
  await s.close();
});

test('GET /api/home: 他人の目標・集中・階は混ざらない。友達の知らせだけ feed に出る', async () => {
  let t = NOW.getTime();
  const s = await start({ now: () => new Date((t += 1000)) });
  await call(s, 'u1', 'PUT', '/api/me', { displayName: 'いち' });
  await call(s, 'u2', 'PUT', '/api/me', { displayName: 'に' });
  await call(s, 'u3', 'PUT', '/api/me', { displayName: 'さん' });
  // u1 と u2 は友達、u3 は他人
  const code2 = (await call(s, 'u2', 'GET', '/api/me')).json.friendCode;
  const req = await call(s, 'u1', 'POST', '/api/friends', { code: code2 });
  assert.equal((await call(s, 'u2', 'POST', `/api/friends/${req.json.id}/accept`)).status, 200);

  const g2 = await goalWithRoadmap(s, 'u2', 'u2 の目標');
  const g3 = await goalWithRoadmap(s, 'u3', 'u3 の目標');
  const a2 = await call(s, 'u2', 'POST', '/api/sessions', { goalId: g2.goal.id, checkpointId: g2.roadmap.checkpoints[0].id, oneLine: 'u2 が始めた' });
  t += 20 * 60 * 1000;
  await call(s, 'u2', 'POST', `/api/sessions/${a2.json.id}/end`, {});
  await call(s, 'u3', 'POST', '/api/sessions', { goalId: g3.goal.id, checkpointId: g3.roadmap.checkpoints[0].id, oneLine: 'u3 が始めた' });

  const home = (await call(s, 'u1', 'GET', '/api/home')).json;
  assert.equal(home.me.id, 'u1');
  assert.deepEqual(home.goals, []);
  assert.equal(home.active, null);
  assert.deepEqual(home.tower, { totalFloors: 0, streak: 0 });
  assert.deepEqual(home.feed.map((i) => [i.userId, i.oneLine]), [['u2', 'u2 が始めた']]);
  const text = JSON.stringify(home);
  for (const word of ['u2 の目標', 'u3 の目標', 'u3 が始めた', code2]) assert.ok(!text.includes(word), `混ざらない: ${word}`);
  await s.close();
});

test('GET /api/home: ログイン無しは 401', async () => {
  const s = await start();
  const res = await fetch(`${s.base}/api/home`);
  assert.equal(res.status, 401);
  await s.close();
});

// ---------- GET /api/goals/:id の axes ----------

test('GET /api/goals/:id は axes（軸の一覧）も返す', async () => {
  const s = await start({ now: () => NOW });
  const g = await call(s, 'u1', 'POST', '/api/goals', { text: '目標', deadline: '2026-11-12T00:00:00+09:00', minutesPerDay: 30 });
  const r = await call(s, 'u1', 'GET', `/api/goals/${g.json.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.axes, AXES.map(({ key, label }) => ({ key, label })));
  assert.deepEqual(Object.keys(r.json).sort(), ['axes', 'candidates', 'goal', 'pace', 'roadmap']);
  await s.close();
});

// ---------- CORS ----------

const ALLOWED = 'http://localhost:8081';

test('CORS: 既定（CORS_ORIGINS が空）では何も付けず、OPTIONS は今まで通り 404', async () => {
  const s = await start({ env: {} });
  const get = await fetch(`${s.base}/api/health`, { headers: { origin: ALLOWED } });
  assert.equal(get.headers.get('access-control-allow-origin'), null);
  assert.equal(get.headers.get('vary'), null);
  const pre = await fetch(`${s.base}/api/home`, { method: 'OPTIONS', headers: { origin: ALLOWED, 'access-control-request-method': 'GET' } });
  assert.equal(pre.status, 404);
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  await s.close();
});

test('CORS: 許可した Origin にだけ Access-Control-Allow-Origin（エラーの応答にも）', async () => {
  const s = await start({ env: { CORS_ORIGINS: ` ${ALLOWED} , http://127.0.0.1:19006 ` } });
  const ok = await fetch(`${s.base}/api/home`, { headers: { origin: ALLOWED, 'x-dev-user': 'u1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), ALLOWED);
  assert.equal(ok.headers.get('vary'), 'Origin');
  assert.equal(ok.headers.get('access-control-allow-credentials'), null);

  const second = await fetch(`${s.base}/api/health`, { headers: { origin: 'http://127.0.0.1:19006' } });
  assert.equal(second.headers.get('access-control-allow-origin'), 'http://127.0.0.1:19006');

  const unauth = await fetch(`${s.base}/api/home`, { headers: { origin: ALLOWED } });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get('access-control-allow-origin'), ALLOWED);

  for (const other of ['http://evil.example', 'http://localhost:8082', `${ALLOWED}/`, 'null']) {
    const ng = await fetch(`${s.base}/api/health`, { headers: { origin: other } });
    assert.equal(ng.status, 200);
    assert.equal(ng.headers.get('access-control-allow-origin'), null, other);
    assert.equal(ng.headers.get('vary'), 'Origin');
  }
  const none = await fetch(`${s.base}/api/health`);
  assert.equal(none.headers.get('access-control-allow-origin'), null);
  await s.close();
});

test('CORS: OPTIONS の事前確認は、許可した Origin なら 204、ほかは 404', async () => {
  const s = await start({ env: { CORS_ORIGINS: ALLOWED } });
  const pre = await fetch(`${s.base}/api/sessions/abc/tutor`, {
    method: 'OPTIONS',
    headers: { origin: ALLOWED, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-dev-user' },
  });
  assert.equal(pre.status, 204);
  assert.equal(await pre.text(), '');
  assert.equal(pre.headers.get('access-control-allow-origin'), ALLOWED);
  assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type, x-dev-user, authorization');
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, POST, PUT');
  assert.ok(Number(pre.headers.get('access-control-max-age')) > 0);

  const ng = await fetch(`${s.base}/api/home`, { method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'GET' } });
  assert.equal(ng.status, 404);
  assert.equal(ng.headers.get('access-control-allow-origin'), null);
  await s.close();
});

test('CORS: * や null は書かれていても許さない', () => {
  assert.deepEqual(parseCorsOrigins('*'), []);
  assert.deepEqual(parseCorsOrigins('*, null ,http://a.test'), ['http://a.test']);
  assert.deepEqual(parseCorsOrigins(''), []);
  assert.deepEqual(parseCorsOrigins(undefined), []);
  assert.deepEqual(corsHeaders([], 'http://a.test'), {});
  assert.deepEqual(corsHeaders(parseCorsOrigins('*'), 'http://a.test'), {});
});

// ---------- 経路ごとの本文の上限（bodyLimit） ----------

test('bodyLimit: 経路ごとに上限を変えられる。無い経路は既定の 64KB', async () => {
  const echo = (router) => {
    router.add('POST', '/api/small', async ({ body }) => ({ status: 200, body: { n: body.t.length } }));
    router.add('POST', '/api/big', async ({ body }) => ({ status: 200, body: { n: body.t.length } }), { bodyLimit: 6 * 1024 * 1024 });
    router.add('POST', '/api/tiny', async ({ body }) => ({ status: 200, body: { n: body.t.length } }), { bodyLimit: 100 });
  };
  const s = await start({ features: [echo] });
  const post = (path, n) =>
    fetch(`${s.base}${path}`, { method: 'POST', headers: h('u1'), body: JSON.stringify({ t: 'x'.repeat(n) }) });

  const mid = 1024 * 1024; // 1MB: 既定の上限は超え、6MB には収まる
  assert.equal((await post('/api/small', mid)).status, 413);
  const big = await post('/api/big', mid);
  assert.equal(big.status, 200);
  assert.equal((await big.json()).n, mid);
  const over = await post('/api/big', 6 * 1024 * 1024 + 10);
  assert.equal(over.status, 413);
  assert.equal((await over.json()).error.code, 'too_large');
  assert.equal((await post('/api/tiny', 50)).status, 200);
  assert.equal((await post('/api/tiny', 200)).status, 413);
  assert.equal((await post('/api/small', 1000)).status, 200);
  await s.close();
});

test('bodyLimit: 正の整数でなければ add の時点で止める', () => {
  const r = createRouter();
  for (const bad of [0, -1, 1.5, '64', null, Infinity]) {
    assert.throws(() => r.add('POST', '/x', async () => ({}), { bodyLimit: bad }), /bodyLimit/, String(bad));
  }
  r.add('POST', '/ok', async () => ({}), { bodyLimit: 10 });
  assert.equal(r.match('POST', '/ok').bodyLimit, 10);
  r.add('POST', '/default', async () => ({}));
  assert.equal(r.match('POST', '/default').bodyLimit, undefined);
});

test('GET /api/home: toReflect は振り返ったら消え、新しい順で最大 3 件', async () => {
  let t = NOW.getTime();
  const s = await start({ now: () => new Date((t += 1000)), store: createMemoryStore({ now: () => new Date(t) }) });
  for (let i = 0; i < 5; i++) {
    await s.ctx.store.put('sessions', `s${i}`, {
      userId: 'u1',
      goalId: 'g',
      checkpointId: 'c',
      startedAt: new Date(NOW.getTime() + i * 60000).toISOString(),
      endedAt: new Date(NOW.getTime() + i * 60000 + 30000).toISOString(),
      ...(i === 4 && { reflectedAt: new Date(NOW.getTime() + i * 60000 + 40000).toISOString() }),
    });
  }
  await s.ctx.store.put('sessions', 'other', { userId: 'u2', startedAt: NOW.toISOString(), endedAt: NOW.toISOString() });
  const home = (await call(s, 'u1', 'GET', '/api/home')).json;
  assert.deepEqual(home.toReflect.map((x) => x.id), ['s3', 's2', 's1']);
  await s.close();
});
