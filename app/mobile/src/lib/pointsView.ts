// 考えポイントの表示の整形（純粋な関数）。減らさない・競わせない・急かさない（docs/points.md）。

import type { PointItem, PointsByGoal, PointsData } from '../api/types';

// 目標ごとの内訳の行（#351）。並びはサーバーのまま（最後に増えた順・多い順に並べ替えない）。pt 0 以下・壊れた行は出さない。
// 無い（古いサーバー）・0 件なら空＝内訳は出さない
export function goalRows(
  byGoal: PointsByGoal[] | null | undefined,
): { key: string; text: string; pt: string; archived: boolean }[] {
  return (Array.isArray(byGoal) ? byGoal : [])
    .filter((g) => g && typeof g.goalId === 'string' && Number.isFinite(g.pt) && g.pt > 0)
    .map((g) => ({ key: g.goalId, text: typeof g.text === 'string' ? g.text : '', pt: ptText(g.pt), archived: g.archived === true }));
}

// 「12 shell」（単位は shell・11/10 本人）。負・NaN・小数は 0 か切り捨て
export function ptText(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${v} shell`;
}

// 内訳 1 行（「30 分集中した　＋6 pt」）
export function itemLine(item: PointItem): string {
  return `${item.label}　＋${ptText(item.pt)}`;
}

// 一覧の行（pt 0 以下は出さない）
export function sheetRows(items: PointItem[] | null | undefined): { key: string; text: string }[] {
  return (items ?? [])
    .filter((x) => Number.isFinite(x.pt) && x.pt > 0)
    .map((x, i) => ({ key: `${x.at}-${x.kind}-${i}`, text: itemLine(x) }));
}

// ホームの帯: 今日が 0（無い・NaN 含む）なら出さない（null）
export function homeBandText(points: { today: number } | null | undefined): string | null {
  const t = points?.today;
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null;
  return `今日 ${ptText(t)}`;
}

export const POINTS_NOTE = '考えた分だけ増えます。モルティに聞いても減りません';

// 振り返りの結果: その集中で得た pt の内訳（0 の行は出さない）。floor.pt は集中＋振り返りの合計
export function reflectBreakdown(floor: { focusMin: number; achievement: number | null; pt?: number }): {
  total: string;
  lines: string[];
} {
  const focus = Math.min(12, Math.floor(Math.max(0, floor.focusMin) / 5));
  const done = floor.achievement ? ([0, 5, 10, 15][floor.achievement] ?? 0) : 0;
  const lines: string[] = [];
  if (focus > 0) lines.push(`集中 ${ptText(focus)}`);
  if (done > 0) lines.push(`達成 ${ptText(done)}`);
  const total = typeof floor.pt === 'number' ? floor.pt : focus + done;
  // 考えてから聞いた分＝合計から上の 2 つを引いた残り（サーバーが合計だけ返すため・0 なら出さない）
  const rest = total - focus - done;
  if (rest > 0) lines.splice(1, 0, `考えてから聞いた ${ptText(rest)}`);
  return { total: ptText(total), lines };
}

// 週のまとめの 1 行（事実だけ）
export function weeklyPointsLine(points: Pick<PointsData, 'week'> | null | undefined): string | null {
  const w = points?.week;
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return null;
  return `今週のシェル　${ptText(w)}`;
}
