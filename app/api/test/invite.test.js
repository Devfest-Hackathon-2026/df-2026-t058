import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/index.js';
import { loadConfig } from '../src/config.js';
import {
  bearerToken,
  clientKey,
  codeMatches,
  normalizeName,
  signToken,
  userIdFor,
  verifyToken,
} from '../src/auth/invite.js';
import { start } from './helpers.js';

// 値は本物の形で書かず、実行時に組み立てる（AGENTS.md）。
const rand = (n) => randomBytes(n).toString('hex');
const makeSecrets = () => ({ TEAM_CODE: `team-${rand(6)}`, SESSION_SECRET: rand(24) });

const T0 = Date.UTC(2026, 10, 6, 0, 0, 0);

// 時計を動かせるサーバー。ttl は 1 時間。
async function startInvite({ env = {}, features, log } = {}) {
  const secrets = makeSecrets();
  const clock = { t: T0 };
  const overrides = { now: () => new Date(clock.t), ...(features && { features }), ...(log && { log }) };
  const s = await start(overrides, { AUTH_MODE: 'invite', TOKEN_TTL_HOURS: '1', ...secrets, ...env });
  const post = (path, body, headers = {}) =>
    fetch(`${s.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const login = (name, code = secrets.TEAM_CODE, headers = {}) => post('/api/login', { name, code }, headers);
  const authed = (token, path = '/api/me', init = {}) =>
    fetch(`${s.base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  return { ...s, secrets, clock, post, login, authed };
}

test('正しいコードでログインでき、そのトークンで /api/me が通る', async () => {
  const s = await startInvite();
  const res = await s.login('  はると ');
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  assert.equal(typeof token, 'string');
  assert.match(user.id, /^u_[A-Za-z0-9_-]{22}$/);
  assert.equal(user.displayName, 'はると'); // 空なら名前を入れる（前後の空白は落とす）
  const me = await s.authed(token);
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.id, user.id);
  assert.equal(body.displayName, 'はると');
  await s.close();
});

test('表示名を変えた人が入り直しても、表示名は上書きしない', async () => {
  const s = await startInvite();
  const { token } = await (await s.login('Haruto')).json();
  await s.authed(token, '/api/me', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"displayName":"はると"}' });
  const again = await (await s.login('haruto')).json();
  assert.equal(again.user.displayName, 'はると');
  await s.close();
});

test('違うコードは 401 invalid_code（名前のことは言わない）', async () => {
  const s = await startInvite();
  const res = await s.login('はると', `${s.secrets.TEAM_CODE}x`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: { code: 'invalid_code', message: 'コードが違います' } });
  await s.close();
});

test('名前が無い・空・長すぎる・コードが無いは 400', async () => {
  const s = await startInvite();
  for (const b of [
    { code: s.secrets.TEAM_CODE },
    { name: '   ', code: s.secrets.TEAM_CODE },
    { name: 'あ'.repeat(31), code: s.secrets.TEAM_CODE },
    { name: 'はると' },
    { name: 'はると', code: '' },
    { name: 5, code: s.secrets.TEAM_CODE },
  ]) {
    const res = await s.post('/api/login', b);
    assert.equal(res.status, 400, JSON.stringify(b));
    assert.equal((await res.json()).error.code, 'invalid_argument');
  }
  const notObject = await s.post('/api/login', [1]);
  assert.equal(notObject.status, 400);
  await s.close();
});

test('同じ名前は別のトークンでも同じ userId、別の名前は別の userId', async () => {
  const s = await startInvite();
  const a = await (await s.login('Haruto')).json();
  s.clock.t += 1000;
  const b = await (await s.login('ｈａｒｕｔｏ　')).json(); // 全角・大文字小文字・空白の違いは同じ名前
  assert.notEqual(a.token, b.token);
  assert.equal(a.user.id, b.user.id);
  const c = await (await s.login('Mina')).json();
  assert.notEqual(a.user.id, c.user.id);
  await s.close();
});

test('改ざんしたトークンは 401', async () => {
  const s = await startInvite();
  const { token, user } = await (await s.login('はると')).json();
  const [head, sig] = token.split('.');
  const other = Buffer.from(JSON.stringify({ uid: 'u_' + 'A'.repeat(22), exp: Math.floor(T0 / 1000) + 3600 })).toString('base64url');
  const flipped = `${head}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  for (const bad of [`${other}.${sig}`, flipped, head, `${head}.`, '.', 'abc', `${token}.x`, '']) {
    const res = await s.authed(bad);
    assert.equal(res.status, 401, bad);
    assert.equal((await res.json()).error.code, 'unauthenticated');
  }
  // 別の鍵で署名したもの
  const forged = signToken('x'.repeat(32), user.id, Math.floor(T0 / 1000) + 3600);
  assert.equal((await s.authed(forged)).status, 401);
  // Bearer 以外の書き方・ヘッダなし
  assert.equal((await fetch(`${s.base}/api/me`, { headers: { authorization: token } })).status, 401);
  assert.equal((await fetch(`${s.base}/api/me`, { headers: { authorization: `Basic ${token}` } })).status, 401);
  assert.equal((await fetch(`${s.base}/api/me`)).status, 401);
  await s.close();
});

test('期限が切れたトークンは 401（直前までは通る）', async () => {
  const s = await startInvite(); // 1 時間
  const { token } = await (await s.login('はると')).json();
  s.clock.t = T0 + 3600 * 1000 - 1000;
  assert.equal((await s.authed(token)).status, 200);
  s.clock.t = T0 + 3600 * 1000;
  assert.equal((await s.authed(token)).status, 401);
  await s.close();
});

test('TOKEN_TTL_HOURS が空なら 72 時間', async () => {
  const s = await startInvite({ env: { TOKEN_TTL_HOURS: '' } });
  const { token } = await (await s.login('はると')).json();
  s.clock.t = T0 + 72 * 3600 * 1000 - 1000;
  assert.equal((await s.authed(token)).status, 200);
  s.clock.t = T0 + 72 * 3600 * 1000;
  assert.equal((await s.authed(token)).status, 401);
  await s.close();
});

test('invite では x-dev-user が効かない（トークンと一緒に送っても本人は変わらない）', async () => {
  const s = await startInvite();
  const res = await fetch(`${s.base}/api/me`, { headers: { 'x-dev-user': 'u1' } });
  assert.equal(res.status, 401);
  const { token, user } = await (await s.login('はると')).json();
  const both = await s.authed(token, '/api/me', { headers: { 'x-dev-user': 'u1' } });
  assert.equal((await both.json()).id, user.id);
  await s.close();
});

test('失敗 6 回目が 429。成功しても失敗の数は戻らない。コードが合っていても止まったまま', async () => {
  const s = await startInvite();
  for (let i = 0; i < 4; i++) assert.equal((await s.login('はると', 'ng')).status, 401);
  assert.equal((await s.login('はると')).status, 200); // 成功しても数は戻さない
  assert.equal((await s.login('はると', 'ng')).status, 401); // 5 回目の失敗
  const sixth = await s.login('はると', 'ng');
  assert.equal(sixth.status, 429);
  assert.equal((await sixth.json()).error.code, 'rate_limited');
  assert.equal((await s.login('はると')).status, 429); // 合っていても通さない（総当たりの続きを許さない）
  // 5 分たてば戻る
  s.clock.t += 5 * 60 * 1000;
  assert.equal((await s.login('はると')).status, 200);
  await s.close();
});

test('数えるのは接続元ごと（x-forwarded-for の最後の値）。前の値を変えても逃げられない', async () => {
  const s = await startInvite();
  for (let i = 0; i < 5; i++) {
    assert.equal((await s.login('はると', 'ng', { 'x-forwarded-for': `spoof-${i}, 203.0.113.9` })).status, 401);
  }
  assert.equal((await s.login('はると', 'ng', { 'x-forwarded-for': 'spoof-x, 203.0.113.9' })).status, 429);
  // 別の接続元はまだ入れる
  assert.equal((await s.login('はると', s.secrets.TEAM_CODE, { 'x-forwarded-for': '198.51.100.7' })).status, 200);
  await s.close();
});

test('全体でも 5 分に 30 回まで。超えたら別の接続元でも 429', async () => {
  const s = await startInvite();
  for (let i = 0; i < 30; i++) {
    const res = await s.login('はると', 'ng', { 'x-forwarded-for': `192.0.2.${i}` });
    assert.equal(res.status, 401, `${i}`);
  }
  const res = await s.login('はると', 'ng', { 'x-forwarded-for': '192.0.2.200' });
  assert.equal(res.status, 429);
  assert.equal((await s.login('はると', s.secrets.TEAM_CODE, { 'x-forwarded-for': '192.0.2.201' })).status, 429);
  s.clock.t += 5 * 60 * 1000;
  assert.equal((await s.login('はると', s.secrets.TEAM_CODE, { 'x-forwarded-for': '192.0.2.201' })).status, 200);
  await s.close();
});

test('他の人のデータに届かない（別の名前でログインした人の目標は 404）', async () => {
  const s = await startInvite();
  const a = await (await s.login('はると')).json();
  const b = await (await s.login('みな')).json();
  const created = await s.authed(a.token, '/api/goals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '二次方程式を解けるようにする', deadline: '2026-12-01T00:00:00.000Z', minutesPerDay: 30 }),
  });
  assert.equal(created.status, 201);
  const goal = await created.json();
  assert.equal((await s.authed(a.token, `/api/goals/${goal.id}`)).status, 200);
  assert.equal((await s.authed(b.token, `/api/goals/${goal.id}`)).status, 404);
  const list = await (await s.authed(b.token, '/api/goals')).json();
  assert.deepEqual(list.goals, []);
  await s.close();
});

test('起動時の検査: コードが短い・鍵が足りない・短いと起動しない（文に値を出さない）', async () => {
  const good = makeSecrets();
  const make = (env) => () => createApp({ config: loadConfig({ GEMINI_MODE: 'fake', AUTH_MODE: 'invite', ...env }) });
  assert.doesNotThrow(make(good));
  const cases = [
    { ...good, TEAM_CODE: 'a'.repeat(7) },
    { ...good, TEAM_CODE: '        ' },
    { ...good, TEAM_CODE: undefined },
    { ...good, SESSION_SECRET: 'b'.repeat(31) },
    { ...good, SESSION_SECRET: undefined },
    { ...good, TOKEN_TTL_HOURS: 'abc' },
    { ...good, TOKEN_TTL_HOURS: '0' },
  ];
  for (const env of cases) {
    let err;
    try {
      make(env)();
    } catch (e) {
      err = e;
    }
    assert.ok(err, JSON.stringify(Object.keys(env)));
    for (const v of Object.values(env)) {
      if (v && v.trim().length >= 4) assert.ok(!String(err.message).includes(v), '例外の文に値が出ている');
    }
  }
});

test('invite は Cloud Run(K_SERVICE あり)でも起動できる。fake は今までどおり起動しない', () => {
  const good = makeSecrets();
  assert.doesNotThrow(() =>
    createApp({ config: loadConfig({ GEMINI_MODE: 'fake', AUTH_MODE: 'invite', ...good }), env: { K_SERVICE: 'app' } }),
  );
  assert.throws(
    () => createApp({ config: loadConfig({ AUTH_MODE: 'fake' }), env: { K_SERVICE: 'app' } }),
    /Cloud Run では使えません/,
  );
});

test('GET /api/health は方式を返す（invite は loginRequired も）', async () => {
  const s = await startInvite();
  assert.deepEqual(await (await fetch(`${s.base}/api/health`)).json(), { ok: true, store: 'memory', auth: 'invite', loginRequired: true });
  await s.close();
});

test('invite 以外では /api/login は無い（404）', async () => {
  const s = await start();
  const res = await fetch(`${s.base}/api/login`, { method: 'POST', body: '{"name":"a","code":"b"}' });
  assert.equal(res.status, 404);
  await s.close();
});

test('ログに入力されたコードも名前も出ない（成功・失敗・止められた時）', async () => {
  const lines = [];
  const grab = (...a) => lines.push(a.map(String).join(' '));
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = grab;
  const s = await startInvite(); // log は既定（console.warn）
  const name = `名前-${rand(4)}`;
  const wrong = `wrong-${rand(6)}`;
  try {
    for (let i = 0; i < 6; i++) await s.login(name, wrong);
    await s.login(name);
    await s.login(name, s.secrets.TEAM_CODE, { 'x-forwarded-for': '198.51.100.1' });
  } finally {
    Object.assign(console, orig);
  }
  await s.close();
  assert.ok(lines.length >= 6, '失敗はログに出す');
  const all = lines.join('\n');
  for (const secret of [name, wrong, s.secrets.TEAM_CODE, s.secrets.SESSION_SECRET]) {
    assert.ok(!all.includes(secret), 'ログに入力が出ている');
  }
});

// ---- 純粋な部分 ----
test('名前の正規化と userId', () => {
  assert.equal(normalizeName('  ＨＡＲＵＴＯ　'), 'haruto');
  const secret = rand(24);
  assert.equal(userIdFor(secret, 'Haruto'), userIdFor(secret, ' haruto '));
  assert.notEqual(userIdFor(secret, 'haruto'), userIdFor(rand(24), 'haruto')); // 鍵が違えば別
  assert.match(userIdFor(secret, 'haruto'), /^u_[A-Za-z0-9_-]{22}$/);
});

test('トークンの署名と検証（期限の境目）', () => {
  const secret = rand(24);
  const uid = userIdFor(secret, 'haruto');
  const t = signToken(secret, uid, 1000);
  assert.equal(verifyToken(secret, t, 999), uid);
  assert.equal(verifyToken(secret, t, 1000), null);
  assert.equal(verifyToken(rand(24), t, 0), null);
  assert.equal(verifyToken(secret, undefined, 0), null);
  assert.equal(verifyToken(secret, 'x'.repeat(2000), 0), null);
  // uid の形が違うものは、署名が正しくても通さない
  assert.equal(verifyToken(secret, signToken(secret, 'u1', 1000), 0), null);
});

test('コードの比較は長さが違っても落ちない', () => {
  const code = `team-${rand(6)}`;
  assert.equal(codeMatches(code, code), true);
  assert.equal(codeMatches(code, `${code}x`), false);
  assert.equal(codeMatches(code, ''), false);
  assert.equal(codeMatches(code, undefined), false);
  assert.equal(codeMatches(code, 123), false);
});

test('Authorization ヘッダの読み取りと接続元の決め方', () => {
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(bearerToken('bearer abc'), 'abc');
  assert.equal(bearerToken('Bearer'), null);
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(undefined), null);
  assert.equal(clientKey({ headers: { 'x-forwarded-for': 'a, b , 203.0.113.9' }, socket: { remoteAddress: 'z' } }), '203.0.113.9');
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
  assert.equal(clientKey({ headers: { 'x-forwarded-for': ' ' }, socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
  assert.equal(clientKey({ headers: {} }), 'unknown');
});
