import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreStore } from '../src/store/index.js';
import { C } from '../src/common/collections.js';

const ROOT = 'https://firestore.googleapis.com/v1/projects/proj-1/databases/(default)/documents';

function setup(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal });
    const r = respond(url, init, calls.length);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  const store = createFirestoreStore({
    projectId: 'proj-1',
    fetchImpl,
    getToken: async () => 'tok-x',
    now: () => new Date('2026-11-06T01:00:00Z'),
  });
  return { store, calls };
}

test('put: PATCH・Authorization・値の変換（undefined は書かない）と戻り値', async () => {
  const { store, calls } = setup(() => ({ status: 200, body: {} }));
  const doc = { userId: 'u1', n: 3, x: 1.5, ok: true, nil: null, tags: ['a', 2], nest: { d: '2026-11-06T00:00:00Z' }, skip: undefined };
  const saved = await store.put(C.goals, 'g/1'.replace('/', '-'), doc);
  assert.equal(saved.id, 'g-1');
  assert.equal('skip' in saved, false);
  const c = calls[0];
  assert.equal(c.method, 'PATCH');
  assert.equal(c.url, `${ROOT}/goals/g-1`);
  assert.equal(c.headers.authorization, 'Bearer tok-x');
  const f = c.body.fields;
  assert.deepEqual(f.n, { integerValue: '3' });
  assert.deepEqual(f.x, { doubleValue: 1.5 });
  assert.deepEqual(f.ok, { booleanValue: true });
  assert.deepEqual(f.nil, { nullValue: null });
  assert.deepEqual(f.tags, { arrayValue: { values: [{ stringValue: 'a' }, { integerValue: '2' }] } });
  assert.deepEqual(f.nest, { mapValue: { fields: { d: { stringValue: '2026-11-06T00:00:00Z' } } } });
  assert.equal('skip' in f, false);
  assert.deepEqual(f.id, { stringValue: 'g-1' });
});

test('get: 値の往復・id の encodeURIComponent・404 は null', async () => {
  const stored = {};
  const { store, calls } = setup((url, init) => {
    if (init.method === 'PATCH') {
      stored.fields = JSON.parse(init.body).fields;
      return { status: 200, body: {} };
    }
    if (url.endsWith('/none')) return { status: 404, body: { error: {} } };
    return { status: 200, body: stored };
  });
  const doc = { a: 'x', n: -7, x: 0.25, b: false, nil: null, arr: [1, { k: 'v' }], empty: [], o: {} };
  await store.put('users', 'u 1', doc);
  const got = await store.get('users', 'u 1');
  assert.deepEqual(got, { ...doc, id: 'u 1' });
  assert.equal(calls[1].url, `${ROOT}/users/u%201`);
  assert.equal(await store.get('users', 'none'), null);
});

test('ID に / を含むものは拒否（通信しない）', async () => {
  const { store, calls } = setup(() => ({ status: 200, body: {} }));
  await assert.rejects(() => store.get('users', 'a/b'), /ID/);
  await assert.rejects(() => store.put('users', 'a/b', {}), /ID/);
  assert.equal(calls.length, 0);
});

test('events は put 拒否。append は POST で id と at をサーバー側で付ける', async () => {
  const { store, calls } = setup(() => ({ status: 200, body: {} }));
  await assert.rejects(() => store.put(C.events, 'e1', { type: 'leave' }), /追記のみ/);
  assert.equal(calls.length, 0);
  const e = await store.append(C.events, { type: 'leave', at: '1999-01-01T00:00:00Z' });
  assert.equal(e.at, '2026-11-06T01:00:00.000Z');
  assert.ok(e.id);
  const c = calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, `${ROOT}/events?documentId=${encodeURIComponent(e.id)}`);
  assert.deepEqual(c.body.fields.at, { stringValue: '2026-11-06T01:00:00.000Z' });
});

test('list: 条件なし・1 件・複数（AND）・結果は素のオブジェクト', async () => {
  const row = (id, userId) => ({
    document: { name: `x/${id}`, fields: { id: { stringValue: id }, userId: { stringValue: userId }, n: { integerValue: '2' } } },
  });
  const { store, calls } = setup(() => ({ status: 200, body: [row('a', 'u1'), { readTime: 't' }, row('b', 'u1')] }));
  const all = await store.list('goals');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `${ROOT}:runQuery`);
  assert.deepEqual(calls[0].body, { structuredQuery: { from: [{ collectionId: 'goals' }] } });
  assert.deepEqual(all, [
    { id: 'a', userId: 'u1', n: 2 },
    { id: 'b', userId: 'u1', n: 2 },
  ]);

  await store.list('goals', { userId: 'u1' });
  assert.deepEqual(calls[1].body.structuredQuery.where, {
    fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: 'u1' } },
  });

  await store.list('goals', { userId: 'u1', done: false });
  assert.deepEqual(calls[2].body.structuredQuery.where, {
    compositeFilter: {
      op: 'AND',
      filters: [
        { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: 'u1' } } },
        { fieldFilter: { field: { fieldPath: 'done' }, op: 'EQUAL', value: { booleanValue: false } } },
      ],
    },
  });
});

test('失敗: 500・401 は Error（状態だけ・中身とトークンを出さない）', async () => {
  for (const status of [500, 401, 403]) {
    const { store } = setup(() => ({ status, body: { error: { message: 'secret-doc tok-x' } } }));
    await assert.rejects(
      () => store.get('users', 'u1'),
      (err) => err.message === `Firestore HTTP ${status}` && !/tok-x|secret/.test(err.message),
    );
    await assert.rejects(() => store.list('users', { a: 1 }), new RegExp(`HTTP ${status}`));
  }
});

test('失敗: 通信エラーとタイムアウト（abort）は Error', async () => {
  const net = createFirestoreStore({
    projectId: 'proj-1',
    getToken: async () => 't',
    fetchImpl: async () => {
      throw new TypeError('boom tok-x');
    },
  });
  await assert.rejects(() => net.get('users', 'u1'), (e) => e.message === 'Firestore network error');

  const slow = createFirestoreStore({
    projectId: 'proj-1',
    getToken: async () => 't',
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        init.signal.dispatchEvent(new Event('abort')); // 10 秒待たず、中断の経路だけ確かめる
      }),
  });
  await assert.rejects(() => slow.get('users', 'u1'), (e) => e.message === 'Firestore timeout');
});

test('トークンが取れない時は Error', async () => {
  const st = createFirestoreStore({
    projectId: 'proj-1',
    getToken: async () => {
      throw new Error('meta');
    },
    fetchImpl: async () => assert.fail('呼ばれない'),
  });
  await assert.rejects(() => st.get('users', 'u1'), /auth failed/);
});
