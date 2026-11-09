import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { createMemoryStore } from '../src/store/index.js';
import { C } from '../src/common/collections.js';
import { RULES, rulesFromEnv, colorFor, floorsFor, originScore, ownScoreFor, scoredAchievement } from '../src/score/rules.js';
import { buildFloor, recomputeFloor } from '../src/score/floor.js';
import { computeStreak, jstDayKey } from '../src/score/streak.js';
import { focusMinutes, isAway, countLeaves } from '../src/session/focus.js';

const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const iso = (min) => new Date(Date.parse('2026-11-06T01:00:00.000Z') + min * 60000).toISOString();
const ev = (type, min, id) => ({ id: id ?? `${type}-${min}`, type, at: iso(min) });

// ---- 作業時間 ----
test('focusMinutes: 離席なしは 開始〜終了', () => {
  assert.equal(focusMinutes([ev('focus_start', 0), ev('focus_end', 25)]), 25);
});

test('focusMinutes: leave〜return の間を除く(複数回)', () => {
  const e = [ev('focus_start', 0), ev('leave', 10), ev('return', 13), ev('leave', 20), ev('return', 25), ev('focus_end', 40)];
  assert.equal(focusMinutes(e), 32);
});

test('focusMinutes: 終了時に離れたままなら leave〜終了も除く', () => {
  assert.equal(focusMinutes([ev('focus_start', 0), ev('leave', 12), ev('focus_end', 50)]), 12);
});

test('focusMinutes: 順不同でも時刻順に数える・小数 1 桁に丸める', () => {
  const e = [ev('focus_end', 10), ev('return', 5), ev('focus_start', 0), ev('leave', 2)];
  assert.equal(focusMinutes(e), 7);
  const sec = (s) => new Date(Date.parse(iso(0)) + s * 1000).toISOString();
  assert.equal(
    focusMinutes([
      { type: 'focus_start', at: sec(0) },
      { type: 'focus_end', at: sec(100) }, // 1.6666… 分
    ]),
    1.7,
  );
});

test('focusMinutes: 二重の leave/return は無視、範囲外は切る、終了が無ければ 0', () => {
  const dup = [ev('focus_start', 0), ev('leave', 5), ev('leave', 6), ev('return', 8), ev('return', 9), ev('focus_end', 20)];
  assert.equal(focusMinutes(dup), 17);
  const before = [ev('leave', -5), ev('return', 3), ev('focus_start', 0), ev('focus_end', 10)];
  assert.equal(focusMinutes(before), 7); // 開始前の分は引かない
  assert.equal(focusMinutes([ev('focus_start', 0), ev('leave', 3)]), 0);
  assert.equal(focusMinutes([ev('focus_start', 5), ev('focus_end', 5)]), 0);
});

test('focusMinutes: focus_start/focus_end が無い時は fallback を使う', () => {
  assert.equal(focusMinutes([ev('leave', 10), ev('return', 20)], { startedAt: iso(0), endedAt: iso(30) }), 20);
});

test('isAway / countLeaves', () => {
  assert.equal(isAway([]), false);
  assert.equal(isAway([ev('leave', 1)]), true);
  assert.equal(isAway([ev('leave', 1), ev('return', 2)]), false);
  assert.equal(isAway([ev('return', 2), ev('leave', 1)]), false); // 時刻順に見る
  assert.equal(countLeaves([ev('leave', 1), ev('return', 2), ev('leave', 3), ev('focus_start', 0)]), 2);
});

// ---- 規則 ----
test('floorsFor: 15 分ごとに 1 階・5 分以上で最低 1 階・5 分未満は 0', () => {
  const cases = [[0, 0], [4.9, 0], [5, 1], [14.9, 1], [15, 1], [29.9, 1], [30, 2], [44, 2], [45, 3], [120, 8]];
  for (const [m, f] of cases) assert.equal(floorsFor(m), f, `${m} 分`);
});

test('floorsFor は速さを加点しない: 長いほど階が増えるだけで、同じ階数の人の色は変わらない', () => {
  assert.equal(colorFor(70, 2), colorFor(70, 2));
  assert.equal(floorsFor(30), floorsFor(44.9));
});

test('originScore: own 70 / edited 50+20×割合 / candidate 40', () => {
  assert.equal(originScore('own'), 70);
  assert.equal(originScore('edited', 0), 50);
  assert.equal(originScore('edited', 0.5), 60);
  assert.equal(originScore('edited', 1), 70);
  assert.equal(originScore('edited', 9), 70); // 範囲外は丸める
  assert.equal(originScore('edited'), 50);
  assert.equal(originScore('candidate'), 40);
  assert.equal(originScore(undefined), 40);
});

test('ownScoreFor: 出どころ − 10×medium（上限 40）、small では引かない、0〜100 に丸める（11/9）', () => {
  assert.equal(ownScoreFor({ adopted: 'candidate' }), 40);
  assert.equal(ownScoreFor({ adopted: 'own' }), 70);
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 1 }), 60);
  assert.equal(ownScoreFor({ adopted: 'own', helpSmall: 3, helpMedium: 2 }), 50); // 70-20（small は引かない）
  assert.equal(ownScoreFor({ adopted: 'edited', editRatio: 0.5, helpSmall: 1 }), 60);
  assert.equal(ownScoreFor({ adopted: 'edited', editRatio: 0.333 }), 56.7);
  assert.equal(ownScoreFor({ adopted: 'candidate', helpSmall: 4, helpMedium: 3 }), 10); // 40-30
  assert.equal(ownScoreFor({ adopted: 'candidate', helpSmall: 4, helpMedium: 4 }), 0); // 40-40 → 0
});

test('ownScoreFor: small が何件でも自分で決めた度は変わらない', () => {
  assert.equal(RULES.own.helpSmallPenalty, 0);
  for (const n of [0, 1, 5, 100]) assert.equal(ownScoreFor({ adopted: 'own', helpSmall: n }), 70);
});

test('ownScoreFor: medium 1 件で 10 下がる。引き算の上限は −40', () => {
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 1 }), ownScoreFor({ adopted: 'own' }) - 10);
  assert.equal(RULES.own.helpMediumPenalty, 10);
  assert.equal(RULES.own.helpMediumMax, 40);
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 4 }), 30); // ちょうど上限
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 5 }), 30);
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 50 }), 30);
  assert.equal(ownScoreFor({ adopted: 'own', helpSmall: 100, helpMedium: 100 }), 30);
});

test('ownScoreFor: 上限 100 に丸める（出どころの値を大きくした規則でも越えない）', () => {
  const rules = { ...RULES, own: { ...RULES.own, originOwn: 130 } };
  assert.equal(ownScoreFor({ adopted: 'own' }, rules), 100);
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 2 }, rules), 100); // 130-20=110 → 100
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 4 }, rules), 90);
  assert.equal(ownScoreFor({ adopted: 'own', helpMedium: 6 }, rules), 90); // medium の上限 −40
});

test('ownScoreFor: 古い件数の名前（proposals・hints・explanations）は点に効かない', () => {
  assert.equal(ownScoreFor({ adopted: 'own', proposals: 6, hints: 3, explanations: 1 }), 70);
});

test('colorFor: gold=own≥70 かつ達成度≥2、silver=own≥40 かつ≥1、他は bronze', () => {
  assert.equal(colorFor(70, 2), 'gold');
  assert.equal(colorFor(100, 3), 'gold');
  assert.equal(colorFor(69.9, 3), 'silver');
  assert.equal(colorFor(70, 1), 'silver');
  assert.equal(colorFor(40, 1), 'silver');
  assert.equal(colorFor(39.9, 3), 'bronze');
  assert.equal(colorFor(100, 0), 'bronze');
  assert.equal(colorFor(0, 0), 'bronze');
});

test('規則の定数は 1 か所で、速さに関する項を持たない(P4)', () => {
  const keys = JSON.stringify(RULES).toLowerCase();
  for (const w of ['speed', 'fast', 'quick', 'early', 'faster']) assert.ok(!keys.includes(w), w);
});

// ---- buildFloor ----
const session = { id: 's1', userId: 'u1', goalId: 'g1', checkpointId: 'c1', startedAt: iso(0), endedAt: iso(30) };
// 達成度は集中（session）ごとに持つ。チェックポイントの値（下の roadmap）は点に使わない。
const roadmap = (achievement, extra = {}) => ({
  adopted: 'own',
  checkpoints: [{ id: 'c1', achievement }, { id: 'c2', achievement: 3 }],
  ...extra,
});
const judged = (achievement, aiAchievement = achievement) => ({ ...session, achievement, aiAchievement });
const baseEvents = [ev('focus_start', 0, 'e1'), ev('focus_end', 30, 'e2')];

test('buildFloor: 3 軸・階・色・derivedFrom', () => {
  const f = buildFloor({ session: judged(2, 1), roadmap: roadmap(null), events: baseEvents });
  assert.deepEqual(f, {
    userId: 'u1',
    sessionId: 's1',
    focusMin: 30,
    timeScore: 30,
    achievementScore: 2,
    achievement: 2,
    aiAchievement: 1,
    ownScore: 70,
    floors: 2,
    color: 'silver', // 色は本人 2 と AI 1 の低い方（1）で決める。achievement・achievementScore は本人の値のまま
    derivedFrom: ['e1', 'e2'],
    at: iso(30),
  });
});

test('scoredAchievement: 本人と AI の低い方・AI なしは本人・本人 null は 0', () => {
  assert.equal(scoredAchievement(2, null), 2); // AI なし
  assert.equal(scoredAchievement(1, 3), 1); // 本人の方が低い
  assert.equal(scoredAchievement(3, 1), 1); // AI の方が低い
  assert.equal(scoredAchievement(null, 2), 0); // 本人 null
  assert.equal(scoredAchievement(null, null), 0);
});

test('buildFloor: 本人が「できた」(3) でも AI が 0 なら色は銅（盛れない）・AI なしなら本人の値で金', () => {
  const low = buildFloor({ session: judged(3, 0), roadmap: roadmap(null), events: baseEvents });
  assert.equal(low.color, 'bronze');
  assert.equal(low.achievement, 3);
  assert.equal(low.achievementScore, 3);
  const noAi = buildFloor({ session: judged(3, null), roadmap: roadmap(null), events: baseEvents });
  assert.equal(noAi.color, 'gold');
});

test('buildFloor: 達成度 null は 0、チェックポイントの達成度は使わない（集中ごとの値だけ）', () => {
  const f = buildFloor({ session, roadmap: roadmap(3), events: baseEvents });
  assert.equal(f.achievementScore, 0);
  assert.equal(f.achievement, null);
  assert.equal(f.aiAchievement, null);
  assert.equal(f.color, 'bronze');
  const g = buildFloor({ session: judged(null, null), roadmap: roadmap(3), events: baseEvents });
  assert.equal(g.achievementScore, 0);
});

test('buildFloor: 相談の度合い(help_small・help_medium)で own が落ちて金にならない', () => {
  const events = [...baseEvents, ev('help_medium', 20, 'e3'), ev('help_small', 10, 'e4'), ev('help_small', 12, 'e5')];
  const f = buildFloor({ session: judged(3), roadmap: roadmap(3), events });
  assert.equal(f.ownScore, 60); // 70 - 10（small は引かない・11/9）
  assert.equal(f.color, 'silver');
  assert.ok(f.derivedFrom.includes('e3'));
});

test('buildFloor: 古い種類(hint_request・explanation・own_proposal・research)は点に効かない', () => {
  const events = [
    ...baseEvents,
    ev('hint_request', 5, 'o1'),
    ev('explanation', 6, 'o2'),
    ev('own_proposal', 7, 'o3'),
    ev('research', 8, 'o4'),
  ];
  const f = buildFloor({ session: judged(2), roadmap: roadmap(2), events });
  assert.equal(f.ownScore, 70);
  assert.equal(f.color, 'gold');
});

test('buildFloor: ロードマップが無くても落ちない(安全側)', () => {
  const f = buildFloor({ session, roadmap: null, events: baseEvents });
  assert.equal(f.ownScore, 40);
  assert.equal(f.achievementScore, 0);
});

test('buildFloor: 速さで差が付かない(同じ記録で作業時間だけ長い=階だけ増え、own と色は同じ)', () => {
  const short = buildFloor({ session, roadmap: roadmap(2), events: baseEvents });
  const longSession = { ...session, endedAt: iso(75) };
  const long = buildFloor({ session: longSession, roadmap: roadmap(2), events: [ev('focus_start', 0), ev('focus_end', 75)] });
  assert.equal(short.ownScore, long.ownScore);
  assert.equal(short.color, long.color);
  assert.ok(long.floors > short.floors);
});

// ---- 連続記録 ----
test('jstDayKey: UTC 15:00 で JST の翌日になる', () => {
  assert.equal(jstDayKey('2026-11-05T14:59:59.999Z'), '2026-11-05');
  assert.equal(jstDayKey('2026-11-05T15:00:00.000Z'), '2026-11-06');
  assert.equal(jstDayKey(new Date('2026-12-31T16:00:00Z')), '2027-01-01');
});

test('computeStreak: 今日から連続', () => {
  const now = new Date('2026-11-06T03:00:00Z'); // JST 11/6 12:00
  const ends = ['2026-11-06T01:00:00Z', '2026-11-05T05:00:00Z', '2026-11-04T05:00:00Z', '2026-11-02T05:00:00Z'];
  assert.equal(computeStreak(ends, now), 3);
});

test('computeStreak: 今日がまだでも昨日まで続いていれば切れない・一昨日までなら 0', () => {
  const now = new Date('2026-11-06T03:00:00Z');
  assert.equal(computeStreak(['2026-11-05T05:00:00Z', '2026-11-04T05:00:00Z'], now), 2);
  assert.equal(computeStreak(['2026-11-04T05:00:00Z'], now), 0);
  assert.equal(computeStreak([], now), 0);
  assert.equal(computeStreak([undefined, null], now), 0);
});

test('computeStreak: 同じ日に何回でも 1 日・JST の日付境目・月またぎ', () => {
  const now = new Date('2026-12-01T00:00:00Z'); // JST 12/1 09:00
  // JST では 11/30 23:00、12/1 05:00、11/29 10:00 の 3 日に当たる(UTC の日付では 11/30 が 2 回で 11/29 と合わせ 2 日に見える)
  const ends = ['2026-11-30T14:00:00Z', '2026-11-30T20:00:00Z', '2026-11-29T01:00:00Z'];
  assert.equal(computeStreak(ends, now), 3);
  // 同じ日に 2 回あっても 1 日
  assert.equal(computeStreak(['2026-11-30T01:00:00Z', '2026-11-30T05:00:00Z'], now), 1);
  // 間が 1 日空くと数えない(11/30 が無い)
  assert.equal(computeStreak(['2026-12-01T00:00:00Z', '2026-11-29T01:00:00Z'], now), 1);
});

// ---- recomputeFloor ----
async function seedEnded() {
  let t = Date.parse(iso(0));
  const clock = () => new Date(t);
  const s = await start({ store: createMemoryStore({ now: clock }), now: clock });
  const { store } = s.ctx;
  await store.put(C.roadmaps, 'g1', { goalId: 'g1', adopted: 'own', checkpoints: [{ id: 'c1', state: 'doing', achievement: null }] });
  await store.put(C.sessions, 's1', { userId: 'u1', goalId: 'g1', checkpointId: 'c1', startedAt: iso(0), endedAt: iso(30), leaveCount: 0 });
  t = Date.parse(iso(0));
  await store.append(C.events, { userId: 'u1', sessionId: 's1', type: 'focus_start' });
  t = Date.parse(iso(30));
  await store.append(C.events, { userId: 'u1', sessionId: 's1', type: 'focus_end' });
  return { s, store };
}

test('recomputeFloor: 達成度が決まった後に呼び直すと Floor が上書きされ、at と id は変わらない', async () => {
  const { s, store } = await seedEnded();
  const first = await recomputeFloor(s.ctx, 's1');
  assert.equal(first.color, 'bronze');
  assert.equal(first.floors, 2);
  const ses = await store.get(C.sessions, 's1');
  await store.put(C.sessions, 's1', { ...ses, reflectedAt: iso(31), achievement: 3, aiAchievement: 3 });
  const second = await recomputeFloor(s.ctx, 's1');
  assert.equal(second.color, 'gold');
  assert.equal(second.achievementScore, 3);
  assert.equal(second.at, first.at);
  assert.equal((await store.list(C.floors)).length, 1);
  assert.deepEqual(await store.get(C.floors, 's1'), second);
  await s.close();
});

test('recomputeFloor: 無い集中は 404、終わっていない集中は 409', async () => {
  const { s, store } = await seedEnded();
  await assert.rejects(recomputeFloor(s.ctx, 'nope'), (e) => e.status === 404);
  await store.put(C.sessions, 's2', { userId: 'u1', goalId: 'g1', checkpointId: 'c1', startedAt: iso(0) });
  await assert.rejects(recomputeFloor(s.ctx, 's2'), (e) => e.status === 409);
  await s.close();
});

// ---- GET /api/tower ----
test('GET /api/tower: 認証が無いと 401、何も無ければ空', async () => {
  const s = await start();
  assert.equal((await fetch(`${s.base}/api/tower`)).status, 401);
  const r = await fetch(`${s.base}/api/tower`, { headers: h('u1') });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { floors: [], totalFloors: 0, streak: 0 });
  await s.close();
});

test('GET /api/tower: 古い順・合計・連続記録・他人のものは含まない', async () => {
  const now = new Date('2026-11-06T03:00:00Z');
  const s = await start({ now: () => now });
  const { store } = s.ctx;
  const mk = async (id, user, endedAt, floors) => {
    await store.put(C.sessions, id, { userId: user, startedAt: endedAt, endedAt });
    await store.put(C.floors, id, { userId: user, sessionId: id, floors, focusMin: floors * 15, at: endedAt });
  };
  await mk('b', 'u1', '2026-11-05T05:00:00Z', 2);
  await mk('a', 'u1', '2026-11-04T05:00:00Z', 1);
  await mk('c', 'u1', '2026-11-06T01:00:00Z', 3);
  await mk('x', 'u2', '2026-11-06T01:00:00Z', 9);
  await store.put(C.sessions, 'active', { userId: 'u1', startedAt: '2026-11-06T02:00:00Z' }); // 進行中は数えない
  const r = await (await fetch(`${s.base}/api/tower`, { headers: h('u1') })).json();
  assert.deepEqual(r.floors.map((f) => f.sessionId), ['a', 'b', 'c']);
  assert.equal(r.totalFloors, 6);
  assert.equal(r.streak, 3);
  const other = await (await fetch(`${s.base}/api/tower`, { headers: h('u2') })).json();
  assert.equal(other.totalFloors, 9);
  assert.equal(other.streak, 1);
  await s.close();
});

test('GET /api/tower: 集中を終えるまで建物は増えず、終えると階が積み上がる(結合)', async () => {
  let t = Date.parse(iso(0));
  const clock = () => new Date(t);
  const s = await start({ store: createMemoryStore({ now: clock }), now: clock });
  await s.ctx.store.put(C.goals, 'g1', { userId: 'u1', text: 'x', status: 'active' });
  await s.ctx.store.put(C.roadmaps, 'g1', {
    goalId: 'g1',
    adopted: 'own',
    checkpoints: [{ id: 'c1', state: 'todo', achievement: null }, { id: 'c2', state: 'todo', achievement: null }],
  });
  const post = (p, b) => fetch(`${s.base}${p}`, { method: 'POST', headers: h('u1'), body: JSON.stringify(b) }).then((r) => r.json());
  const tower = () => fetch(`${s.base}/api/tower`, { headers: h('u1') }).then((r) => r.json());
  const a = await post('/api/sessions', { goalId: 'g1', checkpointId: 'c1', oneLine: 'a' });
  assert.equal((await tower()).totalFloors, 0);
  t += 45 * 60000;
  await post(`/api/sessions/${a.id}/end`, {});
  t += 60000;
  const b = await post('/api/sessions', { goalId: 'g1', checkpointId: 'c2', oneLine: 'b' });
  t += 16 * 60000;
  await post(`/api/sessions/${b.id}/end`, {});
  const r = await tower();
  assert.equal(r.floors.length, 2);
  assert.deepEqual(r.floors.map((f) => f.floors), [3, 1]);
  assert.equal(r.totalFloors, 4);
  assert.equal(r.streak, 1);
  await s.close();
});

// ---- 階の閾値の環境変数 ----
test('rulesFromEnv: 空なら既定(5 分・15 分)', () => {
  const r = rulesFromEnv({});
  assert.equal(r.minMinutesForFloor, 5);
  assert.equal(r.minutesPerFloor, 15);
  assert.equal(r.own.originOwn, 70);
});

test('rulesFromEnv: 環境変数ありなら階の計算が変わる', () => {
  const r = rulesFromEnv({ FLOOR_MIN_MINUTES: '1', FLOOR_MINUTES_PER_FLOOR: '2' });
  assert.equal(floorsFor(1, r), 1);
  assert.equal(floorsFor(4, r), 2);
  assert.equal(floorsFor(0.5, r), 0);
});

test('rulesFromEnv: 不正な値(数でない・0 以下・600 超)は既定に戻る', () => {
  for (const bad of ['abc', '0', '-3', '601', 'NaN', 'Infinity']) {
    const r = rulesFromEnv({ FLOOR_MIN_MINUTES: bad, FLOOR_MINUTES_PER_FLOOR: bad });
    assert.equal(r.minMinutesForFloor, 5, bad);
    assert.equal(r.minutesPerFloor, 15, bad);
  }
});
