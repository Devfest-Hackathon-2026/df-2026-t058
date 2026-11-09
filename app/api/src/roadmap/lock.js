// 同じキーの処理を 1 つずつ行う（このプロセス内だけ）。
// 「確認してから書く」の間に別の要求が割り込んで、二重に確定・二重に Gemini を呼ぶのを防ぐ。
const tails = new Map();

export async function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
