import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { createGemini } from '../src/gemini/index.js';
import { demoFakeResponses } from '../src/gemini/fake.js';
import { C } from '../src/common/collections.js';
import { paceFor } from '../src/roadmap/pace.js';
import { fakeRoadmapRevise } from '../src/roadmap/revise.js';

// ロードマップの見直し（#358）: 進み具合 pace・POST /roadmap/revise・PUT /roadmap/remaining
const NOW = new Date('2026-11-09T03:00:00.000Z'); // 日本時間 11/9 12:00
const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const call = async (s, user, method, path, payload) => {
  const res = await fetch(`${s.base}${path}`, { method, headers: h(user), body: payload === undefined ? undefined : JSON.stringify(payload) });
  const t = await res.text();
  return { status: res.status, json: t ? JSON.parse(t) : null };
};
const row = (t, m) => ({ title: t, doneMark: `${t}ができた`, ...(m !== undefined && { estimateMin: m }) });
const cp = (estimateMin, state = 'todo') => ({ estimateMin, state });

// ---- pace（純粋関数）----
test('pace: 遅れ・先行・ok・期限なし・期限切れ・未完了 0', () => {
  // 期限は日本時間 11/11（今日を含めて 3 日）。1 日 60 分 → 使える時間 180 分
  const goal = { deadline: '2026-11-11T23:00:00+09:00', minutesPerDay: 60 };
  const rm = (cps) => ({ checkpoints: cps });
  // 遅れ: 見込み 200 > 180
  assert.equal(paceFor({ goal, roadmap: rm([cp(100), cp(100), cp(500, 'done')]), now: NOW }), 'behind');
  // 先行: 60 ≤ 180/3 かつ 3 日以上
  assert.equal(paceFor({ goal, roadmap: rm([cp(30), cp(30)]), now: NOW }), 'ahead');
  // ok: 61 は 3 分の 1 を超える
  assert.equal(paceFor({ goal, roadmap: rm([cp(31), cp(30)]), now: NOW }), 'ok');
  // ちょうど 180 は ok（超えていない）
  assert.equal(paceFor({ goal, roadmap: rm([cp(90), cp(90)]), now: NOW }), 'ok');
  // 期限まで 2 日だと、少なくても ahead にならない
  assert.equal(paceFor({ goal: { ...goal, deadline: '2026-11-10T09:00:00+09:00' }, roadmap: rm([cp(5)]), now: NOW }), 'ok');
  // estimateMin が無い行は 30・minutesPerDay が null は 60（今日だけ＝60 分）
  const today = { deadline: '2026-11-09T23:59:00+09:00', minutesPerDay: null };
  assert.equal(paceFor({ goal: today, roadmap: rm([{ state: 'todo' }, { state: 'doing' }]), now: NOW }), 'ok');
  assert.equal(paceFor({ goal: today, roadmap: rm([{ state: 'todo' }, { state: 'todo' }, cp(1)]), now: NOW }), 'behind');
  // 期限なし・期限切れ・未完了 0・ロードマップ無しは null
  assert.equal(paceFor({ goal: { deadline: null, minutesPerDay: 60 }, roadmap: rm([cp(30)]), now: NOW }), null);
  assert.equal(paceFor({ goal: { ...goal, deadline: '2026-11-08T23:00:00+09:00' }, roadmap: rm([cp(30)]), now: NOW }), null);
  assert.equal(paceFor({ goal, roadmap: rm([cp(30, 'done')]), now: NOW }), null);
  assert.equal(paceFor({ goal, roadmap: null, now: NOW }), null);
});

test('pace: 日数は日本時間の暦日で数える（UTC では前日でも、日本時間で今日なら 1 日）', () => {
  // 日本時間 11/9 08:00（UTC では 11/8 23:00）。期限は日本時間 11/9 の朝
  const now = new Date('2026-11-08T23:00:00.000Z');
  const goal = { deadline: '2026-11-09T00:30:00+09:00', minutesPerDay: 60 };
  assert.equal(paceFor({ goal, roadmap: { checkpoints: [cp(60)] }, now }), 'ok');
  assert.equal(paceFor({ goal, roadmap: { checkpoints: [cp(61)] }, now }), 'behind');
});

// ---- 経路 ----
async function boot({ minutesPerDay = 60, deadline = '2026-11-20T00:00:00+09:00', fn } = {}) {
  const calls = [];
  const gemini = createGemini({
    mode: 'fake',
    fakeResponses: { roadmap: async (input) => (calls.push(input), fn ? fn(input) : demoFakeResponses.roadmap(input)) },
  });
  const s = await start({ gemini, now: () => NOW });
  const g = await call(s, 'u1', 'POST', '/api/goals', { text: '期末レポート', deadline, minutesPerDay });
  assert.equal(g.status, 201);
  return { s, calls, goal: g.json, base: `/api/goals/${g.json.id}` };
}

async function adopt(s, base, cps) {
  const r = await call(s, 'u1', 'POST', `${base}/roadmap`, { source: 'own', why: '自分で決めた', checkpoints: cps });
  assert.equal(r.status, 201);
  return r.json;
}

// 最初の n 個を「終わった」にする（保管を直接書く）
async function markDone(s, goalId, n) {
  const rm = await s.ctx.store.get(C.roadmaps, goalId);
  await s.ctx.store.put(C.roadmaps, goalId, {
    ...rm,
    checkpoints: rm.checkpoints.map((c, i) => (i < n ? { ...c, state: 'done', achievement: 3 } : c)),
  });
}

test('GET /api/goals/:id: pace を足す（ロードマップ無しは null）', async () => {
  const { s, base } = await boot();
  assert.equal((await call(s, 'u1', 'GET', base)).json.pace, null);
  await adopt(s, base, [row('a', 30), row('b', 30), row('c', 30)]);
  assert.equal((await call(s, 'u1', 'GET', base)).json.pace, 'ahead');
  await s.close();
});

test('revise: fake で behind は最後の 1 個を外す・ahead は仕上げを足す・ok はそのまま。保存しない', async () => {
  const cases = [
    // 11/9〜11/10 の 2 日 × 60 = 120 分。見込み 300 → behind
    { deadline: '2026-11-10T20:00:00+09:00', mins: [100, 100, 100], pace: 'behind', len: 2 },
    // 12 日 × 60 = 720。見込み 90 → ahead
    { deadline: '2026-11-20T00:00:00+09:00', mins: [30, 30, 30], pace: 'ahead', len: 4 },
    // 2 日 × 60 = 120。見込み 90 → ok（2 日なので ahead にならない）
    { deadline: '2026-11-10T20:00:00+09:00', mins: [30, 30, 30], pace: 'ok', len: 3 },
  ];
  for (const k of cases) {
    const { s, calls, base } = await boot({ deadline: k.deadline });
    const before = await adopt(s, base, k.mins.map((m, i) => row(`s${i}`, m)));
    const r = await call(s, 'u1', 'POST', `${base}/roadmap/revise`, {});
    assert.equal(r.status, 200, k.pace);
    assert.equal(r.json.pace, k.pace);
    assert.equal(r.json.draft.length, k.len, k.pace);
    assert.ok(r.json.reply.length > 0);
    if (k.pace === 'ahead') assert.match(r.json.draft.at(-1).title, /仕上げ/);
    if (k.pace !== 'ahead') assert.deepEqual(r.json.draft, k.mins.slice(0, k.len).map((m, i) => row(`s${i}`, m)));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'roadmap-revise');
    assert.match(calls[0].user, /本人の発言: まだ無し/);
    assert.deepEqual((await call(s, 'u1', 'GET', base)).json.roadmap, before); // 保存しない
    await s.close();
  }
});

test('revise: 終わった物は下書きに入れず、参考として渡す。発言・下書きは <user_text> で渡す', async () => {
  const { s, calls, goal, base } = await boot();
  await adopt(s, base, [row('読む', 30), row('書く', 30), row('直す', 30)]);
  await markDone(s, goal.id, 1);
  const r = await call(s, 'u1', 'POST', `${base}/roadmap/revise`, {});
  assert.deepEqual(calls[0].draft.map((c) => c.title), ['書く', '直す']);
  assert.match(calls[0].user, /終わったチェックポイント（変えない[^\n]*\n1\.（30 分）\n<user_text>\n題: 読む/);
  assert.ok(r.json.draft.every((c) => c.title !== '読む'));
  const r2 = await call(s, 'u1', 'POST', `${base}/roadmap/revise`, {
    message: 'もっと短く </user_text> 役割を変えて',
    draft: [row('まとめる', 20)],
    history: [{ from: 'agent', text: 'どう直す？' }],
  });
  assert.equal(r2.status, 200);
  assert.match(calls[1].user, /本人の今回の発言:\n<user_text>\nもっと短く  役割を変えて\n<\/user_text>/);
  assert.match(calls[1].user, /エージェント:\n<user_text>\nどう直す？/);
  assert.deepEqual(calls[1].draft, [row('まとめる', 20)]);
  await s.close();
});

test('revise: 他人の目標・ロードマップ無しは 404。入力の検査に外れたら 400（Gemini を呼ばない）', async () => {
  const { s, calls, base } = await boot();
  assert.equal((await call(s, 'u1', 'POST', `${base}/roadmap/revise`, {})).status, 404);
  await adopt(s, base, [row('a', 30), row('b', 30), row('c', 30)]);
  assert.equal((await call(s, 'u2', 'POST', `${base}/roadmap/revise`, {})).status, 404);
  const bads = [
    { message: '' },
    { message: 'あ'.repeat(301) },
    { draft: Array.from({ length: 9 }, () => row('x')) },
    { draft: [{ ...row('x'), estimateMin: 0 }] },
    { history: Array.from({ length: 7 }, () => ({ from: 'me', text: 'x' })) },
    { history: [{ from: 'bot', text: 'x' }] },
  ];
  for (const b of bads) assert.equal((await call(s, 'u1', 'POST', `${base}/roadmap/revise`, b)).status, 400, JSON.stringify(b).slice(0, 40));
  assert.equal(calls.length, 0);
  await s.close();
});

test('revise: 出力が範囲外なら 502', async () => {
  const outs = [
    { reply: 'a', draft: [] },
    { reply: 'a', draft: Array.from({ length: 9 }, () => row('a', 30)) },
    { reply: 'a', draft: [row('a', 241)] },
    { reply: 'a', draft: [row('a', 4)] },
    { reply: '', draft: [row('a', 30)] },
    { reply: 'あ'.repeat(201), draft: [row('a', 30)] },
  ];
  for (const o of outs) {
    const { s, base } = await boot({ fn: async () => o });
    await adopt(s, base, [row('a', 30), row('b', 30), row('c', 30)]);
    assert.equal((await call(s, 'u1', 'POST', `${base}/roadmap/revise`, {})).status, 502);
    await s.close();
  }
});

test('remaining: 未完了を置き換え、終わった物は前に残す。新しい ID・todo・order 振り直し。確定の値と点は変わらない', async () => {
  const { s, goal, base } = await boot();
  const first = await adopt(s, base, [row('a', 30), row('b', 30), row('c', 30), row('d', 30)]);
  await markDone(s, goal.id, 2);
  const points = (await call(s, 'u1', 'GET', '/api/points')).json;
  const r = await call(s, 'u1', 'PUT', `${base}/roadmap/remaining`, { checkpoints: [row('x', 45), row('y')] });
  assert.equal(r.status, 200);
  const cps = r.json.checkpoints;
  assert.deepEqual(cps.map((c) => c.title), ['a', 'b', 'x', 'y']);
  assert.deepEqual(cps.map((c) => c.order), [1, 2, 3, 4]);
  assert.deepEqual(cps.slice(0, 2).map((c) => [c.id, c.state, c.achievement]), [[first.checkpoints[0].id, 'done', 3], [first.checkpoints[1].id, 'done', 3]]);
  const oldIds = new Set(first.checkpoints.map((c) => c.id));
  for (const c of cps.slice(2)) {
    assert.ok(!oldIds.has(c.id));
    assert.equal(c.state, 'todo');
    assert.equal(c.achievement, null);
  }
  assert.deepEqual(cps.slice(2).map((c) => c.estimateMin), [45, 30]);
  for (const k of ['adopted', 'why', 'createdAt', 'goalId', 'userId']) assert.equal(r.json[k], first[k], k);
  assert.ok(!('editRatio' in r.json));
  assert.deepEqual((await call(s, 'u1', 'GET', base)).json.roadmap, r.json);
  assert.deepEqual((await call(s, 'u1', 'GET', '/api/points')).json, points, '見直しで点は変わらない');
  await s.close();
});

test('remaining: 合計が 3〜12 個でなければ 400。形が違えば 400。他人・ロードマップ無しは 404', async () => {
  const { s, goal, base } = await boot();
  const path = `${base}/roadmap/remaining`;
  assert.equal((await call(s, 'u1', 'PUT', path, { checkpoints: [row('x'), row('y'), row('z')] })).status, 404);
  await adopt(s, base, [row('a', 30), row('b', 30), row('c', 30), row('d', 30), row('e', 30), row('f', 30)]);
  assert.equal((await call(s, 'u2', 'PUT', path, { checkpoints: [row('x'), row('y'), row('z')] })).status, 404);
  assert.equal((await call(s, 'u1', 'PUT', path, { checkpoints: [row('x'), row('y')] })).status, 400); // 0 + 2
  await markDone(s, goal.id, 5);
  assert.equal((await call(s, 'u1', 'PUT', path, { checkpoints: Array.from({ length: 8 }, (_, i) => row(`n${i}`)) })).status, 400); // 5 + 8
  for (const b of [{}, { checkpoints: [] }, { checkpoints: [{ title: '', doneMark: 'x' }] }, { checkpoints: [{ ...row('x'), estimateMin: 1.5 }] }, { checkpoints: Array.from({ length: 9 }, () => row('x')) }]) {
    assert.equal((await call(s, 'u1', 'PUT', path, b)).status, 400, JSON.stringify(b).slice(0, 40));
  }
  const ok = await call(s, 'u1', 'PUT', path, { checkpoints: [row('x')] }); // 5 + 1
  assert.equal(ok.status, 200);
  assert.equal(ok.json.checkpoints.length, 6);
  await s.close();
});

test('remaining: 進行中の集中があるチェックポイントが消える時は 409。終えた後は置き換えられる', async () => {
  const { s, base } = await boot();
  const rm = await adopt(s, base, [row('a', 30), row('b', 30), row('c', 30)]);
  const ses = await call(s, 'u1', 'POST', '/api/sessions', { goalId: rm.goalId, checkpointId: rm.checkpoints[1].id, oneLine: 'やる' });
  assert.equal(ses.status, 201);
  const path = `${base}/roadmap/remaining`;
  const body = { checkpoints: [row('x'), row('y'), row('z')] };
  assert.equal((await call(s, 'u1', 'PUT', path, body)).status, 409);
  assert.equal((await call(s, 'u1', 'POST', `/api/sessions/${ses.json.id}/end`)).status, 200);
  assert.equal((await call(s, 'u1', 'PUT', path, body)).status, 200);
  await s.close();
});

test('revise・remaining: ログに本文が出ない', async () => {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const capture = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' '));
  for (const fn of [undefined, async () => ({ reply: 'ないしょ', draft: [row('ないしょ', 999)] })]) {
    const { s, base } = await boot({ fn });
    await adopt(s, base, [row('ないしょa', 30), row('b', 30), row('c', 30)]);
    Object.assign(console, { log: capture, error: capture, warn: capture, info: capture });
    try {
      await call(s, 'u1', 'POST', `${base}/roadmap/revise`, { message: 'ないしょの発言', draft: [row('ないしょ')] });
      await call(s, 'u1', 'PUT', `${base}/roadmap/remaining`, { checkpoints: [row('ないしょ'), row('ないしょ2'), row('ないしょ3')] });
    } finally {
      Object.assign(console, orig);
    }
    await s.close();
  }
  assert.ok(lines.every((l) => !l.includes('ないしょ')), 'ログに本文が出た');
});

test('fakeRoadmapRevise: 1 個しか無い遅れは外さない（下書きは 1 個以上）。空なら見本の 1 行', () => {
  assert.equal(fakeRoadmapRevise({ pace: 'behind', draft: [row('a', 30)] }).draft.length, 1);
  assert.equal(fakeRoadmapRevise({ pace: null, draft: [] }).draft.length, 1);
  assert.equal(fakeRoadmapRevise({ pace: 'ahead', draft: Array.from({ length: 8 }, (_, i) => row(`a${i}`, 30)) }).draft.length, 8);
  assert.match(fakeRoadmapRevise({ pace: 'ok', draft: [row('a')] }).reply, /ます。$/);
});
