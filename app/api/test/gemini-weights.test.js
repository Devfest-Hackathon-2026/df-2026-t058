import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini, usageLine, weightFor } from '../src/gemini/index.js';
import { createLimiter } from '../src/limiter.js';
import { DEFAULT_GEMINI_WEIGHTS, loadConfig } from '../src/config.js';
import { HttpError } from '../src/http.js';

// #225 Gemini の制限を「重み付きの点」で数える・使用量を 1 行のログに残す。
const schema = { type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } };
const input = { system: 's', user: '<user_text>u</user_text>' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
const withPhoto = { ...input, images: [{ mimeType: 'image/png', dataBase64: PNG }] };
const withPdf = { ...input, files: [{ mimeType: 'application/pdf', dataBase64: PNG }] };
const is429 = (e) => e instanceof HttpError && e.status === 429 && e.code === 'rate_limited';

function quietWarn(fn) {
  const warn = console.warn;
  const msgs = [];
  console.warn = (m) => msgs.push(String(m));
  try {
    return { value: fn(), msgs };
  } finally {
    console.warn = warn;
  }
}

test('既定の重みと上限（点）: roadmap 8・軽い物 1・1 人 150・全体 1500', () => {
  const c = loadConfig({});
  assert.equal(c.geminiLimitPerUserPerDay, 150);
  assert.equal(c.geminiLimitTotalPerDay, 1500);
  assert.deepEqual(c.geminiWeights, DEFAULT_GEMINI_WEIGHTS);
  const w = { weights: c.geminiWeights };
  assert.deepEqual(
    ['roadmap', 'achievement', 'material', 'voice', 'extract', 'today', 'hint', 'research', 'stuck', 'weekly'].map((p) =>
      weightFor(w, p, input),
    ),
    [8, 8, 3, 3, 2, 1, 1, 1, 1, 1],
  );
});

test('画像や PDF が付く呼び出しは重みに 2 を足す（空の配列は足さない）', () => {
  const w = { weights: DEFAULT_GEMINI_WEIGHTS };
  assert.equal(weightFor(w, 'material', withPhoto), 5);
  assert.equal(weightFor(w, 'extract', withPdf), 4);
  assert.equal(weightFor(w, 'hint', withPhoto), 3);
  assert.equal(weightFor(w, 'hint', { ...input, images: [] }), 1);
  assert.equal(weightFor({}, 'roadmap', withPhoto), 1); // 重みを渡さない時は回数（1）
});

test('GEMINI_WEIGHTS で上書きでき、不正な値は既定に戻す（console.warn）', () => {
  const ok = quietWarn(() => loadConfig({ GEMINI_WEIGHTS: '{"roadmap":10,"hint":0}' }));
  assert.equal(ok.value.geminiWeights.roadmap, 10);
  assert.equal(ok.value.geminiWeights.hint, 0);
  assert.equal(ok.value.geminiWeights.material, 3);
  assert.equal(ok.msgs.length, 0);
  for (const bad of ['not json', '[1]', 'null', '{"roadmap":-1}', '{"roadmap":1.5}', '{"roadmap":"8"}', '{"unknown":1}']) {
    const r = quietWarn(() => loadConfig({ GEMINI_WEIGHTS: bad }));
    assert.deepEqual(r.value.geminiWeights, DEFAULT_GEMINI_WEIGHTS, bad);
    assert.equal(r.msgs.length, 1, bad);
    assert.ok(!r.msgs[0].includes(bad), '値そのものはログに出さない');
  }
});

test('点で数える: 重い呼び出しは 18 回で止まり、軽い呼び出しは 150 回通る', async () => {
  const limiter = createLimiter({ perUserPerDay: 150, totalPerDay: 1500 });
  const g = createGemini({ mode: 'fake', limiter, weights: DEFAULT_GEMINI_WEIGHTS });
  let heavy = 0;
  for (;;) {
    try {
      await g.generate({ purpose: 'roadmap', input, schema, userId: 'heavy' });
      heavy += 1;
    } catch (e) {
      assert.ok(is429(e));
      break;
    }
  }
  assert.equal(heavy, 18); // 8×18=144・次の 8 で 152 > 150
  assert.equal(limiter.used('heavy'), 144);
  for (let i = 0; i < 6; i++) await g.generate({ purpose: 'hint', input, schema, userId: 'heavy' }); // 残り 6 点は軽い物で使える
  await assert.rejects(g.generate({ purpose: 'hint', input, schema, userId: 'heavy' }), is429);
  for (let i = 0; i < 150; i++) await g.generate({ purpose: 'hint', input, schema, userId: 'light' });
  await assert.rejects(g.generate({ purpose: 'hint', input, schema, userId: 'light' }), is429);
});

test('limiter: 重みの既定は 1（回数として使う所はそのまま）・全体の上限・日が変わると戻る', () => {
  let now = new Date('2026-11-08T23:00:00Z');
  const l = createLimiter({ perUserPerDay: 10, totalPerDay: 12, now: () => now });
  l.take('a');
  assert.equal(l.used('a'), 1);
  l.take('a', 8);
  assert.throws(() => l.take('a', 2), is429); // 9+2 > 10（数えない）
  assert.equal(l.used('a'), 9);
  l.take('b', 3); // 全体 12
  assert.throws(() => l.take('c', 1), is429); // 全体の上限
  assert.equal(l.used('c'), 0);
  now = new Date('2026-11-09T00:00:01Z'); // UTC の日付が変わる
  assert.equal(l.used('a'), 0);
  l.take('c', 10);
  assert.equal(l.used('c'), 10);
});

test('limiter: 上限 0 は重み 0 でも止める', () => {
  const l = createLimiter({ perUserPerDay: 0, totalPerDay: 100 });
  assert.throws(() => l.take('a', 0), is429);
});

const ALLOWED = ['evt', 'purpose', 'model', 'weight', 'promptTokens', 'outputTokens', 'thoughtTokens', 'ms', 'ok'];

test('real: 1 回ごとに使用量の 1 行（JSON）を出す。項目は決まった 9 つだけ（ユーザー ID・入力・出力・画像なし）', async () => {
  const logs = [];
  const real = async () => ({
    output: { reply: 'ひみつの答え' },
    model: 'gemini-3.8-flash',
    usage: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 7, totalTokenCount: 157 },
  });
  const limiter = createLimiter({ perUserPerDay: 100, totalPerDay: 100 });
  const g = createGemini({ mode: 'real', limiter, real, weights: DEFAULT_GEMINI_WEIGHTS, log: (l) => logs.push(l) });
  await g.generate({ purpose: 'material', input: withPhoto, schema, userId: 'user-xyz' });
  assert.equal(logs.length, 1);
  const row = JSON.parse(logs[0]);
  assert.deepEqual(Object.keys(row).sort(), [...ALLOWED].sort());
  assert.deepEqual(row, {
    evt: 'gemini_usage',
    purpose: 'material',
    model: 'gemini-3.8-flash',
    weight: 5,
    promptTokens: 120,
    outputTokens: 30,
    thoughtTokens: 7,
    ms: row.ms,
    ok: true,
  });
  assert.equal(typeof row.ms, 'number');
  for (const secret of ['user-xyz', 'ひみつ', '<user_text>', PNG]) assert.ok(!logs[0].includes(secret), secret);
  assert.equal(limiter.used('user-xyz'), 5);
});

test('real: 失敗（例外・形の不正）でも ok:false の行を出す。usageMetadata が無ければ null', async () => {
  const logs = [];
  const failing = async () => {
    throw new HttpError(502, 'upstream_invalid', 'x');
  };
  failing.modelFor = () => 'gemini-4-argon';
  const g = createGemini({ mode: 'real', real: failing, weights: DEFAULT_GEMINI_WEIGHTS, log: (l) => logs.push(l) });
  await assert.rejects(g.generate({ purpose: 'roadmap', input, schema, userId: 'u' }), (e) => e.status === 502);
  const bad = createGemini({ mode: 'real', real: async () => ({ output: { nope: 1 } }), log: (l) => logs.push(l) });
  const err = console.error;
  console.error = () => {};
  try {
    await assert.rejects(bad.generate({ purpose: 'hint', input, schema, userId: 'u' }), (e) => e.status === 502);
  } finally {
    console.error = err;
  }
  const [a, b] = logs.map((l) => JSON.parse(l));
  assert.deepEqual([a.model, a.weight, a.ok, a.promptTokens, a.outputTokens, a.thoughtTokens], ['gemini-4-argon', 8, false, null, null, null]);
  assert.deepEqual([b.model, b.weight, b.ok], [null, 1, false]);
  for (const row of [a, b]) assert.deepEqual(Object.keys(row).sort(), [...ALLOWED].sort());
});

test('fake モードでは使用量のログを出さない', async () => {
  const logs = [];
  const g = createGemini({ mode: 'fake', weights: DEFAULT_GEMINI_WEIGHTS, log: (l) => logs.push(l) });
  await g.generate({ purpose: 'hint', input, schema, userId: 'u' });
  assert.deepEqual(logs, []);
});

test('usageLine: 数でないトークン数は null', () => {
  const row = JSON.parse(usageLine({ purpose: 'hint', model: 'm', weight: 1, usage: { promptTokenCount: 'x' }, ms: 1, ok: true }));
  assert.equal(row.promptTokens, null);
});

test('アプリ全体: 既定で写真付きの書き起こしは 5 点と数える', async () => {
  const { start } = await import('./helpers.js');
  const s = await start({ fakeResponses: { material: async () => ({ text: '書き起こし' }) } });
  const res = await fetch(`${s.base}/api/materials/read`, {
    method: 'POST',
    headers: { 'x-dev-user': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ images: [{ mimeType: 'image/png', dataBase64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4)]).toString('base64') }] }),
  });
  assert.equal(res.status, 200);
  assert.equal(s.ctx.limiter.used('u1'), 5);
  await s.close();
});
