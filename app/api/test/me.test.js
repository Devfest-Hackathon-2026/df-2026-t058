import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });

test('GET /api/me は初回に作り、友達コード(6 文字)と既定の通知の強さを持つ', async () => {
  const s = await start();
  const me = await (await fetch(`${s.base}/api/me`, { headers: h('u1') })).json();
  assert.equal(me.id, 'u1');
  assert.match(me.friendCode, /^[A-Z2-9]{6}$/);
  assert.equal(me.nudgeLevel, 'strong'); // 11/9 から全員 strong 固定
  const again = await (await fetch(`${s.base}/api/me`, { headers: h('u1') })).json();
  assert.equal(again.friendCode, me.friendCode);
  await s.close();
});

test('PUT /api/me は表示名と通知の強さを変え、不正な値は 400', async () => {
  const s = await start();
  const ok = await fetch(`${s.base}/api/me`, { method: 'PUT', headers: h('u1'), body: JSON.stringify({ displayName: ' たろう ', nudgeLevel: 'strong' }) });
  const me = await ok.json();
  assert.equal(me.displayName, 'たろう');
  assert.equal(me.nudgeLevel, 'strong');
  const ng = await fetch(`${s.base}/api/me`, { method: 'PUT', headers: h('u1'), body: JSON.stringify({ nudgeLevel: 'max' }) });
  assert.equal(ng.status, 400);
  const long = await fetch(`${s.base}/api/me`, { method: 'PUT', headers: h('u1'), body: JSON.stringify({ displayName: 'x'.repeat(31) }) });
  assert.equal(long.status, 400);
  await s.close();
});
