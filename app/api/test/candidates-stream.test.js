import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { createGemini } from '../src/gemini/index.js';
import { createArrayItemScanner, createSseParser } from '../src/gemini/jsonStream.js';
import { createVertexClient } from '../src/gemini/vertex.js';
import { createLimiter } from '../src/limiter.js';
import { fakeRoadmap } from '../src/roadmap/candidates.js';

// ---------- 断片から案を取り出す走査 ----------
const tricky = {
  candidates: [
    { label: '括弧 } と { を含む', summary: '引用 \\"x\\" と "y"', n: [1, { a: '}' }] },
    { label: '日本語　全角の空白', summary: 'ok' },
    { label: '三つ目', summary: '[]{}' },
    { label: '四つ目', summary: '最大を超える' },
  ],
};
const scanAll = (text, cuts) => {
  const s = createArrayItemScanner({ max: 3 });
  const out = [];
  let prev = 0;
  for (const c of [...cuts, text.length]) {
    out.push(...s.push(text.slice(prev, c)));
    prev = c;
  }
  return out;
};

test('走査: 断片の切れ目がどこでも同じ結果・文字列の中の括弧とエスケープ・最大 3 件', () => {
  const text = JSON.stringify(tricky, null, 1);
  const want = tricky.candidates.slice(0, 3);
  assert.deepEqual(scanAll(text, []), want);
  for (let i = 1; i < text.length; i += 1) assert.deepEqual(scanAll(text, [i]), want, `切れ目 ${i}`);
  assert.deepEqual(scanAll(text, Array.from({ length: text.length - 1 }, (_, i) => i + 1)), want); // 1 文字ずつ
});

test('走査: candidates 以外の配列・入れ子の object は返さない', () => {
  const s = createArrayItemScanner();
  assert.deepEqual(s.push('{"other":[{"a":1}],"candidates":[{"b":{"c":2}}]}'), [{ b: { c: 2 } }]);
});

// ---------- SSE の分解 ----------
test('SSE: 改行の切れ目・\\r\\n・1 つの断片に複数のイベント・注釈', () => {
  const text = 'event: axes\ndata: {"a":1}\n\n: ping\r\nevent: candidate\r\ndata: {"b":2}\r\n\r\nevent: error\ndata: {"code":"x"}\n\n';
  const want = [
    { event: 'axes', data: '{"a":1}' },
    { event: 'candidate', data: '{"b":2}' },
    { event: 'error', data: '{"code":"x"}' },
  ];
  assert.deepEqual(createSseParser().push(text), want);
  for (let i = 1; i < text.length; i += 1) {
    const p = createSseParser();
    assert.deepEqual([...p.push(text.slice(0, i)), ...p.push(text.slice(i))], want, `切れ目 ${i}`);
  }
});

// ---------- サーバーの経路 ----------
const NOW = new Date('2026-11-05T00:00:00.000Z');
const h = (u) => ({ 'x-dev-user': u, 'content-type': 'application/json' });
const goalBody = { text: '期末レポート', deadline: '2026-11-20T00:00:00+09:00', minutesPerDay: 60 };

async function boot(roadmapFn = async () => fakeRoadmap(), { limiter } = {}) {
  const gemini = createGemini({ mode: 'fake', limiter, fakeResponses: { roadmap: roadmapFn } });
  const s = await start({ gemini, now: () => NOW });
  const g = await (await fetch(`${s.base}/api/goals`, { method: 'POST', headers: h('u1'), body: JSON.stringify(goalBody) })).json();
  return { s, goalId: g.id };
}
async function streamOf(s, goalId, payload = {}) {
  const res = await fetch(`${s.base}/api/goals/${goalId}/candidates/stream`, { method: 'POST', headers: h('u1'), body: JSON.stringify(payload) });
  const text = await res.text();
  const events = createSseParser().push(text).map((e) => ({ event: e.event, data: JSON.parse(e.data) }));
  return { res, events };
}

test('stream: axes → candidate 3 回 → done。保存した案の ID は送った物と同じ', async () => {
  const { s, goalId } = await boot();
  try {
    const { res, events } = await streamOf(s, goalId, { note: '朝に進めたい' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.deepEqual(events.map((e) => e.event), ['axes', 'candidate', 'candidate', 'candidate', 'done']);
    assert.ok(Array.isArray(events[0].data.axes));
    assert.deepEqual(events[4].data, { count: 3 });
    const sentIds = events.filter((e) => e.event === 'candidate').map((e) => e.data.id);
    const got = await (await fetch(`${s.base}/api/goals/${goalId}`, { headers: h('u1') })).json();
    assert.deepEqual(got.candidates.map((c) => c.id), sentIds);
    assert.equal(got.candidates[0].label, '小さく刻む');
  } finally {
    await s.close();
  }
});

test('stream: 全体の検査に落ちると error で閉じ、保存しない', async () => {
  const four = () => {
    const r = fakeRoadmap();
    return { candidates: [...r.candidates, r.candidates[0]] }; // 4 案は多すぎる
  };
  const { s, goalId } = await boot(async () => four());
  try {
    const { res, events } = await streamOf(s, goalId);
    assert.equal(res.status, 200);
    const last = events.at(-1);
    assert.equal(last.event, 'error');
    assert.equal(last.data.code, 'upstream_invalid');
    assert.ok(!events.some((e) => e.event === 'done'));
    const got = await (await fetch(`${s.base}/api/goals/${goalId}`, { headers: h('u1') })).json();
    assert.deepEqual(got.candidates, []);
  } finally {
    await s.close();
  }
});

test('stream: 点の上限は error rate_limited。確定後は 409 の JSON', async () => {
  const limiter = createLimiter({ perUserPerDay: 1, totalPerDay: 100 });
  const { s, goalId } = await boot(undefined, { limiter });
  try {
    const first = await streamOf(s, goalId);
    assert.equal(first.events.at(-1).event, 'done');
    const second = await streamOf(s, goalId);
    assert.deepEqual(second.events.at(-1), { event: 'error', data: second.events.at(-1).data });
    assert.equal(second.events.at(-1).data.code, 'rate_limited');
    const cid = first.events[1].data.id;
    const ok = await fetch(`${s.base}/api/goals/${goalId}/roadmap`, {
      method: 'POST',
      headers: h('u1'),
      body: JSON.stringify({ source: 'candidate', candidateId: cid, why: 'これで進める' }),
    });
    assert.equal(ok.status, 201); // 送った ID で確定できる
    const third = await fetch(`${s.base}/api/goals/${goalId}/candidates/stream`, { method: 'POST', headers: h('u1'), body: '{}' });
    assert.equal(third.status, 409);
    assert.equal((await third.json()).error.code, 'conflict');
  } finally {
    await s.close();
  }
});

test('stream: 他人の目標は 404・note が長すぎると 400（どちらも JSON）', async () => {
  const { s, goalId } = await boot();
  try {
    const other = await fetch(`${s.base}/api/goals/${goalId}/candidates/stream`, { method: 'POST', headers: h('u2'), body: '{}' });
    assert.equal(other.status, 404);
    const long = await fetch(`${s.base}/api/goals/${goalId}/candidates/stream`, {
      method: 'POST',
      headers: h('u1'),
      body: JSON.stringify({ note: 'あ'.repeat(201) }),
    });
    assert.equal(long.status, 400);
  } finally {
    await s.close();
  }
});

// ---------- Vertex のストリーミング（偽の fetch） ----------
test('vertex stream: streamGenerateContent?alt=sse を呼び、思考を除いた断片を順に渡して全体を返す', async () => {
  const PROJECT = ['demo', 'project', '1'].join('-');
  const config = loadConfig({ GEMINI_MODE: 'real', GCP_PROJECT_ID: PROJECT });
  const full = JSON.stringify({ reply: 'こんにちは' });
  const chunk = (parts, extra = {}) => `data: ${JSON.stringify({ candidates: [{ content: { parts }, ...extra }] })}\r\n\r\n`;
  const sse = [
    chunk([{ text: '考え中', thought: true }]),
    chunk([{ text: full.slice(0, 7) }]),
    chunk([{ text: full.slice(7) }], { finishReason: 'STOP' }),
  ].join('');
  const bytes = new TextEncoder().encode(sse);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5)); // バイトの途中（日本語の途中）でも切る
        c.close();
      },
    });
    return { ok: true, status: 200, body };
  };
  const logs = [];
  const real = createVertexClient({ config, fetchImpl, getToken: async () => 'x', log: (l) => logs.push(l) });
  const pieces = [];
  const schema = { type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } };
  const r = await real.stream({ purpose: 'roadmap', input: { system: 's', user: 'u' }, schema, onText: (t) => pieces.push(t) });
  assert.match(urls[0], /:streamGenerateContent\?alt=sse$/);
  assert.deepEqual(r.output, { reply: 'こんにちは' });
  assert.equal(pieces.join(''), full);
  assert.ok(!logs.join('\n').includes('こんにちは')); // 出力をログに出さない
});
