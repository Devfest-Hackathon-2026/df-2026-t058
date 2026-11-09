// 建物の下の「今週」（#202）。モルティの吹き出しでなく普通のカード: 週のまとめの文（Gemini・2 文まで）、
// 文が無い週は出さない。数字はその下に 1 行だけ（サーバーが計算した物をそのまま）。
// 読み込みは画面（tower.tsx）が持ち、ここは見せるだけ（読み込み中は骨組み・失敗は小さく 1 行と「もう一度」）。

import { StyleSheet, Text, View } from 'react-native';
import type { PointsData, WeeklyResult, WeeklyStats } from '../api/types';
import {
  COPY_WEEKLY_FAILED,
  COPY_WEEKLY_FLOORS,
  COPY_WEEKLY_MINUTES,
  COPY_WEEKLY_STREAK,
} from '../lib/copy';
import { color, font, space } from '../theme';
import { ErrorBox, Skeleton } from './State';
import { Card } from './ui';
import { firstSentences } from '../lib/agentLines';

// 出す数字 3 つ（順も固定）
export function weeklyNumbers(stats: WeeklyStats): { label: string; value: string }[] {
  return [
    { label: COPY_WEEKLY_MINUTES, value: `${stats.focusMinutes} 分` },
    { label: COPY_WEEKLY_FLOORS, value: `${stats.floorsAdded} 階` },
    { label: COPY_WEEKLY_STREAK, value: `${stats.streak} 日` },
  ];
}

// 数字の 1 行（今週の分・階・考えポイント）。0 pt・無い時は pt を足さない
export function weeklyFactsLine(stats: WeeklyStats, points?: Pick<PointsData, 'week'> | null): string {
  const parts = [`今週 ${stats.focusMinutes} 分`, `${stats.floorsAdded} 階`];
  if (points && points.week > 0) parts.push(`${points.week} shell`);
  return parts.join('・');
}

export function WeeklyCard(props: {
  data: WeeklyResult | null;
  error: string | null;
  onRetry: () => void;
  points?: Pick<PointsData, 'week'> | null; // 今週の考えポイント（無い・0 なら出さない）
}) {
  const { data, error, onRetry } = props;
  if (!data && error) return <ErrorBox text={COPY_WEEKLY_FAILED} onRetry={onRetry} />;
  if (!data) {
    return (
      <View style={styles.loading} testID="weekly-loading">
        <Skeleton height={64} />
        <Skeleton width="60%" height={font.small} />
      </View>
    );
  }
  // 週のまとめの文（Gemini・2 文まで）があれば出す。無い週は数字の 1 行だけ
  const summary = data.summary ? firstSentences(data.summary, 2) : '';
  return (
    <Card testID="weekly-card" style={styles.card}>
      {summary ? (
        <Text style={styles.summary} testID="weekly-summary">
          {summary}
        </Text>
      ) : null}
      <Text style={styles.facts} testID="weekly-facts">
        {weeklyFactsLine(data.stats, props.points)}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  summary: { fontSize: font.body, fontWeight: '600', color: color.text },
  facts: { fontSize: font.small, fontWeight: '700', color: color.muted },
  loading: { gap: space.sm },
});
