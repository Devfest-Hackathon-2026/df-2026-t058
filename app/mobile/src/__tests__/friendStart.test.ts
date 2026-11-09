// 集中の画面の「友達が始めた」知らせ（11/9）
import { newStarts, startKey } from '../lib/friendStart';

const item = (userId: string, at: string) => ({ userId, displayName: userId, oneLine: '', at });

test('この集中より後に始めた物だけ・まだ知らせていない物だけ・古い順', () => {
  const since = '2026-11-09T10:00:00.000Z';
  const a = item('a', '2026-11-09T09:59:00.000Z');
  const b = item('b', '2026-11-09T10:05:00.000Z');
  const c = item('c', '2026-11-09T10:02:00.000Z');
  expect(newStarts([a, b, c], since, new Set()).map((x) => x.userId)).toEqual(['c', 'b']);
  expect(newStarts([a, b, c], since, new Set([startKey(c)])).map((x) => x.userId)).toEqual(['b']);
});
