import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { start } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { signToken, userIdFor, verifyToken } from '../src/auth/invite.js';
import { C } from '../src/common/collections.js';
import { HttpError } from '../src/http.js';

// 安全性の点検（docs/security-audit-2026-11-07.md）で足した試験。
// 秘密のダミー値は本物の形にせず、実行時に組み立てる（AGENTS.md）。

const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });

function caller(base) {
  return async (method, path, user, payload) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: user ? h(user) : {},
      body: payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
}

// PNG の先頭 8 バイト＋埋め 4 バイト（base64 で 16 文字）。中身の検査（先頭のバイト）だけ通る見本。
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4)]).toString('base64');
const photo = { mimeType: 'image/png', dataBase64: PNG };

// ① 他人の ID を指定しても、読めない・書けない・Gemini も呼ばれない
test('他人の goalId・sessionId を指定した経路は全て 404 で、相手の記録も回数も変わらない', async () => {
  const s = await start();
  const call = caller(s.base);
  // A（持ち主）の記録を API で作る: 目標 → 自作のロードマップ → 集中 → 終える → 振り返り
  const goal = (await call('POST', '/api/goals', 'A', { text: '課題', deadline: '2026-12-01T00:00:00Z', minutesPerDay: 30 })).json;
  const cps = [1, 2, 3].map((i) => ({ title: `t${i}`, doneMark: `m${i}`, estimateMin: 10 }));
  const roadmap = await call('POST', `/api/goals/${goal.id}/roadmap`, 'A', { source: 'own', why: '自分で', checkpoints: cps });
  assert.equal(roadmap.status, 201);
  const [c1, c2] = roadmap.json.checkpoints;
  const done = (await call('POST', '/api/sessions', 'A', { goalId: goal.id, checkpointId: c1.id, oneLine: 'やる' })).json;
  await call('POST', `/api/sessions/${done.id}/end`, 'A');
  assert.equal((await call('POST', `/api/sessions/${done.id}/reflect`, 'A', { note: '', done: false })).status, 200);
  const live = (await call('POST', '/api/sessions', 'A', { goalId: goal.id, checkpointId: c2.id, oneLine: '次' })).json;

  const before = {
    goal: await s.ctx.store.get(C.goals, goal.id),
    roadmap: await s.ctx.store.get(C.roadmaps, goal.id),
    done: await s.ctx.store.get(C.sessions, done.id),
    live: await s.ctx.store.get(C.sessions, live.id),
    events: (await s.ctx.store.list(C.events, { userId: 'A' })).length,
    messages: (await s.ctx.store.list(C.tutorMessages, {})).length,
    geminiA: s.ctx.limiter.used('A'),
  };

  // B（他人）が A の ID で叩く
  const attempts = [
    ['GET', `/api/goals/${goal.id}`],
    ['POST', `/api/goals/${goal.id}/candidates`],
    ['POST', `/api/goals/${goal.id}/roadmap`, { source: 'own', why: '乗っ取り', checkpoints: cps }],
    ['POST', '/api/sessions', { goalId: goal.id, checkpointId: c2.id, oneLine: '乗っ取り' }],
    ['POST', `/api/sessions/${live.id}/events`, { type: 'leave' }],
    ['POST', `/api/sessions/${live.id}/end`],
    ['GET', `/api/sessions/${live.id}/tutor`],
    ['POST', `/api/sessions/${live.id}/tutor`, { kind: 'ask', text: '答えは？', images: [photo] }],
    ['POST', `/api/sessions/${done.id}/reflect`, { note: '', done: false, images: [photo] }],
    ['POST', `/api/sessions/${done.id}/reflect/confirm`, { achievement: 3 }],
  ];
  for (const [method, path, payload] of attempts) {
    const r = await call(method, path, 'B', payload);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.deepEqual(r.json, { error: { code: 'not_found', message: '見つかりません' } }, `${method} ${path}`);
  }

  // B の一覧系にも A の物は出ない
  assert.deepEqual((await call('GET', '/api/goals', 'B')).json.goals, []);
  assert.equal((await call('GET', '/api/sessions/active', 'B')).json.session, null);
  const home = (await call('GET', '/api/home', 'B')).json;
  assert.deepEqual([home.goals, home.active, home.toReflect, home.feed], [[], null, [], []]);
  assert.equal((await call('GET', '/api/tower', 'B')).json.totalFloors, 0);

  assert.deepEqual(await s.ctx.store.get(C.goals, goal.id), before.goal);
  assert.deepEqual(await s.ctx.store.get(C.roadmaps, goal.id), before.roadmap);
  assert.deepEqual(await s.ctx.store.get(C.sessions, done.id), before.done);
  assert.deepEqual(await s.ctx.store.get(C.sessions, live.id), before.live);
  assert.equal((await s.ctx.store.list(C.events, { userId: 'A' })).length, before.events);
  assert.equal((await s.ctx.store.list(C.events, { userId: 'B' })).length, 0);
  assert.equal((await s.ctx.store.list(C.tutorMessages, {})).length, before.messages);
  assert.equal(s.ctx.limiter.used('A'), before.geminiA);
  assert.equal(s.ctx.limiter.used('B'), 0); // 他人の ID では Gemini を呼ばない（予算を使わない）
  await s.close();
});

// ④ トークン: 署名の部分は決まった形（43 文字の base64url）だけ。同じ署名の別の書き方も通さない
test('トークン: 署名の後ろに base64url でない文字を足した物・余計な = を付けた物は通らない', () => {
  const secret = randomBytes(24).toString('hex');
  const uid = userIdFor(secret, 'はると');
  const nowSec = 1_000_000;
  const token = signToken(secret, uid, nowSec + 60);
  assert.equal(verifyToken(secret, token, nowSec), uid);
  const [head, sig] = token.split('.');
  assert.equal(sig.length, 43);
  for (const bad of [`${token}!`, `${token}=`, `${token}*`, `${head}.${sig.slice(0, 20)}!${sig.slice(20)}`, `${head}.${sig.slice(0, 42)}`]) {
    assert.equal(verifyToken(secret, bad, nowSec), null, bad);
  }
});

// ⑥ 回数制限の設定が数として読めない時に、上限が消えない（NaN だと比較がいつも false になる）
test('設定: 回数制限・出力の上限が数として読めない時は既定に戻る（上限が消えない）。0 は受ける', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const v of ['abc', '-1', '1.5', 'Infinity', ' ']) {
      const c = loadConfig({ GEMINI_LIMIT_PER_USER_PER_DAY: v, GEMINI_LIMIT_TOTAL_PER_DAY: v, GEMINI_MAX_OUTPUT_TOKENS: v });
      assert.equal(c.geminiLimitPerUserPerDay, 150, v);
      assert.equal(c.geminiLimitTotalPerDay, 1500, v);
      assert.equal(c.geminiMaxOutputTokens, 8192, v);
    }
    const zero = loadConfig({ GEMINI_LIMIT_PER_USER_PER_DAY: '0', GEMINI_LIMIT_TOTAL_PER_DAY: '0', GEMINI_MAX_OUTPUT_TOKENS: '0' });
    assert.equal(zero.geminiLimitPerUserPerDay, 0);
    assert.equal(zero.geminiLimitTotalPerDay, 0);
    assert.equal(zero.geminiMaxOutputTokens, 8192); // 出力 0 は使えないので既定
    const set = loadConfig({ GEMINI_LIMIT_PER_USER_PER_DAY: '7', GEMINI_LIMIT_TOTAL_PER_DAY: '70', GEMINI_MAX_OUTPUT_TOKENS: '1024' });
    assert.deepEqual([set.geminiLimitPerUserPerDay, set.geminiLimitTotalPerDay, set.geminiMaxOutputTokens], [7, 70, 1024]);
  } finally {
    console.warn = warn;
  }
});

test('設定の値が壊れていても、アプリの点の制限は既定の 150 点で止まる', async () => {
  const warn = console.warn;
  console.warn = () => {};
  const s = await start({}, { GEMINI_LIMIT_PER_USER_PER_DAY: 'oops' });
  console.warn = warn;
  for (let i = 0; i < 150; i++) s.ctx.limiter.take('u1');
  assert.throws(() => s.ctx.limiter.take('u1'), (e) => e instanceof HttpError && e.status === 429);
  await s.close();
});

// ⑥ 同時リクエスト・失敗でも数え漏れない
// 写真付きの material は 3+2=5 点。上限 10 点＝2 回分。
test('Gemini の点の制限: 同時に 5 本送っても上限（2 回分）を超えて呼ばれない', async () => {
  let calls = 0;
  const material = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20)); // 呼び出し中に次の要求が来るように
    return { text: '書き起こし' };
  };
  const s = await start({ fakeResponses: { material } }, { GEMINI_LIMIT_PER_USER_PER_DAY: '10' });
  const call = caller(s.base);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => call('POST', '/api/materials/read', 'u1', { images: [photo] })),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 429, 429, 429]);
  assert.equal(calls, 2);
  await s.close();
});

test('Gemini の点の制限: 失敗（502）した呼び出しも数え、再送で上限を越えない', async () => {
  let calls = 0;
  const material = async () => {
    calls += 1;
    throw new HttpError(502, 'upstream_invalid', 'AI の出力が期待した形ではありません');
  };
  const s = await start({ fakeResponses: { material } }, { GEMINI_LIMIT_PER_USER_PER_DAY: '10' });
  const call = caller(s.base);
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await call('POST', '/api/materials/read', 'u1', { images: [photo] })).status);
  assert.deepEqual(statuses, [502, 502, 429, 429]);
  assert.equal(calls, 2);
  await s.close();
});

// ⑤ 本文の上限: 写真の 3 経路だけ 6MB、他は 64KB
test('本文の上限: 写真の 3 経路は 64KB を超えても受け、他の書く経路は 64KB で 413', async () => {
  const s = await start();
  const call = caller(s.base);
  const big = JSON.stringify({ pad: 'x'.repeat(100 * 1024) });
  for (const path of ['/api/sessions/none/tutor', '/api/sessions/none/reflect', '/api/materials/read']) {
    const r = await call('POST', path, 'u1', big);
    assert.notEqual(r.status, 413, path); // 本文は読めて、その先の検査（404・400）で止まる
  }
  for (const [method, path] of [
    ['POST', '/api/goals'],
    ['POST', '/api/goals/none/roadmap'],
    ['POST', '/api/sessions'],
    ['POST', '/api/sessions/none/events'],
    ['POST', '/api/sessions/none/end'],
    ['POST', '/api/sessions/none/reflect/confirm'],
    ['POST', '/api/friends'],
    ['PUT', '/api/me'],
  ]) {
    const r = await call(method, path, 'u1', big);
    assert.equal(r.status, 413, `${method} ${path}`);
    assert.equal(r.json.error.code, 'too_large');
  }
  await s.close();
});

// ⑨ エラーの文に内部の情報（パス・スタック）を出さない
test('不正な入力のエラーは項目名だけで、送った値もサーバーの内部も返さない', async () => {
  const s = await start();
  const call = caller(s.base);
  const marker = `zz${randomBytes(4).toString('hex')}`;
  const r = await call('PUT', '/api/me', 'u1', { nudgeLevel: marker });
  assert.equal(r.status, 400);
  const text = JSON.stringify(r.json);
  assert.ok(!text.includes(marker));
  assert.ok(!/\/home\/|node:|at .+\(/.test(text));
  await s.close();
});
