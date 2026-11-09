import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

// 試験用の機能: 認証が要る POST /api/echo
const echo = (router) =>
  router.add('POST', '/api/echo', async ({ body, userId }) => ({ status: 200, body: { userId, body } }));

test('GET /api/health は { ok: true, auth }（認証不要）', async () => {
  const s = await start();
  const res = await fetch(`${s.base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, store: 'memory', auth: 'fake' });
  await s.close();
});

test('GET /api/health の auth は方式（real は loginRequired なし）', async () => {
  const s = await start({}, { AUTH_MODE: 'real' });
  assert.deepEqual(await (await fetch(`${s.base}/api/health`)).json(), { ok: true, store: 'memory', auth: 'real' });
  await s.close();
});

test('知らないパスは 404 と共通のエラー形式', async () => {
  const s = await start();
  const res = await fetch(`${s.base}/api/nothing`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: { code: 'not_found', message: '見つかりません' } });
  await s.close();
});

test('認証が要る経路は、ログイン無しで 401', async () => {
  const s = await start({ features: [echo] });
  const res = await fetch(`${s.base}/api/echo`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'unauthenticated');
  await s.close();
});

test('AUTH_MODE=fake なら x-dev-user で通る。real では x-dev-user を無視する', async () => {
  const fake = await start({ features: [echo] });
  const ok = await fetch(`${fake.base}/api/echo`, { method: 'POST', headers: { 'x-dev-user': 'u1' }, body: '{"a":1}' });
  assert.deepEqual(await ok.json(), { userId: 'u1', body: { a: 1 } });
  await fake.close();

  const real = await start({ features: [echo] }, { AUTH_MODE: 'real' });
  const ng = await fetch(`${real.base}/api/echo`, { method: 'POST', headers: { 'x-dev-user': 'u1' }, body: '{}' });
  assert.equal(ng.status, 401);
  await real.close();
});

test('本文が上限(64KB)を超えると 413、壊れた JSON は 400', async () => {
  const s = await start({ features: [echo] });
  const big = await fetch(`${s.base}/api/echo`, {
    method: 'POST',
    headers: { 'x-dev-user': 'u1' },
    body: JSON.stringify({ t: 'x'.repeat(70 * 1024) }),
  });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error.code, 'too_large');

  const bad = await fetch(`${s.base}/api/echo`, { method: 'POST', headers: { 'x-dev-user': 'u1' }, body: '{oops' });
  assert.equal(bad.status, 400);
  await s.close();
});

test('想定外の失敗は 500 で、中身を返さない', async () => {
  const boom = (router) =>
    router.add('GET', '/api/boom', async () => {
      throw new Error('secret-path /etc/x');
    }, { auth: false });
  const s = await start({ features: [boom] });
  const orig = console.error;
  console.error = () => {};
  const res = await fetch(`${s.base}/api/boom`);
  console.error = orig;
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.ok(!text.includes('secret-path'));
  assert.equal(JSON.parse(text).error.code, 'internal');
  await s.close();
});

test('AUTH_MODE=fake は Cloud Run(K_SERVICE あり)では起動しない', async () => {
  const { createApp } = await import('../src/index.js');
  const { loadConfig } = await import('../src/config.js');
  assert.throws(
    () => createApp({ config: loadConfig({ AUTH_MODE: 'fake' }), env: { K_SERVICE: 'app' } }),
    /Cloud Run では使えません/,
  );
});

test('STORE の読み取り: 既定は memory・firestore・不正な値はエラー', async () => {
  const { loadConfig } = await import('../src/config.js');
  assert.equal(loadConfig({}).store, 'memory');
  assert.equal(loadConfig({}).firestoreDatabase, '(default)');
  const c = loadConfig({ STORE: 'firestore', FIRESTORE_DATABASE: 'db1' });
  assert.equal(c.store, 'firestore');
  assert.equal(c.firestoreDatabase, 'db1');
  assert.throws(() => loadConfig({ STORE: 'redis' }), /STORE/);
});

test('STORE=firestore で GCP_PROJECT_ID が無いと起動しない', async () => {
  const { createApp } = await import('../src/index.js');
  const { loadConfig } = await import('../src/config.js');
  assert.throws(() => createApp({ config: loadConfig({ STORE: 'firestore' }), env: {} }), /GCP_PROJECT_ID/);
});

test('health.store は選んだ保存・overrides.store が最優先（Firestore は呼ばない）', async () => {
  const { createApp } = await import('../src/index.js');
  const { loadConfig } = await import('../src/config.js');
  const { createMemoryStore } = await import('../src/store/index.js');
  const calls = [];
  const firestoreFetch = async (url) => {
    calls.push(url);
    return new Response('{}', { status: 200 });
  };
  const config = loadConfig({ STORE: 'firestore', GCP_PROJECT_ID: 'proj-x', AUTH_MODE: 'fake', GEMINI_MODE: 'fake' });
  const a = createApp({ config, env: {}, firestoreFetch });
  const mem = createMemoryStore();
  const b = createApp({ config, env: {}, store: mem, firestoreFetch });
  assert.equal(b.ctx.store, mem);
  assert.notEqual(a.ctx.store, mem);
  for (const [app, want] of [[a, 'firestore'], [b, 'memory']]) {
    await new Promise((r) => app.server.listen(0, r));
    const res = await fetch(`http://127.0.0.1:${app.server.address().port}/api/health`);
    assert.equal((await res.json()).store, want);
    await new Promise((r) => app.server.close(r));
  }
  assert.equal(calls.length, 0);
});

test('パスの壊れた % の並び（%E0 など）は 400 で、500 にしない（認証の前でもスタックを出さない）', async () => {
  const s = await start();
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try {
    for (const p of ['/api/goals/%E0', '/api/sessions/%E0%A4/reflect', '/api/friends/%/accept']) {
      const method = p.startsWith('/api/goals') ? 'GET' : 'POST';
      const res = await fetch(`${s.base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(res.status, 400, p);
      assert.equal((await res.json()).error.code, 'invalid_argument', p);
    }
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 0, 'internal error のログが出ている');
  await s.close();
});
