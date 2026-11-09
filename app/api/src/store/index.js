// データ保管の窓口（契約 §5.1）。各機能はここだけを使う。
//   get(collection, id)            -> doc | null
//   put(collection, id, doc)       -> doc            （events には使えない）
//   append(collection, doc)        -> { id, ...doc, at }   （events 用・追記のみ。at はサーバーが付ける）
//   list(collection, filter?)      -> doc[]          （filter は { field: value } の一致）
// 実装: memory.js（仮）／firestore（I-2）。
export { createMemoryStore } from './memory.js';
export { createFirestoreStore } from './firestore.js';
