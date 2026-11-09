// 「選んだ理由」を、選んだ札と自由記述から 1 本の文字列にする（サーバーの why は 1〜300 字の文字列 1 本のまま）。

export const WHY_MAX = 300;
const JOIN = '／';

// 札が 1 つ以上ある、または自由記述が空白だけでない（どちらかあれば決められる）
export const whyReady = (tags: readonly string[], text: string): boolean => tags.length > 0 || text.trim().length > 0;

// 札を「／」でつなぎ、自由記述があれば改行して後ろに足す。300 字を超える時は自由記述を先に切る
export function composeWhy(tags: readonly string[], text: string): string {
  const head = tags.join(JOIN);
  const body = text.trim();
  if (!body) return head;
  if (!head) return body.slice(0, WHY_MAX).trim();
  const room = WHY_MAX - head.length - 1;
  if (room <= 0) return head;
  const cut = body.slice(0, room).trim();
  return cut ? `${head}\n${cut}` : head;
}

// 札の選び直し（選んでいれば外す・無ければ足す。並びは札の定義順に保つ）
export function toggleTag(all: readonly string[], picked: readonly string[], tag: string): string[] {
  const on = picked.includes(tag) ? picked.filter((t) => t !== tag) : [...picked, tag];
  return all.filter((t) => on.includes(t));
}
