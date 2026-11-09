import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini } from '../src/gemini/index.js';
import { createLimiter } from '../src/limiter.js';
import { loadConfig } from '../src/config.js';
import { HttpError } from '../src/http.js';
import { createModelGate, createVertexClient, retryDelayMs, UPSTREAM_BUSY_MESSAGE } from '../src/gemini/vertex.js';

// #226 Vertex の 429・503 を 1 回やり直す・自前の回数制限と区別する・同時呼び出しを絞る。
// ネットワーク・認証は使わない。待ち時間は偽物（0 ms）にする。
const FAKE_TOKEN = ['tok', 'en', Math.random().toString(36).slice(2)].join('-');
const PROJECT = ['demo', 'project', '1'].join('-');
const config = loadConfig({ GEMINI_MODE: 'real', GCP_PROJECT_ID: PROJECT });
const input = { system: 'あなたは先生です', user: '<user_text>こんにちは</user_text>' };
const schema = { type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } };
const okBody = (obj) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const res = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});
const isBusy = (e) => e instanceof HttpError && e.status === 503 && e.code === 'upstream_busy' && e.message === UPSTREAM_BUSY_MESSAGE;

function client(respond, over = {}) {
  const calls = [];
  const logs = [];
  const sleeps = [];
  const real = createVertexClient({
    config,
    fetchImpl: async (url, init) => {
      calls.push(url);
      return respond(calls.length, url, init);
    },
    getToken: async () => FAKE_TOKEN,
    log: (l) => logs.push(l),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...over,
  });
  return { real, calls, logs, sleeps };
}
const upstreamLogs = (logs) => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

test('1 回目 429・2 回目 200 なら成功する（待ちは 0.8〜1.5 秒の間）', async () => {
  const c = client((n) => (n === 1 ? res(429) : res(200, okBody({ reply: 'はい' }))));
  const r = await c.real({ purpose: 'hint', input, schema });
  assert.deepEqual(r.output, { reply: 'はい' });
  assert.equal(c.calls.length, 2);
  assert.equal(c.sleeps.length, 1);
  assert.ok(c.sleeps[0] >= 800 && c.sleeps[0] <= 1500);
  assert.deepEqual(upstreamLogs(c.logs).map(({ ms, ...rest }) => rest), [
    { evt: 'gemini_upstream', purpose: 'hint', model: 'gemini-3.8-flash', status: '200', retried: true },
  ]);
});

test('1 回目 503・2 回目 200 も成功する', async () => {
  const c = client((n) => (n === 1 ? res(503) : res(200, okBody({ reply: 'はい' }))));
  assert.deepEqual((await c.real({ purpose: 'hint', input, schema })).output, { reply: 'はい' });
  assert.equal(c.calls.length, 2);
});

test('2 回とも 429 なら 503 upstream_busy（3 回目は呼ばない）', async () => {
  const c = client(() => res(429));
  await assert.rejects(() => c.real({ purpose: 'hint', input, schema }), isBusy);
  assert.equal(c.calls.length, 2);
  const [u] = upstreamLogs(c.logs);
  assert.equal(u.status, '429');
  assert.equal(u.retried, true);
});

test('Retry-After: 秒・日付を読み、上限は 3 秒。無い・読めない時は 0.8〜1.5 秒', () => {
  assert.equal(retryDelayMs('2'), 2000);
  assert.equal(retryDelayMs('0'), 0);
  assert.equal(retryDelayMs('10'), 3000);
  const now = () => Date.parse('2026-11-08T00:00:00Z');
  assert.equal(retryDelayMs('Sun, 08 Nov 2026 00:00:01 GMT', { now }), 1000);
  assert.equal(retryDelayMs('Sun, 08 Nov 2026 01:00:00 GMT', { now }), 3000);
  assert.equal(retryDelayMs('Sat, 07 Nov 2026 00:00:00 GMT', { now }), 0);
  assert.equal(retryDelayMs(null, { random: () => 0 }), 800);
  assert.equal(retryDelayMs('abc', { random: () => 0.9999 }), 1499);
});

test('Retry-After の値を待ち時間に使う（応答の見出しから）', async () => {
  const c = client((n) => (n === 1 ? res(429, {}, { 'retry-after': '1' }) : res(200, okBody({ reply: 'x' }))));
  await c.real({ purpose: 'hint', input, schema });
  assert.deepEqual(c.sleeps, [1000]);
  const c2 = client((n) => (n === 1 ? res(503, {}, { 'retry-after': '60' }) : res(200, okBody({ reply: 'x' }))));
  await c2.real({ purpose: 'hint', input, schema });
  assert.deepEqual(c2.sleeps, [3000]);
});

test('400・401・403・500・接続の失敗はやり直さない', async () => {
  for (const status of [400, 401, 403, 500]) {
    const c = client(() => res(status));
    await assert.rejects(() => c.real({ purpose: 'hint', input, schema }), (e) => e.status === 502);
    assert.equal(c.calls.length, 1, `status ${status}`);
    assert.equal(c.sleeps.length, 0);
    assert.equal(upstreamLogs(c.logs)[0].retried, false);
  }
  const net = client(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(() => net.real({ purpose: 'hint', input, schema }), (e) => e.status === 502);
  assert.equal(net.calls.length, 1);
});

test('同時の呼び出しはモデルごとに 4 本まで。終わった分だけ次が走る・別のモデルは待たない', async () => {
  const pending = [];
  const gate = createModelGate({ max: 4, waitMs: 5_000 });
  const c = client(
    () =>
      new Promise((resolve) => {
        pending.push(() => resolve(res(200, okBody({ reply: 'x' }))));
      }),
    { gate },
  );
  const tick = () => new Promise((r) => setImmediate(r));
  const runs = Array.from({ length: 6 }, () => c.real({ purpose: 'hint', input, schema }));
  await tick();
  assert.equal(c.calls.length, 4);
  assert.deepEqual(gate.stats('gemini-3.8-flash'), { active: 4, waiting: 2 });
  const other = c.real({ purpose: 'roadmap', input, schema }); // 上位のモデルは別の枠
  await tick();
  assert.equal(c.calls.length, 5);
  pending.shift()();
  await tick();
  await tick();
  assert.equal(c.calls.length, 6);
  while (pending.length > 0 || c.calls.length < 7) {
    pending.shift()?.();
    await tick();
  }
  await Promise.all([...runs, other]);
  assert.equal(c.calls.length, 7);
  assert.deepEqual(gate.stats('gemini-3.8-flash'), { active: 0, waiting: 0 });
});

test('枠の待ちが長すぎたら 503 upstream_busy（Vertex は呼ばない）', async () => {
  const gate = createModelGate({ max: 1, waitMs: 20 });
  let finish;
  const c = client(
    (n) =>
      n === 1
        ? new Promise((resolve) => {
            finish = () => resolve(res(200, okBody({ reply: 'x' })));
          })
        : res(200, okBody({ reply: 'x' })),
    { gate },
  );
  const first = c.real({ purpose: 'hint', input, schema });
  await assert.rejects(() => c.real({ purpose: 'hint', input, schema }), isBusy);
  assert.equal(c.calls.length, 1);
  assert.equal(upstreamLogs(c.logs)[0].status, 'queue_timeout');
  finish();
  await first;
  assert.deepEqual(gate.stats('gemini-3.8-flash'), { active: 0, waiting: 0 });
  await c.real({ purpose: 'hint', input, schema }); // 枠は戻っている
  assert.equal(c.calls.length, 2);
});

test('自前の上限は 429 rate_limited のまま・やり直しても点は 1 回分だけ', async () => {
  const c = client((n) => (n % 2 === 1 ? res(429) : res(200, okBody({ reply: 'はい' }))));
  const limiter = createLimiter({ perUserPerDay: 2, totalPerDay: 10 });
  const g = createGemini({ mode: 'real', limiter, real: c.real, log: () => {} });
  await g.generate({ purpose: 'hint', input, schema, userId: 'u1' });
  assert.equal(c.calls.length, 2);
  assert.equal(limiter.used('u1'), 1);

  const busy = client(() => res(429));
  const g2 = createGemini({ mode: 'real', limiter, real: busy.real, log: () => {} });
  await assert.rejects(() => g2.generate({ purpose: 'hint', input, schema, userId: 'u1' }), isBusy);
  assert.equal(limiter.used('u1'), 2);
  await assert.rejects(
    () => g2.generate({ purpose: 'hint', input, schema, userId: 'u1' }),
    (e) => e.status === 429 && e.code === 'rate_limited',
  );
  assert.equal(busy.calls.length, 2); // 自前の上限で止まった分は Vertex に行かない
});

test('上流のログに本文・入力・ユーザー ID・トークンが無い（項目は 6 つだけ）', async () => {
  const userId = ['user', 'id', 'x'].join('-');
  const c = client(() => res(429, { error: { message: 'プロンプト全文: ひみつ' } }));
  const g = createGemini({ mode: 'real', real: c.real, log: (l) => c.logs.push(l) });
  await assert.rejects(() => g.generate({ purpose: 'hint', input, schema, userId }), isBusy);
  for (const l of c.logs) {
    for (const bad of ['ひみつ', 'こんにちは', '先生', userId, FAKE_TOKEN]) assert.ok(!l.includes(bad), `${bad} がログにある`);
  }
  const u = upstreamLogs(c.logs).find((x) => x.evt === 'gemini_upstream');
  assert.deepEqual(Object.keys(u), ['evt', 'purpose', 'model', 'status', 'retried', 'ms']);
});
