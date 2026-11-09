// 「直した割合」の表示用の概算（0〜1）。正しい値はサーバーが出す（Roadmap.editRatio）。
// 規則はサーバー（app/api/src/roadmap/edit-ratio.js）と同じ: 全項目が同じチェックポイント同士を
// 順序を保って最大限に対応づけ（最長共通部分列）、残りを「変更・追加・削除」として数える。

import type { CheckpointInput } from '../api/types';

const norm = (c: CheckpointInput) =>
  `${String(c.title).trim()}\u0000${String(c.doneMark).trim()}\u0000${Number(c.estimateMin)}`;

function lcsLength(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, cur[j - 1] ?? 0);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

export function editRatio(original: CheckpointInput[], edited: CheckpointInput[]): number {
  const a = original.map(norm);
  const b = edited.map(norm);
  const same = lcsLength(a, b);
  const changed = Math.max(a.length - same, b.length - same);
  const total = same + changed;
  if (total === 0) return 0;
  return Math.round((changed / total) * 1000) / 1000;
}

// 画面の「直した割合 30%」用。
export const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
