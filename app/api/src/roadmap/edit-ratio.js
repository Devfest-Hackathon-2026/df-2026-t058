// 「直した割合」（0〜1）。AI の案をどれだけ自分で変えたか＝「自分で決めた度」の材料（P4）。
// 純粋関数。サーバーが元の案と送られた物を比べて出す（本人の申告ではない）。
//
// 規則: チェックポイントを（title, doneMark, estimateMin）がすべて同じ物同士で、順序を保ったまま
// 最大限に対応づける（最長共通部分列 L）。対応づかなかった分が「変更・追加・削除」。
//   unchanged = L, 元の残り r = n元 - L, 新の残り e = n新 - L
//   変更の単位数 = max(r, e)（残り同士を 1 対 1 で「変更」とし、余りは追加／削除）
//   割合 = 変更の単位数 / (unchanged + 変更の単位数)
// 例: そのまま 0／全部書き換え 1／5 個中 1 個だけ直した 0.2／並べ替えだけ 1 個動かしたら 1/n。
const norm = (c) => `${String(c.title).trim()}\u0000${String(c.doneMark).trim()}\u0000${Number(c.estimateMin)}`;

function lcsLength(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function editRatio(original, edited) {
  const a = original.map(norm);
  const b = edited.map(norm);
  const same = lcsLength(a, b);
  const changed = Math.max(a.length - same, b.length - same);
  const total = same + changed;
  if (total === 0) return 0;
  return Math.round((changed / total) * 1000) / 1000;
}
