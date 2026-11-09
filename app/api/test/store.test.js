import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/index.js';

test('put/get/list は値のコピーを返す（外から書き換えても保管は変わらない）', async () => {
  const st = createMemoryStore();
  await st.put('goals', 'g1', { userId: 'u1', text: 'a' });
  const got = await st.get('goals', 'g1');
  got.text = 'changed';
  assert.equal((await st.get('goals', 'g1')).text, 'a');
  assert.equal((await st.list('goals', { userId: 'u1' })).length, 1);
  assert.equal((await st.list('goals', { userId: 'u2' })).length, 0);
  assert.equal(await st.get('goals', 'none'), null);
});

test('events は追記のみ。put は拒否し、時刻はサーバーが付ける', async () => {
  const st = createMemoryStore({ now: () => new Date('2026-11-05T01:00:00Z') });
  await assert.rejects(() => st.put('events', 'e1', { type: 'leave' }), /追記のみ/);
  const e = await st.append('events', { type: 'leave', at: '1999-01-01T00:00:00Z' });
  assert.equal(e.at, '2026-11-05T01:00:00.000Z');
  assert.ok(e.id);
});
