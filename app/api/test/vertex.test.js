import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini } from '../src/gemini/index.js';
import { createLimiter } from '../src/limiter.js';
import { loadConfig } from '../src/config.js';
import {
  createTokenProvider,
  createVertexClient,
  endpointFor,
  extractOutput,
  extractSources,
  modelFor,
  toVertexSchema,
} from '../src/gemini/vertex.js';

// 実際のネットワーク・認証は使わない。トークンはテスト内で組み立てた偽の文字列。
const FAKE_TOKEN = ['tok', 'en', Math.random().toString(36).slice(2)].join('-');
const PROJECT = ['demo', 'project', '1'].join('-');
const config = loadConfig({ GEMINI_MODE: 'real', GCP_PROJECT_ID: PROJECT });
const input = { system: 'あなたは先生です', user: '<user_text>こんにちは</user_text>' };
const schema = {
  type: 'object',
  required: ['reply'],
  properties: { reply: { type: 'string' }, level: { enum: ['low', 'high'] }, tags: { type: 'array', items: { type: 'string' } } },
};

const okBody = (obj, extra = {}) => ({
  candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, ...extra }],
});
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function recorder(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return respond(calls.length, url, init);
  };
  return { calls, fetchImpl };
}

function client(respond, over = {}) {
  const r = recorder(respond);
  const logs = [];
  const real = createVertexClient({
    config: over.config || config,
    fetchImpl: r.fetchImpl,
    getToken: over.getToken || (async () => FAKE_TOKEN),
    log: (l) => logs.push(l),
    sleep: over.sleep || (async () => {}), // やり直しの待ちは 0 ms（試験を遅くしない）
    ...(over.gate && { gate: over.gate }),
  });
  return { ...r, real, logs };
}

test('toVertexSchema: 型は大文字・順序と必須と enum を引き継ぐ', () => {
  assert.deepEqual(toVertexSchema(schema), {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING' },
      level: { type: 'STRING', enum: ['low', 'high'] },
      tags: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    propertyOrdering: ['reply', 'level', 'tags'],
    required: ['reply'],
  });
  assert.deepEqual(toVertexSchema({ type: 'integer' }), { type: 'INTEGER' });
  assert.deepEqual(toVertexSchema({ type: 'number' }), { type: 'NUMBER' });
  assert.deepEqual(toVertexSchema({ type: 'boolean' }), { type: 'BOOLEAN' });
  assert.throws(() => toVertexSchema({ type: 'null' }), /未対応/);
  assert.throws(() => toVertexSchema({ enum: [1, 2] }), /enum/);
});

test('config: プロジェクト ID に既定値がない・purpose 別のモデル・GEMINI_MODEL で全体上書き', () => {
  assert.equal(loadConfig({}).gcpProjectId, '');
  assert.equal(loadConfig({}).gcpRegion, 'global');
  const c = loadConfig({});
  assert.equal(modelFor(c, 'roadmap'), 'gemini-4-argon');
  assert.equal(modelFor(c, 'hint'), 'gemini-3.8-flash');
  assert.equal(modelFor(loadConfig({ GEMINI_MODEL: 'gemini-x-1' }), 'roadmap'), 'gemini-x-1');
  assert.throws(() => modelFor(loadConfig({ GEMINI_MODEL: '../evil' }), 'hint'), /モデル名/);
});

test('endpointFor: global と地域のホスト・不正な値は拒否', () => {
  assert.equal(
    endpointFor(config, 'gemini-3.8-flash'),
    `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/gemini-3.8-flash:generateContent`,
  );
  const regional = loadConfig({ GCP_PROJECT_ID: PROJECT, GCP_REGION: 'asia-southeast1' });
  assert.match(endpointFor(regional, 'm'), /^https:\/\/asia-southeast1-aiplatform\.googleapis\.com\/v1\/projects\/.+\/locations\/asia-southeast1\//);
  assert.throws(() => endpointFor(loadConfig({}), 'm'), /GCP_PROJECT_ID/);
  assert.throws(() => endpointFor(loadConfig({ GCP_PROJECT_ID: 'a/b' }), 'm'), /GCP_PROJECT_ID/);
  assert.throws(() => endpointFor(loadConfig({ GCP_PROJECT_ID: PROJECT, GCP_REGION: 'x.evil.com/' }), 'm'), /GCP_REGION/);
});

test('正常系: system と user を分けて送り、構造化出力の設定を付け、JSON を返す', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'はい', level: 'low', tags: [] })));
  const out = await c.real({ purpose: 'hint', input, schema });
  assert.deepEqual(out, { output: { reply: 'はい', level: 'low', tags: [] }, model: 'gemini-3.8-flash', usage: null });
  const [call] = c.calls;
  assert.match(call.url, /gemini-3\.8-flash:generateContent$/);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.authorization, `Bearer ${FAKE_TOKEN}`);
  assert.deepEqual(call.body.systemInstruction, { parts: [{ text: input.system }] });
  assert.deepEqual(call.body.contents, [{ role: 'user', parts: [{ text: input.user }] }]);
  assert.ok(!call.body.systemInstruction.parts[0].text.includes('user_text'));
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(call.body.generationConfig.responseSchema.type, 'OBJECT');
  assert.equal(call.body.generationConfig.maxOutputTokens, 8192);
  assert.equal(call.body.tools, undefined);
});

test('purpose ごとにモデルが変わる（roadmap=上位）', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'x' })));
  await c.real({ purpose: 'roadmap', input, schema });
  assert.match(c.calls[0].url, /gemini-4-argon:generateContent$/);
});

test('grounding: googleSearch を付け、sources を取り出す（重複・http 以外は除く）', async () => {
  const body = okBody(
    { reply: 'x' },
    {
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: 'https://example.com/a', title: '記事A' } },
          { web: { uri: 'https://example.com/a', title: '重複' } },
          { web: { uri: 'javascript:alert(1)', title: '悪い' } },
          { web: { uri: 'https://example.org/b', domain: 'example.org' } },
          { retrievedContext: { uri: 'https://x' } },
        ],
      },
    },
  );
  const c = client(() => jsonRes(200, body));
  const out = await c.real({ purpose: 'research', input, schema, grounding: true });
  assert.deepEqual(c.calls[0].body.tools, [{ googleSearch: {} }]);
  assert.deepEqual(out.sources, [
    { title: '記事A', url: 'https://example.com/a' },
    { title: 'example.org', url: 'https://example.org/b' },
  ]);
  assert.deepEqual(extractSources({}), []);
});

test('grounding でない時は sources を返さない', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'x' })));
  const out = await c.real({ purpose: 'hint', input, schema });
  assert.ok(!('sources' in out));
});

test('思考の要約（thought）は出力に含めない・FINISH_REASON_ 接頭辞も STOP とみなす', () => {
  const body = {
    candidates: [
      {
        finishReason: 'FINISH_REASON_STOP',
        content: { parts: [{ thought: true, text: '考え中' }, { text: '{"a":' }, { text: '1}' }] },
      },
    ],
  };
  assert.deepEqual(extractOutput(body), { a: 1 });
});

test('出力の不備は 502 upstream_invalid（空・安全フィルタ・途中停止・JSON 不正・候補なし）', async () => {
  const bad = [
    { candidates: [] },
    {},
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'SAFETY' }] },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"reply":"x"' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'これは JSON ではない' }] } }] },
  ];
  for (const b of bad) {
    const c = client(() => jsonRes(200, b));
    await assert.rejects(
      () => c.real({ purpose: 'hint', input, schema }),
      (e) => e.status === 502 && e.code === 'upstream_invalid' && !JSON.stringify(e.message).includes('JSON ではない'),
    );
    assert.match(c.logs[0], /status=invalid_output/);
  }
});

test('HTTP 429・503 が続けば 503 upstream_busy、500・400・401・403 は 502', async () => {
  for (const [status, expect] of [[429, 503], [500, 502], [503, 503], [400, 502], [401, 502], [403, 502]]) {
    const c = client(() => jsonRes(status, { error: { message: 'プロンプト全文: ひみつ' } }));
    await assert.rejects(
      () => c.real({ purpose: 'hint', input, schema }),
      (e) => e.status === expect && !e.message.includes('ひみつ'),
    );
  }
});

test('本文が JSON でない応答・ネットワーク失敗は 502', async () => {
  const c1 = client(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }));
  await assert.rejects(() => c1.real({ purpose: 'hint', input, schema }), (e) => e.status === 502);
  const c2 = client(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => c2.real({ purpose: 'hint', input, schema }), (e) => e.status === 502);
  assert.match(c2.logs[0], /status=network_error/);
});

test('タイムアウト: 時間内に返らなければ 502（AbortController）', async () => {
  const cfg = loadConfig({ GCP_PROJECT_ID: PROJECT, GEMINI_TIMEOUT_MS: '20' });
  const real = createVertexClient({
    config: cfg,
    getToken: async () => FAKE_TOKEN,
    log: () => {},
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
  });
  await assert.rejects(
    () => real({ purpose: 'hint', input, schema }),
    (e) => e.status === 502 && /時間内/.test(e.message),
  );
});

test('トークン取得の失敗は 502、トークンの値はどこにも出ない', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'x' })), {
    getToken: async () => {
      throw new Error(`boom ${FAKE_TOKEN}`);
    },
  });
  await assert.rejects(
    () => c.real({ purpose: 'hint', input, schema }),
    (e) => e.status === 502 && !e.message.includes(FAKE_TOKEN),
  );
  assert.equal(c.calls.length, 0);
  assert.ok(c.logs.every((l) => !l.includes(FAKE_TOKEN)));
});

test('ログは purpose・モデル・状態・所要時間だけ（プロンプトも出力も出ない）', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: '秘密の返答' })));
  await c.real({ purpose: 'hint', input, schema });
  assert.equal(c.logs.length, 1);
  assert.match(c.logs[0], /^gemini purpose=hint model=gemini-3\.8-flash status=200 ms=\d+$/);
  assert.ok(!c.logs[0].includes('こんにちは') && !c.logs[0].includes('秘密の返答') && !c.logs[0].includes(FAKE_TOKEN));
});

test('input が { system, user } でない・設定が足りない時は例外（呼び出し前）', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'x' })));
  await assert.rejects(() => c.real({ purpose: 'hint', input: { text: 'a' }, schema }), /system/);
  await assert.rejects(() => c.real({ purpose: 'hint', input: 'a', schema }), /system/);
  const noProject = client(() => jsonRes(200, {}), { config: loadConfig({}) });
  await assert.rejects(() => noProject.real({ purpose: 'hint', input, schema }), /GCP_PROJECT_ID/);
  assert.equal(c.calls.length + noProject.calls.length, 0);
});

test('createGemini と接続: 検査・502・回数制限が real でも働く', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'はい' })));
  const limiter = createLimiter({ perUserPerDay: 1, totalPerDay: 5 });
  const g = createGemini({ mode: 'real', limiter, real: c.real });
  const out = await g.generate({ purpose: 'hint', input, schema, userId: 'u1' });
  assert.deepEqual(out, { reply: 'はい' });
  await assert.rejects(() => g.generate({ purpose: 'hint', input, schema, userId: 'u1' }), (e) => e.status === 429);
  assert.equal(c.calls.length, 1); // 制限に掛かった呼び出しは Vertex に行かない

  const wrong = client(() => jsonRes(200, okBody({ reply: 5 })));
  const g2 = createGemini({ mode: 'real', real: wrong.real });
  const orig = console.error;
  console.error = () => {};
  await assert.rejects(
    () => g2.generate({ purpose: 'hint', input, schema, userId: 'u2' }),
    (e) => e.status === 502 && e.code === 'upstream_invalid',
  );
  console.error = orig;

  const g3 = createGemini({ mode: 'real', real: c.real });
  const gr = await g3.generate({ purpose: 'research', input, schema, userId: 'u3', grounding: true });
  assert.deepEqual(gr, { reply: 'はい', sources: [] });
});

// ---- トークン ----
test('token: GEMINI_ACCESS_TOKEN があればそれを使い、メタデータは呼ばない', async () => {
  let called = 0;
  const get = createTokenProvider({
    fetchImpl: async () => { called++; return jsonRes(200, {}); },
    env: { GEMINI_ACCESS_TOKEN: FAKE_TOKEN },
  });
  assert.equal(await get(), FAKE_TOKEN);
  assert.equal(called, 0);
});

test('token: メタデータサーバーから取り、期限の少し前まで使い回し、その後更新する', async () => {
  let t = 1_000_000;
  let n = 0;
  const seen = [];
  const get = createTokenProvider({
    env: {},
    now: () => t,
    fetchImpl: async (url, init) => {
      seen.push({ url, headers: init.headers });
      n++;
      return jsonRes(200, { access_token: `${FAKE_TOKEN}-${n}`, expires_in: 3600, token_type: 'Bearer' });
    },
  });
  assert.equal(await get(), `${FAKE_TOKEN}-1`);
  assert.equal(seen[0].url, 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token');
  assert.equal(seen[0].headers['Metadata-Flavor'], 'Google');
  t += 3_000_000; // 3000 秒後: まだ使い回す（期限 3600 秒の 60 秒前は 3540 秒）
  assert.equal(await get(), `${FAKE_TOKEN}-1`);
  assert.equal(n, 1);
  t += 600_000; // 3600 秒後: 更新
  assert.equal(await get(), `${FAKE_TOKEN}-2`);
  assert.equal(n, 2);
});

test('token: 同時に呼んでも取得は 1 回・失敗は例外（値を含まない）で、次は再取得できる', async () => {
  let n = 0;
  const get = createTokenProvider({
    env: {},
    fetchImpl: async () => {
      n++;
      await new Promise((r) => setTimeout(r, 5));
      return jsonRes(200, { access_token: FAKE_TOKEN, expires_in: 3600 });
    },
  });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a, FAKE_TOKEN);
  assert.equal(b, FAKE_TOKEN);
  assert.equal(n, 1);

  let fail = true;
  const get2 = createTokenProvider({
    env: {},
    fetchImpl: async () => (fail ? jsonRes(500, {}) : jsonRes(200, { access_token: FAKE_TOKEN, expires_in: 3600 })),
  });
  await assert.rejects(() => get2(), (e) => !e.message.includes(FAKE_TOKEN));
  fail = false;
  assert.equal(await get2(), FAKE_TOKEN);
  const bad = createTokenProvider({ env: {}, fetchImpl: async () => jsonRes(200, { nope: 1 }) });
  await assert.rejects(() => bad());
});

test('写真: input.images を文字の後ろに inlineData の部品として送る・ログには枚数だけ', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'x' })));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  const images = [
    { mimeType: 'image/jpeg', dataBase64: jpeg },
    { mimeType: 'image/png', dataBase64: png },
  ];
  await c.real({ purpose: 'achievement', input: { ...input, images }, schema });
  assert.deepEqual(c.calls[0].body.contents, [
    {
      role: 'user',
      parts: [
        { text: input.user },
        { inlineData: { mimeType: 'image/jpeg', data: jpeg } },
        { inlineData: { mimeType: 'image/png', data: png } },
      ],
    },
  ]);
  assert.equal(c.logs.length, 1);
  assert.match(c.logs[0], /images=2/);
  assert.ok(!c.logs[0].includes(jpeg) && !c.logs[0].includes(png), 'ログに写真の中身が出ている');
});

test('音声: input.audio を文字と写真の後ろに inlineData の部品として送る・ログには数と長さだけ', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'x' })));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 9, 8, 7, 6, 5]).toString('base64');
  const images = [{ mimeType: 'image/jpeg', dataBase64: jpeg }];
  const audio = { mimeType: 'audio/webm', dataBase64: webm };
  await c.real({ purpose: 'achievement', input: { ...input, images, audio }, schema });
  assert.deepEqual(c.calls[0].body.contents[0].parts, [
    { text: input.user },
    { inlineData: { mimeType: 'image/jpeg', data: jpeg } },
    { inlineData: { mimeType: 'audio/webm', data: webm } },
  ]);
  assert.match(c.logs[0], /images=1 audio=1 audioChars=\d+$/);
  assert.ok(!c.logs[0].includes(webm), 'ログに音声の中身が出ている');

  // 音声だけ（写真なし）でも載る。images= はログに出ない
  await c.real({ purpose: 'achievement', input: { ...input, audio }, schema });
  assert.deepEqual(c.calls[1].body.contents[0].parts, [{ text: input.user }, { inlineData: { mimeType: 'audio/webm', data: webm } }]);
  assert.doesNotMatch(c.logs[1], /images=/);
  assert.match(c.logs[1], /audio=1/);

  // 形が不正なら呼び出し前に例外
  for (const bad of ['x', [audio], { mimeType: 'audio/flac', dataBase64: webm }, { mimeType: 'audio/webm', dataBase64: '' }, {}]) {
    await assert.rejects(c.real({ purpose: 'achievement', input: { ...input, audio: bad }, schema }), /audio/);
  }
  assert.equal(c.calls.length, 2);
});

test('写真: images が無い・空なら文字の部品だけ。形が不正なら呼び出し前に例外', async () => {
  const c = client(() => jsonRes(200, okBody({ reply: 'x' })));
  await c.real({ purpose: 'achievement', input: { ...input, images: [] }, schema });
  assert.deepEqual(c.calls[0].body.contents[0].parts, [{ text: input.user }]);
  assert.doesNotMatch(c.logs[0], /images=/);
  for (const images of ['x', [{ mimeType: 'image/gif', dataBase64: 'AAAA' }], [{ mimeType: 'image/png', dataBase64: '' }], [null]]) {
    await assert.rejects(c.real({ purpose: 'achievement', input: { ...input, images }, schema }), /images/);
  }
  assert.equal(c.calls.length, 1);
});

test('文書（#201）: input.files の PDF を写真の後ろに inlineData で送る・ログには件数だけ・PDF 以外は例外', async () => {
  const c = client(() => jsonRes(200, okBody({ text: 'x' })));
  const pdf = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  const images = [{ mimeType: 'image/jpeg', dataBase64: jpeg }];
  await c.real({ purpose: 'material', input: { ...input, images, files: [{ mimeType: 'application/pdf', dataBase64: pdf }] }, schema });
  assert.deepEqual(c.calls[0].body.contents[0].parts, [
    { text: input.user },
    { inlineData: { mimeType: 'image/jpeg', data: jpeg } },
    { inlineData: { mimeType: 'application/pdf', data: pdf } },
  ]);
  assert.match(c.logs[0], /images=1 files=1/);
  assert.ok(!c.logs[0].includes(pdf), 'ログに PDF の中身が出ている');
  for (const files of ['x', [{ mimeType: 'text/plain', dataBase64: 'AAAA' }], [{ mimeType: 'application/pdf', dataBase64: '' }], [null]]) {
    await assert.rejects(c.real({ purpose: 'material', input: { ...input, files }, schema }), /files/);
  }
  assert.equal(c.calls.length, 1);
});
