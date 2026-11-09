import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { start } from './helpers.js';

// 一時ディレクトリの中身:
//   tmp/secret.txt         ← 配る範囲の外（読めてはいけない）
//   tmp/public/index.html, app.js, style.css, logo.png, data.json, _expo/static/x.map, link-out（外を指すリンク）
let tmp;
let pub;
const SECRET = 'TOP-SECRET-OUTSIDE';

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'static-test-'));
  pub = path.join(tmp, 'public');
  fs.mkdirSync(path.join(pub, '_expo', 'static'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'secret.txt'), SECRET);
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(pub, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(pub, 'style.css'), 'a{}');
  fs.writeFileSync(path.join(pub, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(pub, 'data.json'), '{"a":1}');
  fs.writeFileSync(path.join(pub, '_expo', 'static', 'x.map'), '{}');
  fs.writeFileSync(path.join(pub, 'a.woff2'), 'w');
  fs.writeFileSync(path.join(pub, 'manifest.webmanifest'), '{}');
  fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(pub, 'link-out.txt'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const withStatic = () => start({ staticDir: pub });

// fetch は URL の '..' を畳んでしまうので、攻撃のパスは生のまま node:http で送る。
function raw(base, method, rawPath) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: rawPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('ファイルを配る（/ は index.html）', async () => {
  const s = await withStatic();
  const root = await fetch(`${s.base}/`);
  assert.equal(root.status, 200);
  assert.equal(await root.text(), '<!doctype html><title>app</title>');
  const js = await fetch(`${s.base}/app.js`);
  assert.equal(await js.text(), 'console.log(1)');
  const nested = await fetch(`${s.base}/_expo/static/x.map`);
  assert.equal(nested.status, 200);
  await s.close();
});

test('存在しないパスは index.html（画面の側の戻り先）', async () => {
  const s = await withStatic();
  for (const p of ['/goal/new', '/plan/abc', '/no-such.js', '/_expo']) {
    const res = await fetch(`${s.base}${p}`);
    assert.equal(res.status, 200, p);
    assert.equal(await res.text(), '<!doctype html><title>app</title>', p);
    assert.match(res.headers.get('content-type'), /^text\/html/);
  }
  await s.close();
});

test('/privacy（プライバシーポリシー・#238）はログインなしで 200 の画面を返す', async () => {
  const s = await withStatic();
  for (const p of ['/privacy', '/privacy/']) {
    const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /^text\/html/, p);
    assert.equal(await res.text(), '<!doctype html><title>app</title>', p);
  }
  const head = await fetch(`${s.base}/privacy`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  await s.close();
});

test('content-type は拡張子から', async () => {
  const s = await withStatic();
  const expect = {
    '/': 'text/html; charset=utf-8',
    '/app.js': 'text/javascript; charset=utf-8',
    '/style.css': 'text/css; charset=utf-8',
    '/data.json': 'application/json; charset=utf-8',
    '/logo.png': 'image/png',
    '/a.woff2': 'font/woff2',
    '/_expo/static/x.map': 'application/json; charset=utf-8',
    '/manifest.webmanifest': 'application/manifest+json; charset=utf-8',
  };
  for (const [p, type] of Object.entries(expect)) {
    const res = await fetch(`${s.base}${p}`);
    assert.equal(res.headers.get('content-type'), type, p);
    await res.arrayBuffer();
  }
  await s.close();
});

test('キャッシュ: js・css・画像は max-age、index.html は no-cache', async () => {
  const s = await withStatic();
  for (const p of ['/app.js', '/style.css', '/logo.png']) {
    const res = await fetch(`${s.base}${p}`);
    assert.match(res.headers.get('cache-control'), /max-age=\d+/, p);
    await res.arrayBuffer();
  }
  for (const p of ['/', '/index.html', '/anything']) {
    const res = await fetch(`${s.base}${p}`);
    assert.equal(res.headers.get('cache-control'), 'no-cache', p);
    await res.arrayBuffer();
  }
  await s.close();
});

test('HEAD は本文なしで同じ見出しを返す', async () => {
  const s = await withStatic();
  const res = await fetch(`${s.base}/app.js`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), String('console.log(1)'.length));
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await res.text(), '');
  await s.close();
});

test('../ の攻撃で外のファイルは読めない（%2e%2e・二重エンコード・バックスラッシュ・NUL・リンク）', async () => {
  const s = await withStatic();
  const attacks = [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E/secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
    '/..\\secret.txt',
    '/%252e%252e/secret.txt',
    '/%252e%252e%252fsecret.txt',
    '/foo/../../secret.txt',
    '/_expo/../../secret.txt',
    '/index.html%00/../secret.txt',
    '/link-out.txt', // 外を指すシンボリックリンク
    '/../../../../../../etc/passwd',
    '/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
  ];
  for (const p of attacks) {
    const res = await raw(s.base, 'GET', p);
    assert.ok(!res.text.includes(SECRET), `漏れた: ${p}`);
    assert.ok(!res.text.includes('root:'), `漏れた: ${p}`);
    assert.ok(res.status === 200 || res.status === 404, `${p} -> ${res.status}`);
    if (res.status === 200) assert.equal(res.text, '<!doctype html><title>app</title>', p); // 戻り先の index.html だけ
  }
  const link = await raw(s.base, 'GET', '/link-out.txt');
  assert.equal(link.status, 404);
  await s.close();
});

test('/api/ は配らない（404 の JSON）。API はそのまま動く', async () => {
  const s = await withStatic();
  const res = await fetch(`${s.base}/api/nothing`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: { code: 'not_found', message: '見つかりません' } });
  const bare = await fetch(`${s.base}/api`);
  assert.equal(bare.status, 404);
  assert.equal((await bare.json()).error.code, 'not_found');
  const health = await fetch(`${s.base}/api/health`);
  assert.deepEqual(await health.json(), { ok: true, store: 'memory', auth: 'fake' });
  // /apix は API ではない（画面の戻り先）
  const apix = await fetch(`${s.base}/apix`);
  assert.equal(apix.status, 200);
  await apix.text();
  await s.close();
});

test('GET／HEAD 以外は配らない（経路表へ）', async () => {
  const s = await withStatic();
  const res = await fetch(`${s.base}/app.js`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'not_found');
  await s.close();
});

test('壊れた % の並びは 404（500 にしない）', async () => {
  const s = await withStatic();
  const res = await raw(s.base, 'GET', '/%E0%A4');
  assert.equal(res.status, 404);
  await s.close();
});

test('STATIC_DIR が空なら今までと同じ（/ は 404 の JSON）', async () => {
  const s = await start();
  const res = await fetch(`${s.base}/`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'not_found');
  const s2 = await start({ staticDir: '' });
  assert.equal((await fetch(`${s2.base}/app.js`)).status, 404);
  await s.close();
  await s2.close();
});

test('STATIC_DIR は環境変数からも読む。無いディレクトリなら起動で落とす', async () => {
  const { createApp } = await import('../src/index.js');
  const { loadConfig } = await import('../src/config.js');
  const config = loadConfig({ GEMINI_MODE: 'fake', AUTH_MODE: 'fake' });
  assert.throws(() => createApp({ config, env: { STATIC_DIR: path.join(tmp, 'nope') } }), /ENOENT/);
  const { server } = createApp({ config, env: { STATIC_DIR: pub } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(res.status, 200);
  await res.text();
  await new Promise((r) => server.close(r));
});
