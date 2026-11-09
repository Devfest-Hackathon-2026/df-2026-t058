import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './helpers.js';
import { demoFakeResponses } from '../src/gemini/fake.js';
import { createMemoryStore } from '../src/store/index.js';

// 契約の応答の形（contract-shapes.json）と、サーバーの実応答を突き合わせる（Issue #66・11/6 の食い違いの再発防止）。
// スマホ側は app/mobile/src/__tests__/contractShapes.test.ts が、同じ見本で mock と types.ts を確かめる。
const here = dirname(fileURLToPath(import.meta.url));
const SHAPES_PATH = join(here, 'contract-shapes.json');
const MOBILE_COPY = join(here, '../../mobile/src/__tests__/contract-shapes.json');
const SHAPES = JSON.parse(readFileSync(SHAPES_PATH, 'utf8'));

// 型の文字（"string|null"・"[Floor]"・"User"）に値が合うか。合わない所を文の配列で返す。
export function shapeErrors(typeSpec, value, where, models = SHAPES.models) {
  const alts = typeSpec.split('|');
  let best = null;
  for (const t of alts) {
    const errs = oneType(t, value, where, models);
    if (errs.length === 0) return [];
    if (!best || errs.length < best.length) best = errs;
  }
  return best; // どれにも合わない時は、いちばん近い型の食い違いを返す
}

function oneType(t, v, where, models) {
  if (t.startsWith('[') && t.endsWith(']')) {
    if (!Array.isArray(v)) return [`${where}: 配列ではない`];
    return v.flatMap((x, i) => shapeErrors(t.slice(1, -1), x, `${where}[${i}]`, models));
  }
  if (t === 'null') return v === null ? [] : [`${where}: null ではない`];
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v) ? [] : [`${where}: object ではない`];
  if (['string', 'number', 'boolean'].includes(t)) return typeof v === t ? [] : [`${where}: ${t} ではない（${JSON.stringify(v)}）`];
  const model = models[t];
  if (!model) return [`${where}: 見本に無い型 ${t}`];
  return objectErrors(model, v, where, models);
}

export function objectErrors(spec, v, where, models = SHAPES.models) {
  if (spec.model) return shapeErrors(spec.model, v, where, models);
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${where}: object ではない`];
  const errs = [];
  for (const [k, t] of Object.entries(spec.required)) {
    if (!(k in v)) errs.push(`${where}.${k}: 無い`);
    else errs.push(...shapeErrors(t, v[k], `${where}.${k}`, models));
  }
  for (const [k, x] of Object.entries(v)) {
    if (k in spec.required) continue;
    if (!(k in spec.optional)) errs.push(`${where}.${k}: 契約に無いキー`);
    else if (x !== undefined) errs.push(...shapeErrors(spec.optional[k], x, `${where}.${k}`, models));
  }
  return errs;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const IMG = { mimeType: 'image/jpeg', dataBase64: JPEG };
const T0 = Date.parse('2026-11-05T03:00:00.000Z');

test('見本の形の検査そのもの: 足りない・型違い・契約に無いキーを見つける', () => {
  const spec = SHAPES.models.Axis;
  assert.deepEqual(objectErrors(spec, { key: 'a', label: 'b' }, 'x'), []);
  assert.equal(objectErrors(spec, { key: 'a' }, 'x').length, 1);
  assert.equal(objectErrors(spec, { key: 1, label: 'b' }, 'x').length, 1);
  assert.equal(objectErrors(spec, { key: 'a', label: 'b', extra: 1 }, 'x').length, 1);
  assert.deepEqual(shapeErrors('Roadmap|null', null, 'x'), []);
  assert.equal(shapeErrors('[Axis]', [{ key: 'a' }], 'x').length, 1);
});

test('スマホ側の見本の写しは、サーバー側と同じ中身', { skip: !existsSync(MOBILE_COPY) && 'スマホのファイルが無い' }, () => {
  assert.deepEqual(JSON.parse(readFileSync(MOBILE_COPY, 'utf8')), SHAPES);
});

test('契約の全ての経路で、サーバーの実応答が見本の形（キーと型）に合う', async () => {
  let t = T0;
  const fakeResponses = {
    ...demoFakeResponses,
    research: async () => ({ reply: '（見本）調べた結果', helpLevel: 'small', answerRevealed: false, sources: [{ title: '見本', url: 'https://example.com/' }] }),
  };
  const s = await start({ now: () => new Date((t += 1000)), store: createMemoryStore({ now: () => new Date(t) }), fakeResponses });
  const seen = new Map();
  const call = async (user, method, path, route, payload) => {
    const res = await fetch(`${s.base}${path}`, {
      method,
      headers: { 'x-dev-user': user, 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const json = await res.json();
    assert.ok(res.status < 300, `${route}: ${res.status} ${JSON.stringify(json)}`);
    seen.set(route, json);
    assert.deepEqual(objectErrors(SHAPES.responses[route], json, route), [], route);
    return json;
  };

  await call('u1', 'GET', '/api/health', 'GET /api/health');
  await call('u1', 'GET', '/api/me', 'GET /api/me');
  await call('u1', 'PUT', '/api/me', 'PUT /api/me', { displayName: 'いち', nudgeLevel: 'strong' });
  const goal = await call('u1', 'POST', '/api/goals', 'POST /api/goals', {
    text: '二次方程式', deadline: '2026-11-12T00:00:00+09:00', minutesPerDay: 30, materials: 'p.12〜15',
  });
  await call('u1', 'GET', '/api/goals', 'GET /api/goals');
  const { candidates } = await call('u1', 'POST', `/api/goals/${goal.id}/candidates`, 'POST /api/goals/:id/candidates', {});
  await call('u1', 'GET', `/api/goals/${goal.id}`, 'GET /api/goals/:id');
  const edited = candidates[0].checkpoints.map(({ title, doneMark, estimateMin }, i) => ({ title: i ? title : '直した', doneMark, estimateMin }));
  const roadmap = await call('u1', 'POST', `/api/goals/${goal.id}/roadmap`, 'POST /api/goals/:id/roadmap', {
    source: 'edited', candidateId: candidates[0].id, why: '自分に合う', checkpoints: edited,
  });
  assert.equal(typeof roadmap.editRatio, 'number');

  const ses = await call('u1', 'POST', '/api/sessions', 'POST /api/sessions', {
    goalId: goal.id, checkpointId: roadmap.checkpoints[0].id, oneLine: '例題', materials: '問題集 p.12',
  });
  await call('u1', 'GET', '/api/sessions/active', 'GET /api/sessions/active');
  await call('u1', 'POST', `/api/sessions/${ses.id}/events`, 'POST /api/sessions/:id/events', { type: 'leave' });
  await call('u1', 'POST', `/api/sessions/${ses.id}/events`, 'POST /api/sessions/:id/events', { type: 'return' });
  await call('u1', 'POST', `/api/sessions/${ses.id}/tutor`, 'POST /api/sessions/:id/tutor', { kind: 'ask', text: 'やり方は？', images: [IMG] });
  const look = await call('u1', 'POST', `/api/sessions/${ses.id}/tutor`, 'POST /api/sessions/:id/tutor', { kind: 'research', text: '因数分解' });
  assert.ok(look.messages[1].sources.length > 0, '出典の形も確かめる');
  await call('u1', 'GET', `/api/sessions/${ses.id}/tutor`, 'GET /api/sessions/:id/tutor');
  t += 20 * 60 * 1000;
  await call('u1', 'POST', `/api/sessions/${ses.id}/end`, 'POST /api/sessions/:id/end', {});
  await call('u1', 'POST', '/api/materials/read', 'POST /api/materials/read', { images: [IMG] });
  await call('u1', 'POST', `/api/sessions/${ses.id}/reflect`, 'POST /api/sessions/:id/reflect', {
    note: 'できた', done: false, images: [IMG], materials: '', stuck: { cause: 'too_big', note: '' },
  });
  await call('u1', 'POST', `/api/sessions/${ses.id}/reflect/confirm`, 'POST /api/sessions/:id/reflect/confirm', { achievement: 3 });
  await call('u1', 'GET', '/api/tower', 'GET /api/tower');

  // 友達: u2 が u1 に申請 → u1 が承認 → u2 の知らせに u1 の開始が出る
  const code1 = (await call('u1', 'GET', '/api/me', 'GET /api/me')).friendCode;
  const f = await call('u2', 'POST', '/api/friends', 'POST /api/friends', { code: code1 });
  await call('u1', 'POST', `/api/friends/${f.id}/accept`, 'POST /api/friends/:id/accept');
  await call('u1', 'GET', '/api/friends', 'GET /api/friends');
  const feed = await call('u2', 'GET', '/api/feed', 'GET /api/feed');
  assert.ok(feed.items.length > 0);
  const home = await call('u1', 'GET', '/api/home', 'GET /api/home');
  assert.ok(home.goals[0].roadmap.checkpoints[0].aiAchievement !== undefined);
  await s.close();

  // 招待コードのログイン（別のサーバー・値は実行時に作る）
  const rand = (n) => randomBytes(n).toString('hex');
  const inv = await start({}, { AUTH_MODE: 'invite', TEAM_CODE: `team-${rand(6)}`, SESSION_SECRET: rand(24) });
  const code = inv.ctx.config.teamCode;
  const res = await fetch(`${inv.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'はると', code }) });
  const login = await res.json();
  assert.equal(res.status, 200);
  seen.set('POST /api/login', login);
  assert.deepEqual(objectErrors(SHAPES.responses['POST /api/login'], login, 'login'), []);
  const health = await (await fetch(`${inv.base}/api/health`)).json();
  assert.deepEqual(objectErrors(SHAPES.responses['GET /api/health'], health, 'health'), []);
  assert.equal(health.loginRequired, true);
  await inv.close();

  // 見本の全ての経路を通ったこと（経路を足したら、ここにも足す）
  assert.deepEqual([...seen.keys()].sort(), Object.keys(SHAPES.responses).sort());
});
