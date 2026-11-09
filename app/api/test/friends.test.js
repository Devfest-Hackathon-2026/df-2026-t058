import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { C } from '../src/common/collections.js';
import { FRIEND_REQUEST_LIMIT } from '../src/friends/routes.js';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;

async function boot(extra = {}) {
  const s = await start({ now: () => NOW, ...extra });
  const call = async (user, method, path, payload) => {
    const res = await fetch(`${s.base}${path}`, {
      method,
      headers: h(user),
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: res.status, json: await res.json() };
  };
  // 利用者を作り（/api/me）、表示名を付けて、友達コードを返す。
  const join = async (user, displayName) => {
    await call(user, 'PUT', '/api/me', { displayName });
    return (await call(user, 'GET', '/api/me')).json.friendCode;
  };
  // 申請 → 承認までを済ませる。
  const befriend = async (a, b, codeOfB) => {
    const req = await call(a, 'POST', '/api/friends', { code: codeOfB });
    assert.equal(req.status, 201);
    const ok = await call(b, 'POST', `/api/friends/${req.json.id}/accept`);
    assert.equal(ok.status, 200);
    return req.json.id;
  };
  const addSession = (id, userId, startedAt, oneLine, endedAt) =>
    s.ctx.store.put(C.sessions, id, { userId, startedAt, oneLine, ...(endedAt && { endedAt }) });
  return { s, call, join, befriend, addSession };
}

test('友達コードで申請すると pending の Friendship ができる（小文字・前後の空白も受ける）', async () => {
  const { s, call, join } = await boot();
  const code1 = await join('u1', 'たろう');
  await join('u2', 'はなこ');
  const r = await call('u2', 'POST', '/api/friends', { code: ` ${code1.toLowerCase()} ` });
  assert.equal(r.status, 201);
  assert.equal(r.json.userId, 'u2');
  assert.equal(r.json.friendId, 'u1');
  assert.equal(r.json.status, 'pending');
  assert.equal(typeof r.json.notifyOnStart, 'boolean');
  assert.equal(r.json.createdAt, NOW.toISOString());
  assert.ok(r.json.id);
  await s.close();
});

test('申請の失敗: 無いコードは 404、自分のコードは 400、コードの型や欠落は 400', async () => {
  const { s, call, join } = await boot();
  const own = await join('u1', 'たろう');
  assert.equal((await call('u1', 'POST', '/api/friends', { code: 'ZZZZZZ' })).status, 404);
  assert.equal((await call('u1', 'POST', '/api/friends', { code: own })).status, 400);
  assert.equal((await call('u1', 'POST', '/api/friends', {})).status, 400);
  assert.equal((await call('u1', 'POST', '/api/friends', { code: 123 })).status, 400);
  assert.equal((await call('u1', 'POST', '/api/friends', { code: '' })).status, 400);
  assert.equal((await call('u1', 'POST', '/api/friends', { code: 'x'.repeat(21) })).status, 400);
  assert.equal((await call('u1', 'POST', '/api/friends')).status, 400);
  await s.close();
});

test('どちら向きでも、すでにあれば 409（pending でも accepted でも）', async () => {
  const { s, call, join, befriend } = await boot();
  const c1 = await join('u1', 'たろう');
  const c2 = await join('u2', 'はなこ');
  const c3 = await join('u3', 'じろう');
  assert.equal((await call('u1', 'POST', '/api/friends', { code: c2 })).status, 201);
  assert.equal((await call('u1', 'POST', '/api/friends', { code: c2 })).status, 409); // 同じ向き
  const rev = await call('u2', 'POST', '/api/friends', { code: c1 }); // 逆向き
  assert.equal(rev.status, 409);
  assert.equal(rev.json.error.code, 'conflict');
  // 承認済みでも 409
  await befriend('u1', 'u3', c3);
  assert.equal((await call('u3', 'POST', '/api/friends', { code: c1 })).status, 409);
  await s.close();
});

test('申請が同時に両側から来ても、できるのは 1 件だけ', async () => {
  const { s, call, join } = await boot();
  const c1 = await join('u1', 'たろう');
  const c2 = await join('u2', 'はなこ');
  const [a, b] = await Promise.all([
    call('u1', 'POST', '/api/friends', { code: c2 }),
    call('u2', 'POST', '/api/friends', { code: c1 }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal((await s.ctx.store.list(C.friendships)).length, 1);
  await s.close();
});

test('承認できるのは受けた側だけ。申請した側・第三者・存在しない ID は 404、二重承認は 409', async () => {
  const { s, call, join } = await boot();
  const c1 = await join('u1', 'たろう');
  const c2 = await join('u2', 'はなこ');
  await join('u3', 'じろう');
  void c1;
  const f = (await call('u1', 'POST', '/api/friends', { code: c2 })).json;
  assert.equal((await call('u1', 'POST', `/api/friends/${f.id}/accept`)).status, 404); // 申請した側
  assert.equal((await call('u3', 'POST', `/api/friends/${f.id}/accept`)).status, 404); // 第三者
  assert.equal((await call('u2', 'POST', '/api/friends/nothing/accept')).status, 404); // 無い ID
  const still = await s.ctx.store.get(C.friendships, f.id);
  assert.equal(still.status, 'pending'); // 失敗した承認で変わっていない

  const ok = await call('u2', 'POST', `/api/friends/${f.id}/accept`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'accepted');
  assert.equal(ok.json.id, f.id);
  assert.equal((await call('u2', 'POST', `/api/friends/${f.id}/accept`)).status, 409);
  await s.close();
});

test('GET /api/friends: pending も双方に見え、相手の機微な項目は返さない', async () => {
  const { s, call, join } = await boot();
  const c1 = await join('u1', 'たろう');
  const c2 = await join('u2', 'はなこ');
  await call('u1', 'PUT', '/api/me', { nudgeLevel: 'strong' });
  await call('u1', 'POST', '/api/friends', { code: c2 });
  void c1;

  for (const [me, other, name] of [['u1', 'u2', 'はなこ'], ['u2', 'u1', 'たろう']]) {
    const r = await call(me, 'GET', '/api/friends');
    assert.equal(r.status, 200);
    assert.equal(r.json.friends.length, 1);
    const item = r.json.friends[0];
    assert.deepEqual(Object.keys(item).sort(), ['activeNow', 'floors', 'friendship', 'streak', 'today', 'user']);
    assert.equal(item.floors, 0); // 申請中の相手の値は返さない
    assert.equal(item.streak, 0);
    assert.equal(item.friendship.status, 'pending');
    assert.deepEqual(item.user, { id: other, displayName: name }); // id と表示名だけ
    assert.equal(item.activeNow, false);
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes(c1) && !text.includes(c2), '友達コードを返してはいけない');
    assert.ok(!text.includes('nudgeLevel') && !text.includes('strong'));
  }
  await s.close();
});

test('GET /api/friends: 自分に関係ない組は出ない。何も無ければ空', async () => {
  const { s, call, join, befriend } = await boot();
  await join('u1', 'a');
  const c2 = await join('u2', 'b');
  await join('u3', 'c');
  const c4 = await join('u4', 'd');
  await befriend('u3', 'u4', c4);
  await befriend('u1', 'u2', c2);
  const r = await call('u1', 'GET', '/api/friends');
  assert.deepEqual(r.json.friends.map((x) => x.user.id), ['u2']);
  assert.deepEqual((await call('u5', 'GET', '/api/friends')).json, { friends: [] });
  await s.close();
});

test('activeNow: 承認済みの相手に終わっていない集中がある時だけ true', async () => {
  const { s, call, join, befriend, addSession } = await boot();
  await join('u1', 'a');
  const c2 = await join('u2', 'b');
  const c3 = await join('u3', 'c');
  // u2 は pending のまま集中中 → 見せない
  await call('u1', 'POST', '/api/friends', { code: c2 });
  await addSession('s2', 'u2', iso(10 * 60 * 1000), '数学の宿題');
  let list = (await call('u1', 'GET', '/api/friends')).json.friends;
  assert.equal(list.find((x) => x.user.id === 'u2').activeNow, false);

  // 承認後は true（u2 側からは u1 が集中中でないので false）
  const fid = list.find((x) => x.user.id === 'u2').friendship.id;
  await call('u2', 'POST', `/api/friends/${fid}/accept`);
  list = (await call('u1', 'GET', '/api/friends')).json.friends;
  assert.equal(list.find((x) => x.user.id === 'u2').activeNow, true);
  const fromU2 = (await call('u2', 'GET', '/api/friends')).json.friends;
  assert.equal(fromU2[0].activeNow, false);

  // 終わった集中だけの友達は false
  await befriend('u1', 'u3', c3);
  await addSession('s3', 'u3', iso(2 * HOUR), '英語', iso(HOUR));
  list = (await call('u1', 'GET', '/api/friends')).json.friends;
  assert.equal(list.find((x) => x.user.id === 'u3').activeNow, false);
  // 終わらせると u2 も false
  await addSession('s2', 'u2', iso(10 * 60 * 1000), '数学の宿題', iso(60 * 1000));
  list = (await call('u1', 'GET', '/api/friends')).json.friends;
  assert.equal(list.find((x) => x.user.id === 'u2').activeNow, false);
  await s.close();
});

test('floors・streak: 承認済みの友達の値だけ入る。申請中・他人の値は混ざらない。0 の人は 0', async () => {
  const { s, call, join, befriend, addSession } = await boot();
  const DAY = 24 * HOUR;
  await join('u1', 'a');
  const c2 = await join('u2', 'b');
  const c3 = await join('u3', 'c');
  const c4 = await join('u4', 'd');
  await befriend('u1', 'u2', c2); // 承認済み・記録あり
  await befriend('u1', 'u3', c3); // 承認済み・記録なし
  await call('u1', 'POST', '/api/friends', { code: c4 }); // 申請中・記録あり
  const floor = (id, userId, floors) => s.ctx.store.put(C.floors, id, { userId, floors, at: iso(HOUR) });
  // u2: 今日・昨日・一昨日に終えた集中（3 日連続）と、計 5 階
  await addSession('a1', 'u2', iso(2 * HOUR), 'x', iso(HOUR));
  await addSession('a2', 'u2', iso(DAY + 2 * HOUR), 'x', iso(DAY + HOUR));
  await addSession('a3', 'u2', iso(2 * DAY + 2 * HOUR), 'x', iso(2 * DAY + HOUR));
  await floor('a1', 'u2', 2);
  await floor('a2', 'u2', 3);
  // u4（申請中）と u5（無関係）にも記録がある
  await addSession('b1', 'u4', iso(2 * HOUR), 'x', iso(HOUR));
  await floor('b1', 'u4', 7);
  await addSession('c1', 'u5', iso(2 * HOUR), 'x', iso(HOUR));
  await floor('c1', 'u5', 11);
  // 自分（u1）の記録も、友達の値に混ざらない
  await addSession('d1', 'u1', iso(2 * HOUR), 'x', iso(HOUR));
  await floor('d1', 'u1', 13);

  const list = (await call('u1', 'GET', '/api/friends')).json.friends;
  const by = (id) => list.find((x) => x.user.id === id);
  assert.deepEqual([by('u2').floors, by('u2').streak], [5, 3]);
  assert.deepEqual([by('u3').floors, by('u3').streak], [0, 0]);
  assert.deepEqual([by('u4').floors, by('u4').streak], [0, 0]);
  assert.equal(list.length, 3); // u5 は出ない
  // u2 から見た u1 は、u1 の値
  const fromU2 = (await call('u2', 'GET', '/api/friends')).json.friends;
  assert.deepEqual([fromU2[0].floors, fromU2[0].streak], [13, 1]);
  await s.close();
});

test('GET /api/feed: 承認済みの友達の過去 24 時間の開始だけを新しい順に。形は4項目', async () => {
  const { s, call, join, befriend, addSession } = await boot();
  await join('u1', 'わたし');
  const c2 = await join('u2', 'はなこ');
  await join('u3', 'じろう');
  const c4 = await join('u4', 'まだ友達でない');
  await befriend('u1', 'u2', c2);
  const c1 = (await call('u1', 'GET', '/api/me')).json.friendCode;
  await befriend('u3', 'u1', c1); // u3 から申請（向きが逆でも出る）
  await call('u1', 'POST', '/api/friends', { code: c4 }); // pending のまま

  await addSession('a', 'u2', iso(3 * HOUR), '古め');
  await addSession('b', 'u2', iso(1 * HOUR), '新しい', iso(30 * 60 * 1000)); // 終わっていても出る
  await addSession('c', 'u3', iso(2 * HOUR), '中くらい');
  await addSession('d', 'u2', iso(25 * HOUR), '24時間より前'); // 範囲外
  await addSession('e', 'u4', iso(1 * HOUR), 'pending の人'); // 出ない
  await addSession('f', 'u1', iso(1 * HOUR), '自分'); // 出ない
  await addSession('g', 'u9', iso(1 * HOUR), '他人'); // 出ない

  const r = await call('u1', 'GET', '/api/feed');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, [
    { userId: 'u2', displayName: 'はなこ', oneLine: '新しい', at: iso(1 * HOUR) },
    { userId: 'u3', displayName: 'じろう', oneLine: '中くらい', at: iso(2 * HOUR) },
    { userId: 'u2', displayName: 'はなこ', oneLine: '古め', at: iso(3 * HOUR) },
  ]);
  await s.close();
});

test('GET /api/feed: ちょうど 24 時間前は含み、最大 50 件で新しい方を残す', async () => {
  const { s, call, join, befriend, addSession } = await boot();
  await join('u1', 'a');
  const c2 = await join('u2', 'b');
  await befriend('u1', 'u2', c2);
  await addSession('edge', 'u2', iso(24 * HOUR), 'ちょうど');
  assert.equal((await call('u1', 'GET', '/api/feed')).json.items.length, 1);
  for (let i = 0; i < 60; i++) await addSession(`m${i}`, 'u2', iso((i + 1) * 60 * 1000), `n${i}`);
  const items = (await call('u1', 'GET', '/api/feed')).json.items;
  assert.equal(items.length, 50);
  assert.equal(items[0].oneLine, 'n0'); // いちばん新しい
  assert.equal(items[49].oneLine, 'n49');
  await s.close();
});

test('GET /api/feed: 11/9 から全員 strong 固定。nudgeLevel に off を送っても出る', async () => {
  const { s, call, join, befriend, addSession } = await boot();
  await join('u1', 'a');
  const c2 = await join('u2', 'b');
  await befriend('u1', 'u2', c2);
  await addSession('x', 'u2', iso(HOUR), '集中');
  const me = await call('u1', 'PUT', '/api/me', { nudgeLevel: 'off' });
  assert.equal(me.json.nudgeLevel, 'strong');
  assert.equal((await call('u1', 'GET', '/api/feed')).json.items.length, 1);
  await s.close();
});

test('GET /api/feed: 友達もセッションも無ければ空。/api/me 未呼び出しでも落ちない', async () => {
  const { s, call } = await boot();
  assert.deepEqual((await call('nobody', 'GET', '/api/feed')).json, { items: [] });
  await s.close();
});

test('feed と friends はセッションを書き換えない', async () => {
  const { s, call, join, befriend, addSession } = await boot();
  await join('u1', 'a');
  const c2 = await join('u2', 'b');
  await befriend('u1', 'u2', c2);
  await addSession('x', 'u2', iso(HOUR), '集中');
  const before = JSON.stringify(await s.ctx.store.list(C.sessions));
  await call('u1', 'GET', '/api/feed');
  await call('u1', 'GET', '/api/friends');
  assert.equal(JSON.stringify(await s.ctx.store.list(C.sessions)), before);
  await s.close();
});

test('認証なしは 401', async () => {
  const { s } = await boot();
  for (const [method, path] of [['GET', '/api/friends'], ['GET', '/api/feed'], ['POST', '/api/friends'], ['POST', '/api/friends/x/accept']]) {
    const res = await fetch(`${s.base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  await s.close();
});

test('申請の回数の制限: 見つからないコードが 5 回続くとその日は 429（当たりのコードでも）・翌日は戻る', async () => {
  let now = new Date(NOW);
  const { s, call, join } = await boot({ now: () => now });
  const codeB = await join('b', 'B');
  await join('a', 'A');
  for (let i = 0; i < FRIEND_REQUEST_LIMIT.missesPerUserPerDay; i++) {
    assert.equal((await call('a', 'POST', '/api/friends', { code: `ZZZZZ${i}` })).status, 404, `外れ ${i}`);
  }
  const blocked = await call('a', 'POST', '/api/friends', { code: codeB });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'rate_limited');
  // 他の人は止まらない
  await join('c', 'C');
  assert.equal((await call('c', 'POST', '/api/friends', { code: codeB })).status, 201);
  // 翌日（UTC）は戻る
  now = new Date(NOW.getTime() + 24 * HOUR);
  assert.equal((await call('a', 'POST', '/api/friends', { code: codeB })).status, 201);
  await s.close();
});

test('申請の回数の制限: 当たり外れに関わらず 1 人 1 日 20 回まで', async () => {
  const { s, call, join } = await boot();
  await join('a', 'A');
  const own = (await call('a', 'GET', '/api/me')).json.friendCode;
  // 自分のコード（400）は外れに数えないが、申請の回数には数える
  for (let i = 0; i < FRIEND_REQUEST_LIMIT.perUserPerDay; i++) {
    assert.equal((await call('a', 'POST', '/api/friends', { code: own })).status, 400, `#${i}`);
  }
  assert.equal((await call('a', 'POST', '/api/friends', { code: own })).status, 429);
  await s.close();
});
