import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { C } from '../src/common/collections.js';
import {
  POINT_RULES, computePoints, pointItems, pointsBySession, pointsForAchievement, pointsForRoadmap,
  pointsForSession, pointsForThought, streakPoints,
} from '../src/score/points.js';

// 日本時間 2026-11-08 12:00 ＝ UTC 03:00
const NOW = new Date('2026-11-08T03:00:00Z');
const at = (utc) => new Date(utc).toISOString();
const ses = (id, endedAt, focusMin, extra = {}) => ({ id, userId: 'u1', startedAt: endedAt, endedAt: at(endedAt), focusMin, ...extra });
const thought = (utc, hasThought = true) => ({ role: 'user', userId: 'u1', at: at(utc), ...(hasThought && { hasThought: true }) });

test('規則は 1 か所の定数で、変えられない', () => {
  assert.ok(Object.isFrozen(POINT_RULES));
  assert.ok(Object.isFrozen(POINT_RULES.focus));
});

test('集中: 5 分ごとに 1・1 回でも 1 日の上限 12 まで・負や無い値は 0', () => {
  assert.equal(pointsForSession({ focusMin: 4.9 }), 0);
  assert.equal(pointsForSession({ focusMin: 5 }), 1);
  assert.equal(pointsForSession({ focusMin: 29 }), 5);
  assert.equal(pointsForSession({ focusMin: 200 }), 12);
  assert.equal(pointsForSession({ focusMin: -3 }), 0);
  assert.equal(pointsForSession({}), 0);
});

test('集中: 速く終えても増えない（同じ離れていない時間なら、開始〜終了の長さに関係なく同じ pt）', () => {
  const fast = ses('a', '2026-11-08T01:00:00Z', 25, { startedAt: at('2026-11-08T00:35:00Z') });
  const slow = ses('a', '2026-11-08T01:00:00Z', 25, { startedAt: at('2026-11-07T23:00:00Z') });
  const pt = (s) => computePoints({ sessions: [s], now: NOW }).items.find((x) => x.kind === 'focus').pt;
  assert.equal(pt(fast), pt(slow));
});

test('集中: 1 日の上限 12 は複数回の合計に効き、日をまたげば戻る', () => {
  const sessions = [
    ses('a', '2026-11-08T00:00:00Z', 40), // 8
    ses('b', '2026-11-08T01:00:00Z', 40), // 8 → 残り 4
    ses('c', '2026-11-08T02:00:00Z', 40), // 0
    ses('d', '2026-11-07T02:00:00Z', 40), // 前の日 8
  ];
  const focus = pointItems({ sessions }).filter((x) => x.kind === 'focus');
  assert.deepEqual(focus.map((x) => [x.sessionId, x.pt]), [['d', 8], ['a', 8], ['b', 4], ['c', 0]]);
});

test('考えを書いて聞いた: 1 回 2・1 日 10 まで・thought の無い相談と AI の返事は数えない', () => {
  assert.equal(pointsForThought(0), 0);
  assert.equal(pointsForThought(3), 6);
  assert.equal(pointsForThought(9), 10);
  const msgs = [
    ...Array.from({ length: 7 }, (_, i) => thought(`2026-11-08T01:0${i}:00Z`)),
    thought('2026-11-08T01:30:00Z', false),
    { role: 'ai', userId: 'u1', at: at('2026-11-08T01:31:00Z'), hasThought: true },
  ];
  assert.equal(computePoints({ tutorMessages: msgs, now: NOW }).total, 10);
});

test('AI に聞いても減らない: 相談を足しても合計は下がらない', () => {
  const base = { sessions: [ses('a', '2026-11-08T01:00:00Z', 30, { reflectedAt: at('2026-11-08T01:05:00Z'), achievement: 2 })], now: NOW };
  const before = computePoints(base).total;
  const many = Array.from({ length: 30 }, (_, i) => ({ role: 'user', userId: 'u1', at: at(`2026-11-08T00:${String(i + 10)}:00Z`) }));
  const ai = many.map((m) => ({ ...m, role: 'ai' }));
  assert.equal(computePoints({ ...base, tutorMessages: [...many, ...ai] }).total, before);
  assert.ok(computePoints({ ...base, tutorMessages: [thought('2026-11-08T00:50:00Z')] }).total > before);
});

test('ロードマップ: 自作 10・直した 4＋割合×6（切り捨て）・そのまま 3・タスク（auto）0・目標 1 つにつき 1 回', () => {
  assert.equal(pointsForRoadmap('own'), 10);
  assert.equal(pointsForRoadmap('edited', 0), 4);
  assert.equal(pointsForRoadmap('edited', 0.5), 7);
  assert.equal(pointsForRoadmap('edited', 0.99), 9);
  assert.equal(pointsForRoadmap('edited', 1), 10);
  assert.equal(pointsForRoadmap('edited', 5), 10); // 割合は 0〜1 に丸める
  assert.equal(pointsForRoadmap('candidate'), 3);
  assert.equal(pointsForRoadmap('auto'), 0);
  assert.equal(pointsForRoadmap('???'), 0);
  const roadmaps = [
    { goalId: 'g1', adopted: 'own', createdAt: at('2026-11-08T00:00:00Z') },
    { goalId: 'g1', adopted: 'own', createdAt: at('2026-11-08T00:10:00Z') }, // 同じ目標の 2 つ目は数えない
    { goalId: 'g2', adopted: 'auto', createdAt: at('2026-11-08T00:20:00Z') },
  ];
  const r = computePoints({ roadmaps, now: NOW });
  assert.equal(r.total, 10);
  assert.deepEqual(r.items.map((x) => x.kind), ['decide']); // pt 0 の項は出さない
});

test('チェックポイントを終えた: 達成度 0/1/2/3 → 0/5/10/15・集中 1 回につき 1 回・未判定は 0', () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => pointsForAchievement(n)), [0, 5, 10, 15]);
  assert.equal(pointsForAchievement(null), 0);
  assert.equal(pointsForAchievement(4), 0);
  const results = [
    { sessionId: 's1', at: at('2026-11-08T01:00:00Z'), achievement: 3 },
    { sessionId: 's1', at: at('2026-11-08T01:10:00Z'), achievement: 3 },
    { sessionId: 's2', at: at('2026-11-08T01:20:00Z'), achievement: null },
  ];
  assert.equal(computePoints({ results, now: NOW }).total, 15);
});

test('続けた日: 連続日数（最大 7）× 1・1 日 1 回', () => {
  assert.deepEqual([0, 1, 3, 7, 30].map((n) => streakPoints(n)), [0, 1, 3, 7, 7]);
  const sessions = [
    ses('a', '2026-11-06T01:00:00Z', 0),
    ses('b', '2026-11-07T01:00:00Z', 0),
    ses('c', '2026-11-08T01:00:00Z', 0),
    ses('d', '2026-11-08T02:00:00Z', 0), // 同じ日の 2 回目は増えない
  ];
  const streak = pointItems({ sessions }).filter((x) => x.kind === 'streak');
  assert.deepEqual(streak.map((x) => x.pt), [1, 2, 3]);
  assert.equal(streak[2].label, '3 日続けた');
});

test('日付の境界は日本時間 0 時', () => {
  const sessions = [
    ses('a', '2026-11-07T14:59:00Z', 60), // 日本時間 11/7 23:59
    ses('b', '2026-11-07T15:00:00Z', 60), // 日本時間 11/8 0:00
  ];
  const focus = pointItems({ sessions }).filter((x) => x.kind === 'focus');
  assert.deepEqual(focus.map((x) => x.pt), [12, 12]); // 別の日なので上限はそれぞれ
  const r = computePoints({ sessions, now: NOW });
  assert.equal(r.today, 12 + 2); // 11/8 の集中 12＋続けた日（11/7 から連続 2 日）
  assert.equal(r.total, 12 + 1 + 12 + 2);
});

test('today / week / total の集計と items（新しい順・最大 50・短い日本語）', () => {
  const sessions = [
    ses('old', '2026-10-01T01:00:00Z', 10), // 週の外: 2 + 続けた 1
    ses('w', '2026-11-02T01:00:00Z', 10), // 週の始まり（日本時間 11/2）: 2 + 1
    ses('t', '2026-11-08T01:00:00Z', 10), // 今日: 2 + 1
  ];
  const r = computePoints({ sessions, now: NOW });
  assert.equal(r.total, 9);
  assert.equal(r.week, 6);
  assert.equal(r.today, 3);
  assert.deepEqual(r.items.map((x) => x.at), [...r.items.map((x) => x.at)].sort().reverse());
  for (const x of r.items) assert.deepEqual(Object.keys(x).sort(), ['at', 'kind', 'label', 'pt']);
  const many = Array.from({ length: 80 }, (_, i) => thought(new Date(Date.parse('2026-09-01T00:00:00Z') + i * 86400000).toISOString()));
  assert.equal(computePoints({ tutorMessages: many, now: NOW }).items.length, 50);
});

test('空の記録は 0', () => {
  assert.deepEqual(computePoints({ now: NOW }), { total: 0, today: 0, week: 0, items: [], byGoal: [] });
});

test('byGoal: 目標ごとの合計（上限の後）・連続は入らない・pt 0 は入れない・最後に増えた時刻の新しい順', () => {
  const goals = [
    { id: 'gA', text: '英語', userId: 'u1' },
    { id: 'gB', text: '数学', userId: 'u1', archivedAt: at('2026-11-08T02:30:00Z') },
    { id: 'gC', text: 'pt の無い目標', userId: 'u1' },
  ];
  const sessions = [
    ses('a1', '2026-11-08T00:00:00Z', 40, { goalId: 'gA' }), // 8
    ses('b1', '2026-11-08T01:00:00Z', 40, { goalId: 'gB', reflectedAt: at('2026-11-08T01:05:00Z'), achievement: 1 }), // 上限で 4 ＋ 達成度 5
    ses('a2', '2026-11-08T02:00:00Z', 40, { goalId: 'gA' }), // 上限で 0
    ses('c1', '2026-11-08T02:10:00Z', 0, { goalId: 'gC' }), // 0
  ];
  const roadmaps = [{ goalId: 'gA', adopted: 'candidate', createdAt: at('2026-11-07T00:00:00Z') }]; // 3
  const tutorMessages = [{ ...thought('2026-11-08T00:30:00Z'), sessionId: 'a1' }]; // 2
  const r = computePoints({ sessions, roadmaps, tutorMessages, goals, now: NOW });
  // gB の最後の増加は 01:05、gA は 00:30（a2 の 0 は数えない）→ gB が先
  assert.deepEqual(r.byGoal, [
    { goalId: 'gB', text: '数学', pt: 9, archived: true },
    { goalId: 'gA', text: '英語', pt: 13, archived: false },
  ]);
  // 連続の pt はどの目標にも入らない＝合計は total より連続の分だけ少ない
  const streakPt = pointItems({ sessions }).filter((x) => x.kind === 'streak').reduce((s, x) => s + x.pt, 0);
  assert.ok(streakPt > 0);
  assert.equal(r.byGoal.reduce((s, g) => s + g.pt, 0), r.total - streakPt);
  // 外へ返す items に goalId は出さない
  for (const x of r.items) assert.equal('goalId' in x, false);
});

test('byGoal: goals に無い目標（他人の目標など）は入れない', () => {
  const sessions = [ses('x', '2026-11-08T01:00:00Z', 30, { goalId: 'gOther' })];
  assert.deepEqual(computePoints({ sessions, goals: [{ id: 'gMine', text: '自分' }], now: NOW }).byGoal, []);
});

test('pointsBySession: 集中 1 回ごとに 集中＋振り返り の pt', () => {
  const sessions = [ses('a', '2026-11-08T01:00:00Z', 30, { reflectedAt: at('2026-11-08T01:05:00Z'), achievement: 1 })];
  assert.equal(pointsBySession(pointItems({ sessions })).get('a'), 6 + 5);
});

test('振り返りの pt は本人と AI の判定の低い方（本人だけで盛れない）・results で AI を省けば本人の値', () => {
  const sessions = [ses('a', '2026-11-08T01:00:00Z', 0, { reflectedAt: at('2026-11-08T01:05:00Z'), achievement: 3, aiAchievement: 1 })];
  const done = pointItems({ sessions }).filter((x) => x.kind === 'done');
  assert.equal(done[0].pt, 5);
  assert.equal(done[0].label, 'チェックポイントを終えた（達成度 1）');
  const results = [{ sessionId: 'a', at: at('2026-11-08T01:05:00Z'), achievement: 3 }];
  assert.equal(pointItems({ results }).find((x) => x.kind === 'done').pt, 15);
  assert.equal(pointItems({ results: [{ ...results[0], aiAchievement: 2 }] }).find((x) => x.kind === 'done').pt, 10);
});

test('GET /api/points: 認証が要る・本人の記録だけ・保存しない', async () => {
  const s = await start({ now: () => NOW });
  const { store } = s.ctx;
  assert.equal((await fetch(`${s.base}/api/points`)).status, 401);
  await store.put(C.sessions, 's1', ses('s1', '2026-11-08T01:00:00Z', 25, { reflectedAt: at('2026-11-08T01:05:00Z'), achievement: 2 }));
  await store.put(C.sessions, 's9', { ...ses('s9', '2026-11-08T01:00:00Z', 60, { reflectedAt: at('2026-11-08T01:05:00Z'), achievement: 3 }), userId: 'u2' });
  await store.put(C.sessions, 's2', { userId: 'u1', startedAt: at('2026-11-08T02:00:00Z') }); // 進行中は数えない
  await store.put(C.sessions, 's3', { userId: 'u1', startedAt: at('2026-11-07T01:00:00Z'), endedAt: at('2026-11-07T01:30:00Z') });
  await store.put(C.floors, 's3', { userId: 'u1', sessionId: 's3', focusMin: 10, at: at('2026-11-07T01:30:00Z') }); // focusMin を階で補う
  await store.put(C.roadmaps, 'g1', { goalId: 'g1', userId: 'u1', adopted: 'own', createdAt: at('2026-11-07T00:00:00Z') });
  await store.put(C.roadmaps, 'g9', { goalId: 'g9', userId: 'u2', adopted: 'own', createdAt: at('2026-11-07T00:00:00Z') });
  await store.put(C.tutorMessages, 'm1', { ...thought('2026-11-08T00:50:00Z'), sessionId: 's1' });
  await store.put(C.tutorMessages, 'm9', { ...thought('2026-11-08T00:50:00Z'), userId: 'u2', sessionId: 's9' });
  const before = (await store.list(C.sessions)).length;

  const r = await fetch(`${s.base}/api/points`, { headers: { 'x-dev-user': 'u1' } });
  assert.equal(r.status, 200);
  const body = await r.json();
  // 11/8: 集中 5 + 達成度2 10 + 考え 2 + 続けた 2 = 19 ／ 11/7: 集中 2 + 自作 10 + 続けた 1 = 13
  assert.equal(body.today, 19);
  assert.equal(body.total, 32);
  assert.equal(body.week, 32);
  assert.equal((await store.list(C.sessions)).length, before);

  const empty = await (await fetch(`${s.base}/api/points`, { headers: { 'x-dev-user': 'u3' } })).json();
  assert.deepEqual(empty, { total: 0, today: 0, week: 0, items: [], byGoal: [] });
  await s.close();
});

test('GET /api/points: byGoal は本人の目標だけ・目標の文とやめた印が付く', async () => {
  const s = await start({ now: () => NOW });
  const { store } = s.ctx;
  await store.put(C.goals, 'g1', { userId: 'u1', text: '英検に受かる', createdAt: at('2026-11-01T00:00:00Z') });
  await store.put(C.goals, 'g2', { userId: 'u1', text: 'やめた目標', archivedAt: at('2026-11-08T02:00:00Z'), createdAt: at('2026-11-01T00:00:00Z') });
  await store.put(C.goals, 'g9', { userId: 'u2', text: '他人の目標', createdAt: at('2026-11-01T00:00:00Z') });
  await store.put(C.sessions, 's1', ses('s1', '2026-11-08T01:00:00Z', 25, { goalId: 'g1' }));
  await store.put(C.sessions, 's2', ses('s2', '2026-11-07T01:00:00Z', 10, { goalId: 'g2' }));
  // 他人の集中が自分の目標 id を指していても数えない（本人の記録だけを読む）
  await store.put(C.sessions, 's9', { ...ses('s9', '2026-11-08T01:00:00Z', 60, { goalId: 'g1' }), userId: 'u2' });
  await store.put(C.roadmaps, 'g9', { goalId: 'g9', userId: 'u2', adopted: 'own', createdAt: at('2026-11-07T00:00:00Z') });
  const body = await (await fetch(`${s.base}/api/points`, { headers: { 'x-dev-user': 'u1' } })).json();
  assert.deepEqual(body.byGoal, [
    { goalId: 'g1', text: '英検に受かる', pt: 5, archived: false },
    { goalId: 'g2', text: 'やめた目標', pt: 2, archived: true },
  ]);
  for (const x of body.items) assert.equal('goalId' in x, false);
  await s.close();
});
