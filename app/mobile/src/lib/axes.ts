// レーダーの軸の名前。案を作った時の応答にしか来ない（GET /api/goals/:id は軸を返さない）ので、
// 端末に覚えておき、それも無い時はこの既定の名前で描く。
// サーバーの app/api/src/roadmap/axes.js と同じ並び（11/9 本人が決めた 5 本）。

import type { Axis, Candidate } from '../api/types';

export const DEFAULT_AXES: Axis[] = [
  { key: 'amount', label: 'やる量' },
  { key: 'difficulty', label: '難しさ' },
  { key: 'approachability', label: '取り組みやすさ' },
  { key: 'growth', label: '成長性' },
  { key: 'steady', label: 'コツコツ度' },
];
// 11/9 より前に作った案の軸（作り直すまで残る）。名前だけ引けるようにする
const OLD_AXES: Axis[] = [
  { key: 'lightness', label: '負担の軽さ' },
  { key: 'foresight', label: '見通しの立てやすさ' },
  { key: 'ownership', label: '自力で決める余地' },
  { key: 'adjustability', label: '途中での直しやすさ' },
  { key: 'certainty', label: '確実さ' },
];

// 案が持っている軸の鍵から、名前つきの軸を作る。知らない鍵は鍵のまま出す。
export function axesForCandidates(cands: Candidate[]): Axis[] {
  const keys = cands[0] ? Object.keys(cands[0].axes) : [];
  if (keys.length === 0) return DEFAULT_AXES;
  return keys.map((key) => [...DEFAULT_AXES, ...OLD_AXES].find((a) => a.key === key) ?? { key, label: key });
}
