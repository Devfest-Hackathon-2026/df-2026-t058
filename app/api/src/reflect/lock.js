// 同じセッションのふりかえりを 1 つずつ処理する（二重に Gemini を呼ぶ・二重に確定するのを防ぐ。1 プロセス内）。
const tails = new Map();

export function exclusive(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
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
