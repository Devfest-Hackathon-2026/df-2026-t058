import { randomUUID } from 'node:crypto';

const APPEND_ONLY = new Set(['events']); // 契約 §4.2: 更新・削除しない

export function createMemoryStore({ now = () => new Date() } = {}) {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, new Map());
    return cols.get(name);
  };

  return {
    async get(collection, id) {
      const doc = col(collection).get(id);
      return doc ? structuredClone(doc) : null;
    },
    async put(collection, id, doc) {
      if (APPEND_ONLY.has(collection)) throw new Error(`${collection} は追記のみです（put 不可）`);
      const saved = { ...structuredClone(doc), id };
      col(collection).set(id, saved);
      return structuredClone(saved);
    },
    async append(collection, doc) {
      const id = randomUUID();
      // 時刻はサーバーが付ける物を正とする（呼び出し側の at は上書き）。
      const saved = { ...structuredClone(doc), id, at: now().toISOString() };
      col(collection).set(id, saved);
      return structuredClone(saved);
    },
    async list(collection, filter = {}) {
      const keys = Object.entries(filter);
      return [...col(collection).values()]
        .filter((d) => keys.every(([k, v]) => d[k] === v))
        .map((d) => structuredClone(d));
    },
  };
}
