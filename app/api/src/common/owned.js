import { HttpError } from '../http.js';

// 本人の物だけを読む（認可）。無い・他人の物はどちらも 404（契約 §2・存在を漏らさない）。
export async function loadOwned(store, collection, id, userId, ownerField = 'userId') {
  const doc = await store.get(collection, id);
  if (!doc || doc[ownerField] !== userId) throw new HttpError(404, 'not_found', '見つかりません');
  return doc;
}
