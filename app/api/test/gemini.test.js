import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini } from '../src/gemini/index.js';
import { createLimiter } from '../src/limiter.js';

// 窓口の約束の形（fake でも本物と同じ検査をする）
const IN = { system: 's', user: 'u' };

const schema = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'string' } } } };

test('fake モードは schema に合う見本を返す', async () => {
  const g = createGemini({ mode: 'fake' });
  const out = await g.generate({ purpose: 'roadmap', input: IN, schema, userId: 'u1' });
  assert.deepEqual(out, { items: ['sample'] });
});

test('形に合わない出力は 502 upstream_invalid', async () => {
  const g = createGemini({ mode: 'fake', fakeResponses: { hint: async () => ({ items: 5 }) } });
  const orig = console.error;
  console.error = () => {};
  await assert.rejects(
    () => g.generate({ purpose: 'hint', input: IN, schema, userId: 'u1' }),
    (e) => e.status === 502 && e.code === 'upstream_invalid',
  );
  console.error = orig;
});

test('回数制限: ユーザーごと・全体で 429、日が変わると戻る', async () => {
  let now = new Date('2026-11-05T00:00:00Z');
  const limiter = createLimiter({ perUserPerDay: 2, totalPerDay: 3, now: () => now });
  const g = createGemini({ mode: 'fake', limiter });
  const call = (u) => g.generate({ purpose: 'roadmap', input: IN, schema, userId: u });
  await call('a');
  await call('a');
  await assert.rejects(() => call('a'), (e) => e.status === 429);
  await call('b'); // 全体 3 回目
  await assert.rejects(() => call('c'), (e) => e.status === 429);
  now = new Date('2026-11-06T00:00:00Z');
  await call('a');
});

test('real モードは I-3 まで未実装（呼ぶと失敗する）', async () => {
  const g = createGemini({ mode: 'real' });
  await assert.rejects(() => g.generate({ purpose: 'roadmap', input: IN, schema, userId: 'u1' }), /未実装/);
});

test('fake モードでも、入力が { system, user } の形でなければ失敗する（本物との食い違いを試験で見つける）', async () => {
  const g = createGemini({ mode: 'fake' });
  await assert.rejects(() => g.generate({ purpose: 'roadmap', input: { system: 's', prompt: 'p' }, schema, userId: 'u1' }), /system: string, user: string/);
  await assert.rejects(() => g.generate({ purpose: 'roadmap', input: {}, schema, userId: 'u1' }), /system: string, user: string/);
});
