// 集中の画面で、友達が始めたことだけを短く知らせる（11/9 本人）。終えた・やめたことは知らせない。
// feed（友達の開始の一覧）から、この集中を始めた後に始めた分で、まだ知らせていない物を選ぶ。

import type { FeedItem } from '../api/types';

export const FRIEND_POLL_MS = 45_000; // 友達の開始を見に行く間隔
export const FRIEND_TOAST_MS = 3_000; // 知らせを出しておく長さ

export const startKey = (x: FeedItem) => `${x.userId}@${x.at}`;

// since より後に始めた物で、shown に無い物（古い順）
export function newStarts(items: FeedItem[], since: string, shown: ReadonlySet<string>): FeedItem[] {
  const t = Date.parse(since);
  return items
    .filter((x) => Date.parse(x.at) > t && !shown.has(startKey(x)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
