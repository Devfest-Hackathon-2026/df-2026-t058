// 案の札に出す名前と、一覧の上に出す一言。空なら従来の A・B・C（番号）に戻す。

const LETTERS = ['A', 'B', 'C'];

export function candidateName(c: { label?: string | null }, i: number): string {
  const name = (c.label ?? '').trim();
  return name || (LETTERS[i] ?? String(i + 1));
}

export function candidateSummary(c: { summary?: string | null }): string {
  return (c.summary ?? '').trim();
}
