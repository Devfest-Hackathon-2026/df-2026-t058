import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { start } from './helpers.js';
import { C } from '../src/common/collections.js';
import { COL } from '../src/push/devices.js';
import { FCM_TITLE, MAX_BODY, NUDGE_MESSAGE, friendStartMessage, nudgeBody, nudgeMessage } from '../src/push/fcm.js';
import { createMemoryStore } from '../src/store/index.js';

// スマホへの通知（FCM・契約 §3.7d・#298）の試験。fetch は差し替え（FCM・メタデータサーバーは呼ばない）。
// トークン・合図の鍵は実行時に作る（本物の形の値を書かない）。
const NOW = new Date('2026-11-08T03:00:00.000Z'); // 日本時間 11/8 12:00
const rand = (n = 16) => randomBytes(n).toString('hex');
const META = 'http://metadata.google.internal/';
const FCM = 'https://fcm.googleapis.com/v1/projects/test-project/messages:send';

const call = async (base, method, path, { user = 'u1', body, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user && { 'x-dev-user': user }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

// reply(token) → { status, body } で FCM の返事を決める。meta: false でメタデータが取れない。
async function setup({ reply = () => ({ status: 200 }), meta = true } = {}) {
  const clock = { at: NOW };
  const store = createMemoryStore({ now: () => clock.at });
  const sent = [];
  const metaCalls = [];
  const access = rand();
  const pushFetch = async (url, init) => {
    if (url.startsWith(META)) {
      metaCalls.push(init);
      if (!meta) throw new TypeError('fetch failed');
      return Response.json({ access_token: access, expires_in: 3600 });
    }
    const msg = JSON.parse(init.body).message;
    sent.push({ url, init, msg });
    const r = reply(msg.token);
    return new Response(r.body ? JSON.stringify(r.body) : '{}', { status: r.status });
  };
  const secret = rand();
  const app = await start({ store, pushFetch, now: () => clock.at }, { FCM_PROJECT_ID: 'test-project', TICK_SECRET: secret });
  const tick = () => call(app.base, 'POST', '/api/push/tick', { user: null, body: {}, headers: { 'x-tick-secret': secret } });
  const register = (user, token) => call(app.base, 'POST', '/api/push/device', { user, body: { token, platform: 'android' } });
  const befriend = (a, b) => store.put(C.friendships, `${a}-${b}`, { userId: a, friendId: b, status: 'accepted', notifyOnStart: true });
  // 本人の目標と道を置いて、POST /api/sessions で集中を始める
  const startFocus = async (user) => {
    await store.put(C.goals, `g-${user}`, { userId: user, text: 't', status: 'active' });
    await store.put(C.roadmaps, `g-${user}`, { goalId: `g-${user}`, checkpoints: [{ id: 'c1', state: 'todo' }] });
    const r = await call(app.base, 'POST', '/api/sessions', { user, body: { goalId: `g-${user}`, checkpointId: 'c1', oneLine: '例題' } });
    assert.equal(r.status, 201);
    await app.ctx.fcm.idle();
    return r.json;
  };
  return { ...app, store, sent, metaCalls, access, clock, tick, register, befriend, startFocus };
}

const liveDevices = async (store, userId) => (await store.list(COL.devices, { userId })).filter((d) => !d.deletedAt);

test('FCM_PROJECT_ID が無い時、/api/push/device は 404・集中の開始で何も送らない', async () => {
  const sent = [];
  const app = await start({ pushFetch: async (url) => (sent.push(url), new Response('{}')) });
  try {
    assert.equal((await call(app.base, 'POST', '/api/push/device', { body: { token: rand(), platform: 'android' } })).status, 404);
    assert.equal((await call(app.base, 'DELETE', '/api/push/device', { body: { token: rand() } })).status, 404);
    assert.equal(app.ctx.fcm, undefined);
    assert.equal(sent.length, 0);
  } finally {
    await app.close();
  }
});

test('文: 題は固定・本文は 40 字以内・名前は 20 字まで・無ければ「友達」・route は相対パス', () => {
  assert.equal(FCM_TITLE, 'モル塔');
  assert.equal(friendStartMessage('はると').body, 'はるとさんが取り組みを始めました');
  assert.equal(friendStartMessage('').body, '友達が取り組みを始めました');
  assert.equal(friendStartMessage(null).body, '友達が取り組みを始めました');
  const long = friendStartMessage('あ'.repeat(30));
  assert.ok([...long.body].length <= MAX_BODY);
  assert.match(long.body, /…さんが/);
  assert.ok([...NUDGE_MESSAGE.body].length <= MAX_BODY);
  for (const m of [long, NUDGE_MESSAGE]) assert.match(m.route, /^\/[a-z]*$/); // 外部 URL は入れない
  assert.ok(!/[A-Za-z]/.test(friendStartMessage('はると').body + NUDGE_MESSAGE.body + FCM_TITLE)); // 固定の文に英字を使わない
  // 夜の催促: 今日始めた友達の名前を入れる（10 字まで・本文 40 字以内）。いなければ固定の文
  assert.equal(nudgeBody('ゆうき'), 'ゆうきさんは今日もう始めています。5 分だけやりませんか');
  assert.equal(nudgeBody(null), NUDGE_MESSAGE.body);
  assert.ok([...nudgeBody('あ'.repeat(30))].length <= MAX_BODY);
  assert.equal(nudgeMessage(null), NUDGE_MESSAGE);
  assert.equal(nudgeMessage('ゆうき').route, '/');
});

test('登録: 要認証・形の検査・同じ token は 1 件（登録した人に移る）・削除は無くても 204', async () => {
  const app = await setup();
  try {
    const t1 = rand();
    assert.equal((await call(app.base, 'POST', '/api/push/device', { user: null, body: { token: t1, platform: 'android' } })).status, 401);
    assert.equal((await call(app.base, 'POST', '/api/push/device', { body: { token: t1, platform: 'ios' } })).status, 400);
    assert.equal((await call(app.base, 'POST', '/api/push/device', { body: { token: '', platform: 'android' } })).status, 400);
    assert.equal((await call(app.base, 'POST', '/api/push/device', { body: { token: 'x'.repeat(4097), platform: 'android' } })).status, 400);
    assert.equal((await app.register('u1', t1)).status, 204);
    assert.equal((await app.register('u1', t1)).status, 204);
    assert.equal((await liveDevices(app.store, 'u1')).length, 1);
    assert.equal((await app.register('u2', t1)).status, 204); // 同じ端末を別の人が登録 → 移る
    assert.equal((await liveDevices(app.store, 'u1')).length, 0);
    assert.equal((await liveDevices(app.store, 'u2')).length, 1);
    // 他の人の削除は効かない（204 だが残る）・本人の削除で消える・無い token も 204
    assert.equal((await call(app.base, 'DELETE', '/api/push/device', { user: 'u1', body: { token: t1 } })).status, 204);
    assert.equal((await liveDevices(app.store, 'u2')).length, 1);
    assert.equal((await call(app.base, 'DELETE', '/api/push/device', { user: 'u2', body: { token: t1 } })).status, 204);
    assert.equal((await liveDevices(app.store, 'u2')).length, 0);
    assert.equal((await call(app.base, 'DELETE', '/api/push/device', { user: 'u2', body: { token: rand() } })).status, 204);
  } finally {
    await app.close();
  }
});

test('友達が始めた時: 承認済みの友達へ送る・中身・認証トークンは使い回す・ログにトークンを出さない', async () => {
  const app = await setup();
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(' '));
  try {
    const tb = rand();
    await call(app.base, 'PUT', '/api/me', { user: 'a', body: { displayName: 'あおい' } });
    await app.register('b', tb);
    await app.register('c', rand()); // 友達でない人には送らない
    await app.befriend('b', 'a'); // 向きはどちらでもよい
    await app.startFocus('a');
    assert.equal(app.sent.length, 1);
    const { url, init, msg } = app.sent[0];
    assert.equal(url, FCM);
    assert.equal(init.headers.Authorization, `Bearer ${app.access}`);
    assert.deepEqual(msg, { token: tb, notification: { title: 'モル塔', body: 'あおいさんが取り組みを始めました' }, data: { type: 'friend_start', route: '/' } });
    assert.equal(app.metaCalls[0].headers['Metadata-Flavor'], 'Google');

    // 合図でも送る（Web Push と同じ選び方）。b と c の端末へ。メタデータは 1 回だけ（期限まで使い回す）
    const r = await app.tick();
    assert.deepEqual(r.json, { sent: 2, skipped: 0 });
    const nudges = app.sent.filter((s) => s.msg.data.type === 'nudge');
    assert.equal(nudges.length, 2);
    // b は友達のあおいが今日始めたので名前が入る。c は友達がいないので固定の文（11/9）
    const toB = nudges.find((s) => s.msg.message?.token === tb || s.msg.token === tb);
    assert.equal(toB.msg.notification.body, nudgeBody('あおい'));
    assert.ok(nudges.some((s) => s.msg.notification.body === NUDGE_MESSAGE.body));
    assert.ok(nudges.every((s) => s.msg.data.route === '/'));
    assert.equal((await app.store.get(C.pushSent, 'b')).count, 1); // 1 日の数は Web Push と共通
    assert.equal(app.metaCalls.length, 1);
    const all = logs.join('\n');
    for (const s of [tb, app.access]) assert.ok(!all.includes(s));
  } finally {
    Object.assign(console, orig);
    await app.close();
  }
});

test('友達の通知: 集中中の人・notifyOnStart=false には送らない・1 時間に 1 回まで・off を送っても届く（11/9 強め固定）', async () => {
  const app = await setup();
  try {
    for (const u of ['b', 'c', 'd', 'e']) await app.register(u, rand());
    for (const u of ['b', 'c', 'd']) await app.befriend('a', u);
    await app.befriend('x', 'e');
    await app.store.put(C.friendships, 'a-e', { userId: 'a', friendId: 'e', status: 'accepted', notifyOnStart: false });
    await app.store.put(C.friendships, 'a-p', { userId: 'a', friendId: 'p', status: 'pending', notifyOnStart: true });
    await call(app.base, 'PUT', '/api/me', { user: 'c', body: { nudgeLevel: 'off' } });
    await app.startFocus('d'); // d は集中中（d の友達 a は端末が無いので何も送らない）
    assert.equal(app.sent.length, 0);

    await app.startFocus('a');
    assert.deepEqual(app.sent.map((s) => s.msg.token), [(await liveDevices(app.store, 'b'))[0].token, (await liveDevices(app.store, 'c'))[0].token]);

    // 30 分後: a が始め直しても b へは 1 時間以内なので送らない。x が始めると、x-e の組（notifyOnStart=true）で e に届く
    const endA = async () => {
      const s = (await app.store.list(C.sessions, { userId: 'a' })).find((x) => !x.endedAt);
      assert.equal((await call(app.base, 'POST', `/api/sessions/${s.id}/end`, { user: 'a', body: {} })).status, 200);
    };
    await endA();
    app.clock.at = new Date(NOW.getTime() + 30 * 60_000);
    await app.startFocus('a');
    assert.equal(app.sent.length, 2);
    await app.startFocus('x');
    assert.equal(app.sent.length, 3);
    assert.equal(app.sent[2].msg.token, (await liveDevices(app.store, 'e'))[0].token);

    // 1 時間を過ぎれば また届く
    await endA();
    app.clock.at = new Date(NOW.getTime() + 61 * 60_000);
    await app.startFocus('a');
    assert.equal(app.sent.length, 5);
  } finally {
    await app.close();
  }
});

test('FCM が UNREGISTERED（404）・INVALID_ARGUMENT（400）を返した登録は消す・500 は数えるだけ', async () => {
  const gone = rand();
  const invalid = rand();
  const flaky = rand();
  const fine = rand();
  const app = await setup({
    reply: (token) => {
      if (token === gone) return { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } };
      if (token === invalid) return { status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } };
      if (token === flaky) return { status: 500 };
      return { status: 200, body: { name: 'projects/test-project/messages/1' } };
    },
  });
  try {
    await app.register('u1', gone);
    await app.register('u2', invalid);
    await app.register('u3', flaky);
    await app.register('u4', fine);
    assert.deepEqual((await app.tick()).json, { sent: 1, skipped: 0 });
    const left = (await app.store.list(COL.devices)).filter((d) => !d.deletedAt).map((d) => d.token).sort();
    assert.deepEqual(left, [flaky, fine].sort());
    assert.ok((await app.store.list(COL.devices)).filter((d) => d.deletedAt).every((d) => d.token === null));
  } finally {
    await app.close();
  }
});

test('メタデータサーバーから取れない時: 送らない・集中の開始と合図は落ちない', async () => {
  const app = await setup({ meta: false });
  const orig = console.warn;
  console.warn = () => {};
  try {
    await app.register('b', rand());
    await app.befriend('a', 'b');
    await app.startFocus('a');
    assert.deepEqual((await app.tick()).json, { sent: 0, skipped: 0 });
    assert.equal(app.sent.length, 0);
    assert.ok(app.metaCalls.length >= 1);
    assert.equal((await liveDevices(app.store, 'b')).length, 1);
  } finally {
    console.warn = orig;
    await app.close();
  }
});
