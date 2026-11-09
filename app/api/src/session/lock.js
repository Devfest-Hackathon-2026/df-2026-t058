// 同じキー（ユーザー）の更新を 1 つずつ順に走らせる。確認→書き込みの間に別の要求が割り込むのを防ぐ
// （例: 集中を始める要求の同時 2 本で、進行中が 2 つできる）。1 台のサーバー内だけの保証。
// 複数台（Cloud Run の最大は 1 台にしてある。上げるなら）保管側のトランザクションが要る（Firestore 版＝I-2）。
const tails = new Map();

export function withLock(key, fn) {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  tails.set(key, tail);
  tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
