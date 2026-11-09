import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, verify } from 'node:crypto';
import { start } from './helpers.js';
import { C } from '../src/common/collections.js';
import { encryptPayload } from '../src/push/encrypt.js';
import { latestStarterToday, PUSH_PAYLOAD, skipReason } from '../src/push/pick.js';
import { MAX_ENDPOINT, tickSecretOk, validateSubscription } from '../src/push/routes.js';
import { vapidAuthorization, VAPID_TTL_SEC } from '../src/push/vapid.js';
import { createMemoryStore } from '../src/store/index.js';

// 端末への通知（契約 §3.7c・#211）の試験。鍵・合図の値は実行時に作る（本物の形の値を書かない）。
const b64u = (b) => Buffer.from(b).toString('base64url');
const f = (s) => Buffer.from(s, 'base64url');
const NOW = new Date('2026-11-08T03:00:00.000Z'); // 日本時間 11/8 12:00

function vapidKeys() {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), f(jwk.x), f(jwk.y)])), privateKey: jwk.d };
}

// 端末側（受け手）の鍵の組。decrypt で中身を確かめる。
function device() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    sub: { endpoint: `https://push.example.test/${b64u(randomBytes(12))}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } },
    decrypt(buf) {
      const salt = buf.subarray(0, 16);
      const idlen = buf[20];
      const asPublic = buf.subarray(21, 21 + idlen);
      const ct = buf.subarray(21 + idlen);
      const secret = ecdh.computeSecret(asPublic);
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
      const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(ct.subarray(-16));
      const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
      assert.equal(plain.at(-1), 2);
      return plain.subarray(0, -1).toString();
    },
  };
}

test('aes128gcm: RFC 8291 付録 A の入力から同じ出力になる', () => {
  const out = encryptPayload(
    'When I grow up, I want to be a watermelon',
    f('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
    f('BTBZMqHH6r4Tts7J_aSIgg'),
    { asPrivate: f('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: f('DGv6ra1nlYgDCS1FRnbzlw') },
  );
  assert.equal(
    b64u(out),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

test('aes128gcm: 端末の鍵で元に戻せる（毎回ちがう salt と鍵）', () => {
  const dev = device();
  const a = encryptPayload('こんにちは', f(dev.sub.keys.p256dh), f(dev.sub.keys.auth));
  const b = encryptPayload('こんにちは', f(dev.sub.keys.p256dh), f(dev.sub.keys.auth));
  assert.notDeepEqual(a, b);
  assert.equal(dev.decrypt(a), 'こんにちは');
});

test('VAPID: JWT の形・aud は origin・有効 12 時間・署名が公開鍵で通る', () => {
  const keys = vapidKeys();
  const value = vapidAuthorization({ endpoint: 'https://push.example.test/a/b?c=1', ...keys, subject: 'mailto:team@example.test', now: NOW });
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(value);
  assert.ok(m, 'vapid t=…, k=… の形');
  assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(f(m[1])), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(f(m[2]));
  assert.deepEqual(claims, { aud: 'https://push.example.test', exp: NOW.getTime() / 1000 + VAPID_TTL_SEC, sub: 'mailto:team@example.test' });
  assert.equal(VAPID_TTL_SEC, 12 * 3600);
  const pub = f(keys.publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  const sig = f(m[3]);
  assert.equal(sig.length, 64);
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, sig));
});

test('購読の検証: http・長すぎる・鍵の形の違いは 400', () => {
  const { sub } = device();
  assert.equal(validateSubscription(sub).endpoint, sub.endpoint);
  const bad = [
    { ...sub, endpoint: sub.endpoint.replace('https://', 'http://') },
    { ...sub, endpoint: `https://push.example.test/${'a'.repeat(MAX_ENDPOINT)}` },
    { ...sub, keys: { ...sub.keys, p256dh: b64u(randomBytes(65)).replace(/^./, 'A') } },
    { ...sub, keys: { ...sub.keys, auth: b64u(randomBytes(15)) } },
    { ...sub, keys: undefined },
    null,
  ];
  for (const b of bad) assert.throws(() => validateSubscription(b), (e) => e.status === 400);
});

test('pick: 時間帯・今日始めた・1 日 1 通（11/9 から全員 strong・nudgeLevel を見ない）', () => {
  const at = (h) => new Date(Date.parse('2026-11-07T15:00:00Z') + h * 3600_000); // 日本時間 11/8 の h 時
  assert.equal(skipReason({ now: at(12) }), null);
  assert.equal(skipReason({ user: { nudgeLevel: 'off' }, now: at(12) }), null); // off でも送る
  assert.equal(skipReason({ now: at(7) }), null);
  assert.equal(skipReason({ now: at(6.9) }), 'quiet_hours');
  assert.equal(skipReason({ now: at(21) }), 'quiet_hours');
  assert.equal(skipReason({ now: at(23.5) }), 'quiet_hours');
  assert.equal(skipReason({ now: at(20.9) }), null);
  // 今日（日本時間）に始めた集中がある→送らない（進行中も含む）。昨日の分は数えない。
  assert.equal(skipReason({ sessions: [{ startedAt: at(8).toISOString(), endedAt: null }], now: at(12) }), 'done_today');
  assert.equal(skipReason({ sessions: [{ startedAt: at(-2).toISOString(), endedAt: at(-1).toISOString() }], now: at(12) }), null);
  assert.equal(skipReason({ sent: { day: '2026-11-08', count: 1 }, now: at(12) }), 'daily_limit');
  assert.equal(skipReason({ sent: { day: '2026-11-07', count: 1 }, now: at(12) }), null);
  assert.ok(!/AI|Gemini/.test(JSON.stringify(PUSH_PAYLOAD)));
  // 今日始めた友達: いちばん最近の 1 人（昨日の分は数えない）
  assert.equal(latestStarterToday([{ friendId: 'a', startedAt: at(9).toISOString() }, { friendId: 'b', startedAt: at(11).toISOString() }, { friendId: 'c', startedAt: at(-3).toISOString() }], at(12)), 'b');
  assert.equal(latestStarterToday([], at(12)), null);
});

test('合図の鍵の比較: 無し・違い・一致', () => {
  const secret = b64u(randomBytes(24));
  assert.equal(tickSecretOk(undefined, secret), false);
  assert.equal(tickSecretOk(`${secret}x`, secret), false);
  assert.equal(tickSecretOk(secret, ''), false);
  assert.equal(tickSecretOk(secret, secret), true);
});

const call = async (base, method, path, { user = 'u1', body, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user && { 'x-dev-user': user }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

test('VAPID の環境変数が無い時、/api/push/* は 404（TICK_SECRET が無ければ tick だけ 404）', async () => {
  const app = await start();
  try {
    assert.equal((await call(app.base, 'GET', '/api/push/key')).status, 404);
    assert.equal((await call(app.base, 'POST', '/api/push/subscribe', { body: device().sub })).status, 404);
    assert.equal((await call(app.base, 'POST', '/api/push/tick', { user: null, body: {} })).status, 404);
  } finally {
    await app.close();
  }
  const keys = vapidKeys();
  const app2 = await start({}, { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:team@example.test' });
  try {
    assert.equal((await call(app2.base, 'GET', '/api/push/key')).status, 200);
    assert.equal((await call(app2.base, 'POST', '/api/push/tick', { user: null, body: {} })).status, 404);
  } finally {
    await app2.close();
  }
});

async function setup(reply = () => 201) {
  const keys = vapidKeys();
  const secret = b64u(randomBytes(24));
  const clock = { at: NOW };
  const store = createMemoryStore({ now: () => clock.at });
  const sent = [];
  const pushFetch = async (url, init) => {
    sent.push({ url, init });
    return new Response(null, { status: reply(url) });
  };
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:team@example.test', TICK_SECRET: secret };
  const app = await start({ store, pushFetch, now: () => clock.at }, env);
  const tick = (h = { 'x-tick-secret': secret }) => call(app.base, 'POST', '/api/push/tick', { user: null, body: {}, headers: h });
  return { ...app, keys, store, sent, clock, tick };
}

test('鍵の取得・登録は 1 人 3 端末まで・同じ端末の登録し直しは数えない・やめると空く', async () => {
  const app = await setup();
  try {
    assert.equal((await call(app.base, 'GET', '/api/push/key', { user: null })).status, 401);
    assert.deepEqual((await call(app.base, 'GET', '/api/push/key')).json, { publicKey: app.keys.publicKey });
    const devs = [device(), device(), device(), device()];
    for (const d of devs.slice(0, 3)) assert.equal((await call(app.base, 'POST', '/api/push/subscribe', { body: d.sub })).status, 204);
    assert.equal((await call(app.base, 'POST', '/api/push/subscribe', { body: devs[0].sub })).status, 204);
    const fourth = await call(app.base, 'POST', '/api/push/subscribe', { body: devs[3].sub });
    assert.equal(fourth.status, 409);
    assert.equal(fourth.json.error.code, 'conflict');
    // 他の人は自分の登録を消せない（204 だが残る）
    assert.equal((await call(app.base, 'DELETE', '/api/push/subscribe', { user: 'u2', body: { endpoint: devs[0].sub.endpoint } })).status, 204);
    assert.equal((await call(app.base, 'POST', '/api/push/subscribe', { body: devs[3].sub })).status, 409);
    assert.equal((await call(app.base, 'DELETE', '/api/push/subscribe', { body: { endpoint: devs[0].sub.endpoint } })).status, 204);
    assert.equal((await call(app.base, 'POST', '/api/push/subscribe', { body: devs[3].sub })).status, 204);
    const http = { ...devs[1].sub, endpoint: 'http://push.example.test/x' };
    assert.equal((await call(app.base, 'POST', '/api/push/subscribe', { body: http })).status, 400);
  } finally {
    await app.close();
  }
});

test('tick の認証: 無し・違いは 401、一致で 200', async () => {
  const app = await setup();
  try {
    assert.equal((await app.tick({})).status, 401);
    assert.equal((await app.tick({ 'x-tick-secret': 'wrong' })).status, 401);
    assert.deepEqual((await app.tick()).json, { sent: 0, skipped: 0 });
  } finally {
    await app.close();
  }
});

test('tick: 暗号化して送る・410 は登録を消す・1 日 1 通まで・今日始めた人は送らない・off でも送る（11/9）・ログに出さない', async () => {
  const gone = new Set();
  const app = await setup((url) => (gone.has(url) ? 410 : 201));
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(' '));
  try {
    const [a1, a2, b1, c1] = [device(), device(), device(), device()];
    await call(app.base, 'POST', '/api/push/subscribe', { user: 'a', body: a1.sub });
    await call(app.base, 'POST', '/api/push/subscribe', { user: 'a', body: a2.sub });
    await call(app.base, 'POST', '/api/push/subscribe', { user: 'b', body: b1.sub });
    await call(app.base, 'POST', '/api/push/subscribe', { user: 'c', body: c1.sub });
    await call(app.base, 'PUT', '/api/me', { user: 'b', body: { nudgeLevel: 'off' } });
    await app.store.put(C.sessions, 's1', { userId: 'c', startedAt: '2026-11-08T01:00:00.000Z', endedAt: '2026-11-08T01:30:00.000Z' });
    gone.add(a2.sub.endpoint);

    assert.deepEqual((await app.tick()).json, { sent: 2, skipped: 1 }); // a1・b1（b は off を送ったが強め固定）。c は今日始めた
    const ok = app.sent.find((s) => s.url === a1.sub.endpoint);
    assert.equal(ok.init.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(ok.init.headers.Urgency, 'normal');
    assert.ok(Number(ok.init.headers.TTL) > 0);
    assert.match(ok.init.headers.Authorization, /^vapid t=.+, k=/);
    assert.deepEqual(JSON.parse(a1.decrypt(ok.init.body)), PUSH_PAYLOAD);
    assert.ok(!ok.init.body.includes(Buffer.from(PUSH_PAYLOAD.body)));
    // 410 の端末は消えた（次から送らない）
    assert.equal((await app.store.get(C.pushSubs, (await app.store.list(C.pushSubs, { userId: 'a' })).find((s) => s.deletedAt).id)).endpoint, null);

    assert.deepEqual((await app.tick()).json, { sent: 0, skipped: 3 }); // 1 日 1 通の上限
    assert.equal(app.sent.filter((s) => s.url === a2.sub.endpoint).length, 1);
    app.clock.at = new Date(NOW.getTime() + 86_400_000); // 次の日は また送れる（c も昨日の分は数えない）
    assert.deepEqual((await app.tick()).json, { sent: 3, skipped: 0 });
    app.clock.at = new Date('2026-11-09T13:00:00.000Z'); // 日本時間 22:00
    assert.deepEqual((await app.tick()).json, { sent: 0, skipped: 3 });

    const all = logs.join('\n');
    for (const s of [a1.sub.endpoint, a1.sub.keys.p256dh, a1.sub.keys.auth, PUSH_PAYLOAD.body, app.keys.privateKey]) assert.ok(!all.includes(s));
  } finally {
    Object.assign(console, orig);
    await app.close();
  }
});

test('tick: push サービスの失敗（500・通信の失敗）は数えるだけで登録は残す', async () => {
  const [d1, d2] = [device(), device()];
  const app = await setup((url) => {
    if (url === d2.sub.endpoint) throw new TypeError('fetch failed');
    return 500;
  });
  try {
    await call(app.base, 'POST', '/api/push/subscribe', { body: d1.sub });
    await call(app.base, 'POST', '/api/push/subscribe', { body: d2.sub });
    assert.deepEqual((await app.tick()).json, { sent: 0, skipped: 0 });
    assert.equal((await app.store.list(C.pushSubs, { userId: 'u1' })).filter((s) => !s.deletedAt).length, 2);
  } finally {
    await app.close();
  }
});
