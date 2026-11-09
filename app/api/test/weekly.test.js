import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { C } from '../src/common/collections.js';
import { createGemini, PURPOSES } from '../src/gemini/index.js';
import { modelFor } from '../src/gemini/vertex.js';
import { loadConfig } from '../src/config.js';
import { createLimiter } from '../src/limiter.js';
import { createMemoryStore } from '../src/store/index.js';
import { computeStats, FAKE_SUMMARY, rulesSummary, weekStart } from '../src/weekly/routes.js';

// 週のまとめ（GET /api/weekly・#202）の試験。数字はサーバー・文だけ AI・失敗はルールの文で 200。

const NOW = new Date('2026-11-08T03:00:00.000Z'); // 日本時間 11/8 12:00
const FROM = '2026-11-01T15:00:00.000Z'; // 日本時間 11/2 0:00（今日を含む 7 日の始まり）

async function setup({ reply = { lines: ['今週は手助けを借りずに進めた日がありました。', '次の一歩: 始める前に一行書く。'] }, limiter, mode = 'real', config = {} } = {}) {
  const calls = [];
  const gemini = createGemini({
    mode: 'fake',
    limiter,
    fakeResponses: {
      weekly: async (input) => {
        calls.push(input);
        return typeof reply === 'function' ? reply(input) : reply;
      },
    },
  });
  const clock = { at: NOW };
  const store = createMemoryStore({ now: () => clock.at });
  const s = await start({ gemini, store, now: () => NOW, ...(limiter && { limiter }) }, { GEMINI_MODE: mode });
  s.clock = clock;
  Object.assign(s.ctx.config, config);
  const get = async (user) => {
    const res = await fetch(`${s.base}/api/weekly`, { headers: { 'x-dev-user': user } });
    return { status: res.status, json: await res.json() };
  };
  return { s, calls, get };
}

// 終えた集中 1 件（session・floor・help の events）を入れる。events の時刻は store の時計（clock）が付ける。
let n = 0;
async function addSession(s, userId, endedAt, { focusMin = 30, floors = 2, ownScore = 70, small = 0, medium = 0 } = {}) {
  const id = `s${++n}`;
  await s.ctx.store.put(C.sessions, id, { userId, goalId: 'g', startedAt: endedAt, endedAt });
  await s.ctx.store.put(C.floors, id, { userId, sessionId: id, focusMin, floors, ownScore, at: endedAt });
  s.clock.at = new Date(endedAt);
  for (const [type, k] of [['help_small', small], ['help_medium', medium]]) {
    for (let i = 0; i < k; i++) await s.ctx.store.append(C.events, { userId, sessionId: id, type });
  }
}

const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

function assertShape(json) {
  assert.deepEqual(Object.keys(json).sort(), ['from', 'source', 'stats', 'summary', 'to']);
  assert.deepEqual(Object.keys(json.stats).sort(), ['floorsAdded', 'focusMinutes', 'helpMedium', 'helpSmall', 'selfDecided', 'sessions', 'streak']);
  assert.ok(['ai', 'rules'].includes(json.source));
  assert.ok(json.summary === null || (typeof json.summary === 'string' && Array.from(json.summary).length <= 240));
}

test('purpose weekly と既定モデル（gemini-3.8-flash）', () => {
  assert.ok(PURPOSES.includes('weekly'));
  assert.equal(modelFor(loadConfig({}), 'weekly'), 'gemini-3.8-flash');
});

test('7 日の境目は日本時間の 6 日前 0:00（その前は前の週）', () => {
  assert.equal(weekStart(NOW).toISOString(), FROM);
  const at = (iso) => ({ id: iso, endedAt: iso });
  const sessions = [at('2026-11-01T14:59:59.000Z'), at(FROM), at('2026-11-08T02:00:00.000Z')];
  const floors = sessions.map((x) => ({ sessionId: x.id, focusMin: 10.4, floors: 1, ownScore: 40 }));
  const events = [
    { type: 'help_small', at: '2026-11-01T14:59:59.000Z' },
    { type: 'help_small', at: FROM },
    { type: 'help_medium', at: '2026-11-08T01:00:00.000Z' },
    { type: 'leave', at: FROM },
  ];
  const st = computeStats({ sessions, events, floors }, weekStart(NOW), NOW);
  assert.deepEqual(st, { focusMinutes: 21, sessions: 2, floorsAdded: 2, streak: 1, helpSmall: 1, helpMedium: 1, selfDecided: 40 }); // 11/8 だけ（11/2 とは続かない）
  const prev = computeStats({ sessions, events, floors }, new Date(Date.parse(FROM) - 7 * 86_400_000), weekStart(NOW));
  assert.equal(prev.sessions, 1);
  assert.equal(prev.helpSmall, 1);
});

test('集中が 0 件の週は summary null（Gemini は呼ばない）', async () => {
  const { s, calls, get } = await setup();
  try {
    await addSession(s, 'u1', '2026-10-30T03:00:00.000Z'); // 前の週だけ
    const r = await get('u1');
    assert.equal(r.status, 200);
    assertShape(r.json);
    assert.equal(r.json.summary, null);
    assert.equal(r.json.source, 'rules');
    assert.equal(r.json.stats.sessions, 0);
    assert.equal(r.json.stats.selfDecided, null);
    assert.equal(r.json.from, FROM);
    assert.equal(r.json.to, NOW.toISOString());
    assert.equal(calls.length, 0);
  } finally {
    await s.close();
  }
});

test('AI の文: stats はサーバーが計算・前の週の数字を渡す・数字だけで本人の文は渡さない', async () => {
  const { s, calls, get } = await setup();
  try {
    await addSession(s, 'u1', '2026-11-07T03:00:00.000Z', { focusMin: 30, floors: 2, ownScore: 80, small: 2 });
    await addSession(s, 'u1', '2026-11-08T02:00:00.000Z', { focusMin: 15.6, floors: 1, ownScore: 60, medium: 1 });
    await addSession(s, 'u1', '2026-10-30T03:00:00.000Z', { focusMin: 20, floors: 1, ownScore: 50, medium: 3 }); // 前の週
    await s.ctx.store.put(C.goals, 'g', { userId: 'u1', text: '秘密の目標の文', deadline: '2026-12-01', status: 'active' });
    const r = await get('u1');
    assertShape(r.json);
    assert.equal(r.json.source, 'ai');
    assert.deepEqual(r.json.stats, { focusMinutes: 46, sessions: 2, floorsAdded: 3, streak: 2, helpSmall: 2, helpMedium: 1, selfDecided: 70 });
    assert.equal(r.json.summary, '今週は手助けを借りずに進めた日がありました。\n次の一歩: 始める前に一行書く。');
    const u = calls[0].user;
    assert.match(u, /今週[\s\S]*集中した分: 46[\s\S]*前の週[\s\S]*集中した分: 20[\s\S]*中＝やり方の説明）: 3/);
    assert.doesNotMatch(u, /秘密の目標/);
    assert.match(calls[0].system, /数字を作りません/);
    assert.match(calls[0].system, /ほめません/);
    assert.match(calls[0].system, /次の一歩/);
    // 名前と口調（#290）。数字の決まりは上のまま
    assert.match(calls[0].system, /あなたは「モルティ」です/);
    assert.match(calls[0].system, /短く親しみやすい「です・ます」/);
  } finally {
    await s.close();
  }
});

test('前の週に集中が無ければ「記録なし」と渡す', async () => {
  const { s, calls, get } = await setup();
  try {
    await addSession(s, 'u1', '2026-11-07T03:00:00.000Z');
    await get('u1');
    assert.match(calls[0].user, /【前の週】記録なし/);
  } finally {
    await s.close();
  }
});

test('行は 3 まで・240 字で切る', async () => {
  const { s, get } = await setup({ reply: { lines: ['あ'.repeat(100), '', 'い'.repeat(100), 'う'.repeat(100), 'え'] } });
  try {
    await addSession(s, 'u1', '2026-11-07T03:00:00.000Z');
    const r = await get('u1');
    assert.equal(r.json.source, 'ai');
    assert.equal(Array.from(r.json.summary).length, 240);
    assert.equal(r.json.summary.split('\n').length, 3);
  } finally {
    await s.close();
  }
});

for (const [name, reply] of [
  ['形が違う', { lines: 'だめ' }],
  ['空', { lines: ['　', ''] }],
  ['渡していない数を書いた', { lines: ['今週は 999 分も集中しました。'] }],
  ['失敗', () => {
    throw new Error('boom');
  }],
]) {
  test(`Gemini の返事が${name}時は決まった文に落ちる（502 にしない）`, async () => {
    const { s, get } = await setup({ reply });
    try {
      await addSession(s, 'u1', '2026-11-07T03:00:00.000Z', { focusMin: 25 });
      const r = await quiet(() => get('u1'));
      assert.equal(r.status, 200);
      assertShape(r.json);
      assert.equal(r.json.source, 'rules');
      assert.equal(r.json.summary, rulesSummary(r.json.stats, null));
      assert.match(r.json.summary, /1 回、合わせて 25 分/);
    } finally {
      await s.close();
    }
  });
}

test('時間切れ（20 秒の代わりに短い値）で決まった文に落ちる', async () => {
  const { s, get } = await setup({ reply: () => new Promise(() => {}), config: { weeklyTimeoutMs: 50 } });
  try {
    await addSession(s, 'u1', '2026-11-07T03:00:00.000Z');
    const r = await quiet(() => get('u1'));
    assert.equal(r.json.source, 'rules');
  } finally {
    await s.close();
  }
});

test('決まった文: 自分で決めた度が変われば、その変化に触れる', () => {
  const st = { focusMinutes: 30, sessions: 1, floorsAdded: 2, streak: 1, helpSmall: 0, helpMedium: 0, selfDecided: 70 };
  assert.match(rulesSummary(st, { ...st, selfDecided: 50 }), /前の週の 50 から 70 に上がりました/);
  assert.match(rulesSummary(st, null), /小 0・中 0/);
});

test('他の人のデータは混ざらない', async () => {
  const { s, calls, get } = await setup();
  try {
    await addSession(s, 'u2', '2026-11-07T03:00:00.000Z', { focusMin: 99, floors: 9 });
    await addSession(s, 'u1', '2026-11-07T04:00:00.000Z', { focusMin: 10, floors: 1 });
    const r = await get('u1');
    assert.equal(r.json.stats.focusMinutes, 10);
    assert.equal(r.json.stats.floorsAdded, 1);
    assert.equal(r.json.stats.sessions, 1);
    assert.doesNotMatch(calls[0].user, /99/);
  } finally {
    await s.close();
  }
});

test('回数制限: 上限に達したら Gemini を呼ばず決まった文（429 にしない）', async () => {
  const limiter = createLimiter({ perUserPerDay: 1, totalPerDay: 100, now: () => NOW });
  const { s, calls, get } = await setup({ limiter });
  try {
    await addSession(s, 'u1', '2026-11-07T03:00:00.000Z');
    assert.equal((await get('u1')).json.source, 'ai');
    const r = await quiet(() => get('u1'));
    assert.equal(r.status, 200);
    assert.equal(r.json.source, 'rules');
    assert.equal(calls.length, 1);
    assert.equal(limiter.used('u1'), 1);
  } finally {
    await s.close();
  }
});

test('GEMINI_MODE=fake: 固定の文に source ai・未ログインは 401', async () => {
  const { s, get } = await setup({ mode: 'fake' });
  try {
    await addSession(s, 'u1', '2026-11-07T03:00:00.000Z');
    const r = await get('u1');
    assertShape(r.json);
    assert.equal(r.json.source, 'ai');
    assert.equal(r.json.summary, FAKE_SUMMARY);
    assert.equal((await fetch(`${s.base}/api/weekly`)).status, 401);
  } finally {
    await s.close();
  }
});
