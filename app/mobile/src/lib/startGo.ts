// 始める（#315）: 今日の一行を決める。聞かずに、前の振り返りで決めた次の一歩があればそれ、無ければチェックポイントの名前（200 字まで）
export function goLine(next: string | null, title: string | null | undefined): string {
  return Array.from((next ?? '').trim() || (title ?? '').trim())
    .slice(0, 200)
    .join('');
}
