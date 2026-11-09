import { randomUUID } from 'node:crypto';
import { createTokenProvider } from '../gemini/vertex.js';

// store の Firestore 版（REST を fetch で呼ぶ・依存パッケージなし）。窓口の約束は store/index.js と同じ。
// 出典（2026-11-06 に確認）:
//   documents.get/patch/createDocument: https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents
//   runQuery / StructuredQuery:         https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery
//   Value の型:                          https://firebase.google.com/docs/firestore/reference/rest/v1/Value
// 失敗の文言は HTTP の状態だけ（文書の中身・トークンは出さない）。

const BASE = 'https://firestore.googleapis.com/v1';
const TIMEOUT_MS = 10_000;
const APPEND_ONLY = new Set(['events']); // 契約 §4.2
const COLLECTION_RE = /^[a-z][a-z0-9_]*$/;
const SIMPLE_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---- 値の変換 ---------------------------------------------------------------
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('保存できない数です');
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { stringValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`保存できない型です: ${typeof v}`);
}

export function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toValue(v); // undefined は書かない
  }
  return fields;
}

export function fromValue(val) {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue?.values ?? []).map(fromValue);
  if ('mapValue' in val) return fromFields(val.mapValue?.fields);
  return null; // nullValue など
}

export function fromFields(fields) {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
}

const fieldPath = (k) => (SIMPLE_FIELD_RE.test(k) ? k : `\`${k.replace(/[\\`]/g, '\\$&')}\``);

// ---- 本体 -------------------------------------------------------------------
export function createFirestoreStore({
  projectId,
  databaseId = '(default)',
  fetchImpl = fetch,
  getToken = createTokenProvider({ fetchImpl }),
  now = () => new Date(),
} = {}) {
  if (typeof projectId !== 'string' || !/^[a-z0-9][a-z0-9:.-]*$/.test(projectId)) {
    throw new Error('projectId が正しくありません');
  }
  const root = `${BASE}/projects/${projectId}/databases/${encodeURIComponent(databaseId)}/documents`;

  const colName = (collection) => {
    if (typeof collection !== 'string' || !COLLECTION_RE.test(collection)) throw new Error('collection の名前が正しくありません');
    return collection;
  };
  const docId = (id) => {
    if (typeof id !== 'string' || id === '' || id.includes('/') || id === '.' || id === '..') {
      throw new Error('ドキュメント ID が正しくありません');
    }
    return encodeURIComponent(id);
  };

  async function call(method, url, body) {
    let token;
    try {
      token = await getToken();
    } catch {
      throw new Error('Firestore auth failed');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: ctrl.signal,
      });
      if (res.status === 404) return { notFound: true };
      if (!res.ok) throw new Error(`Firestore HTTP ${res.status}`);
      return { json: await res.json() };
    } catch (err) {
      if (/^Firestore /.test(err?.message ?? '')) throw err;
      throw new Error(err?.name === 'AbortError' ? 'Firestore timeout' : 'Firestore network error');
    } finally {
      clearTimeout(timer);
    }
  }

  const readDoc = (d) => fromFields(d?.fields);

  return {
    async get(collection, id) {
      const r = await call('GET', `${root}/${colName(collection)}/${docId(id)}`);
      return r.notFound ? null : { ...readDoc(r.json), id };
    },
    async put(collection, id, doc) {
      if (APPEND_ONLY.has(collection)) throw new Error(`${collection} は追記のみです（put 不可）`);
      const saved = { ...doc, id };
      const r = await call('PATCH', `${root}/${colName(collection)}/${docId(id)}`, { fields: toFields(saved) });
      if (r.notFound) throw new Error('Firestore HTTP 404');
      return structuredClone(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
    },
    async append(collection, doc) {
      const id = randomUUID();
      // 時刻はサーバーが付ける物を正とする（呼び出し側の at は上書き）。同じ ID があれば 409 で失敗＝上書きしない。
      const saved = { ...doc, id, at: now().toISOString() };
      const url = `${root}/${colName(collection)}?documentId=${encodeURIComponent(id)}`;
      const r = await call('POST', url, { fields: toFields(saved) });
      if (r.notFound) throw new Error('Firestore HTTP 404');
      return structuredClone(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
    },
    async list(collection, filter = {}) {
      const entries = Object.entries(filter);
      const filters = entries.map(([k, v]) => ({
        fieldFilter: { field: { fieldPath: fieldPath(k) }, op: 'EQUAL', value: toValue(v) },
      }));
      const structuredQuery = { from: [{ collectionId: colName(collection) }] };
      if (filters.length === 1) structuredQuery.where = filters[0];
      else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
      const r = await call('POST', `${root}:runQuery`, { structuredQuery });
      if (r.notFound) throw new Error('Firestore HTTP 404');
      if (!Array.isArray(r.json)) return [];
      return r.json.filter((row) => row?.document).map((row) => readDoc(row.document));
    },
  };
}
