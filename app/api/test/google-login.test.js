import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { googleUserIdFor } from '../src/auth/google.js';
import { userIdFor } from '../src/auth/invite.js';
import { start } from './helpers.js';

// POST /api/login/google（Issue #213）。鍵・ID・トークンは全部実行時に作る（本物の形を書かない）。
const rand = (n) => randomBytes(n).toString('hex');
const T0 = Date.UTC(2026, 10, 8, 0, 0, 0);
const nowSec = () => Math.floor(T0 / 1000);

function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = rand(4);
  return { privateKey, kid, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(key, claims, kid = key.kid) {
  const head = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(claims)}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), key.privateKey).toString('base64url')}`;
}

async function startGoogle({ env = {} } = {}) {
  const key = makeKey();
  const clientId = ['test', rand(4), 'client'].join('-');
  const secrets = { TEAM_CODE: `team-${rand(6)}`, SESSION_SECRET: rand(24) };
  let certCalls = 0;
  const googleFetch = async () => {
    certCalls += 1;
    return new Response(JSON.stringify({ keys: [key.jwk] }), { headers: { 'cache-control': 'public, max-age=600' } });
  };
  const s = await start(
    { now: () => new Date(T0), googleFetch, log: () => {} },
    { AUTH_MODE: 'invite', GOOGLE_CLIENT_ID: clientId, ...secrets, ...env },
  );
  const claims = (over = {}) => ({
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: String(Date.now()) + rand(2),
    email_verified: true,
    given_name: 'はると',
    exp: nowSec() + 600,
    ...over,
  });
  const post = (path, body) =>
    fetch(`${s.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const login = (credential) => post('/api/login/google', { credential });
  return { ...s, key, clientId, secrets, claims, post, login, certCalls: () => certCalls };
}

test('正しい ID トークンでログインでき、/api/me が通る。表示名は given_name', async () => {
  const s = await startGoogle();
  const res = await s.login(idToken(s.key, s.claims()));
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  assert.match(user.id, /^u_[A-Za-z0-9_-]{22}$/);
  assert.equal(user.displayName, 'はると');
  const me = await fetch(`${s.base}/api/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, user.id);
  await s.close();
});

test('同じ sub なら同じ userId。鍵は Cache-Control の間 1 回だけ取る', async () => {
  const s = await startGoogle();
  const c = s.claims({ given_name: undefined, name: 'あ'.repeat(40) });
  const a = await (await s.login(idToken(s.key, c))).json();
  const b = await (await s.login(idToken(s.key, { ...c, exp: c.exp + 1 }))).json();
  assert.equal(a.user.id, b.user.id);
  assert.equal(a.user.displayName, 'あ'.repeat(30)); // given_name が無ければ name を 30 字に切る
  assert.equal(s.certCalls(), 1);
  await s.close();
});

test('署名違い・aud 違い・iss 違い・期限切れ・email_verified false・壊れた形は 401（理由は言わない）。失敗 5 回で 429', async () => {
  const s = await startGoogle();
  const other = makeKey();
  const bad = [
    idToken(other, s.claims(), s.key.kid), // 別の鍵で署名
    idToken(s.key, s.claims({ aud: `${s.clientId}x` })),
    idToken(s.key, s.claims({ iss: 'https://example.com' })),
    idToken(s.key, s.claims({ exp: nowSec() })),
    idToken(s.key, s.claims({ email_verified: false })),
  ];
  for (const t of bad) {
    const res = await s.login(t);
    assert.equal(res.status, 401, t.slice(0, 10));
    assert.deepEqual(await res.json(), { error: { code: 'unauthenticated', message: 'Google でログインできませんでした' } });
  }
  // 失敗が 5 回を超えると、正しいトークンでも 429
  assert.equal((await s.login(idToken(s.key, s.claims()))).status, 429);
  await s.close();
  const t = await startGoogle(); // 壊れた形も 401
  assert.equal((await t.login('a.b.c')).status, 401);
  await t.close();
});

test('invite 方式の userId と衝突しない（"google:" で始まる名前でも）', () => {
  const secret = rand(24);
  const sub = '1234567890';
  const g = googleUserIdFor(secret, sub);
  for (const name of [sub, `google:${sub}`, `Google:${sub}`, `GOOGLE:${sub}`]) assert.notEqual(userIdFor(secret, name), g);
});

test('credential が無い・文字列でないは 400', async () => {
  const s = await startGoogle();
  for (const b of [{}, { credential: 5 }, { credential: '' }]) assert.equal((await s.post('/api/login/google', b)).status, 400);
  await s.close();
});

test('GOOGLE_CLIENT_ID 無し・invite 以外では経路ごと無い（404）', async () => {
  const none = await start({}, { AUTH_MODE: 'invite', TEAM_CODE: `team-${rand(6)}`, SESSION_SECRET: rand(24) });
  const fake = await start({}, { AUTH_MODE: 'fake', GOOGLE_CLIENT_ID: 'x-client' });
  for (const s of [none, fake]) {
    const res = await fetch(`${s.base}/api/login/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"credential":"a"}' });
    assert.equal(res.status, 404);
    await s.close();
  }
});
