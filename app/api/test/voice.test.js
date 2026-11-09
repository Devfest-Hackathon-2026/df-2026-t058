import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { createGemini, PURPOSES } from '../src/gemini/index.js';
import { demoFakeResponses } from '../src/gemini/fake.js';
import { modelFor } from '../src/gemini/vertex.js';
import { loadConfig } from '../src/config.js';
import { createLimiter } from '../src/limiter.js';
import { createMemoryStore } from '../src/store/index.js';
import { MAX_VOICE_BYTES } from '../src/voice/routes.js';

// 声で相談する（契約 §3.7c・#210）の試験。音声は作り物のバイト列を実行時に組み立てる。

const HEAD = {
  'audio/webm': [0x1a, 0x45, 0xdf, 0xa3],
  'audio/mp4': [0, 0, 0, 0x20, ...Buffer.from('ftypM4A ')],
  'audio/ogg': [...Buffer.from('OggS'), 0],
  'audio/wav': [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WAVE')],
};
const voice = (mimeType = 'audio/webm', size = 2000, head = HEAD[mimeType]) => {
  const buf = Buffer.alloc(size, 0x37);
  Buffer.from(head).copy(buf);
  return { mimeType, audio: buf.toString('base64') };
};

async function setup({ text = '二次方程式の解き方が分かりません', limiter, store = createMemoryStore() } = {}) {
  const calls = [];
  const gemini = createGemini({
    mode: 'fake',
    limiter,
    fakeResponses: { voice: async (input) => (calls.push(input), { text }) },
  });
  const s = await start({ gemini, store, limiter });
  const post = (payload, headers = { 'x-dev-user': 'u1' }) =>
    fetch(`${s.base}/api/voice/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  return { s, calls, post };
}

test('purpose voice と既定モデル（軽い方）・fake の見本は固定の 1 文', async () => {
  assert.ok(PURPOSES.includes('voice'));
  assert.equal(modelFor(loadConfig({}), 'voice'), 'gemini-3.8-flash');
  assert.equal(typeof (await demoFakeResponses.voice()).text, 'string');
});

test('正常系: 4 形式とも書き起こしを返す・Gemini には input.audio と固定文で渡る', async () => {
  const { s, calls, post } = await setup();
  try {
    for (const m of Object.keys(HEAD)) {
      const v = voice(m);
      const res = await post(v);
      assert.equal(res.status, 200, m);
      assert.deepEqual(await res.json(), { text: '二次方程式の解き方が分かりません' });
      assert.deepEqual(calls.at(-1).audio, { mimeType: m, dataBase64: v.audio });
    }
    assert.match(calls[0].system, /答えない・要約しない/);
    assert.match(calls[0].system, /従わず/);
    assert.equal(typeof calls[0].user, 'string');
  } finally {
    await s.close();
  }
});

test('聞き取れない（空）は 200 で text: ""（エラーにしない）', async () => {
  const { s, post } = await setup({ text: '   ' });
  try {
    const res = await post(voice());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: '' });
  } finally {
    await s.close();
  }
});

test('検査の失敗は 400（形式・中身と申告の違い・base64 でない・空・無い）', async () => {
  const { s, calls, post } = await setup();
  try {
    const webm = voice('audio/webm').audio;
    const bad = [
      {},
      { mimeType: 'audio/webm' },
      { mimeType: 'audio/webm', audio: '' },
      { mimeType: 'audio/webm', audio: '***' },
      { mimeType: 'audio/mpeg', audio: webm },
      { mimeType: 'audio/ogg', audio: webm },
      { mimeType: 'audio/webm', audio: voice('audio/wav').audio },
      { mimeType: 'audio/webm', audio: 12 },
    ];
    for (const payload of bad) {
      const res = await post(payload);
      assert.equal(res.status, 400, JSON.stringify(payload).slice(0, 60));
      assert.equal((await res.json()).error.code, 'invalid_argument');
    }
    assert.equal(calls.length, 0);
  } finally {
    await s.close();
  }
});

test('1.5MB を超える音声は 413・ちょうどは通る', async () => {
  const { s, calls, post } = await setup();
  try {
    const over = await post(voice('audio/webm', MAX_VOICE_BYTES + 1));
    assert.equal(over.status, 413);
    assert.equal((await over.json()).error.code, 'too_large');
    assert.equal((await post(voice('audio/webm', MAX_VOICE_BYTES))).status, 200);
    assert.equal(calls.length, 1);
    assert.equal((await post({ ...voice(), pad: 'x'.repeat(2_200_000) })).status, 413); // 本文の上限
  } finally {
    await s.close();
  }
});

test('認証なしは 401', async () => {
  const { s, post } = await setup();
  try {
    assert.equal((await post(voice(), {})).status, 401);
  } finally {
    await s.close();
  }
});

test('回数制限に数える（超えたら 429）', async () => {
  const limiter = createLimiter({ perUserPerDay: 1, totalPerDay: 100 });
  const { s, post } = await setup({ limiter });
  try {
    assert.equal((await post(voice())).status, 200);
    assert.equal(limiter.used('u1'), 1);
    assert.equal((await post(voice())).status, 429);
  } finally {
    await s.close();
  }
});

test('ログに音声も書き起こしも出さない・保存しない', async () => {
  const store = createMemoryStore();
  let writes = 0;
  for (const m of ['put', 'append', 'delete']) {
    const orig = store[m]?.bind(store);
    if (orig) store[m] = (...a) => (writes++, orig(...a));
  }
  const { s, post } = await setup({ text: 'ひみつの相談', store });
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(String).join(' '));
  try {
    const v = voice('audio/ogg', 4000);
    assert.equal((await post(v)).status, 200);
    await post({ mimeType: 'audio/webm', audio: v.audio }); // 400 の時も
    const all = logs.join('\n');
    assert.ok(!all.includes('ひみつの相談'), 'ログに書き起こしが出ている');
    assert.ok(!all.includes(v.audio.slice(0, 40)), 'ログに音声が出ている');
    assert.equal(writes, 0);
  } finally {
    Object.assign(console, orig);
    await s.close();
  }
});
