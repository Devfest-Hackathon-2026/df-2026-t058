// 考えポイントの小さなシート（ホームの帯の「今日 12 pt」を押すと出る）。累計・今週・内訳の一覧・注記 1 行。
// 他の人との比較や、目標までの残りは出さない。外を押すと閉じる。

import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { PointsData } from '../api/types';
import { COPY_POINTS_BY_GOAL, COPY_POINTS_TOTAL } from '../lib/copy';
import { goalRows, POINTS_NOTE, ptText, sheetRows } from '../lib/pointsView';
import { color, font, radius, space } from '../theme';

// 目標ごとの内訳（#351）。目標の文は 1 行に切り、右に「N pt」。やめた目標は薄く。序列を示す表示や棒グラフは付けない。
// 0 件（古いサーバー含む）なら何も出さない
export function GoalPointsList(props: { byGoal: PointsData['byGoal'] }) {
  const rows = goalRows(props.byGoal);
  if (rows.length === 0) return null;
  return (
    <View style={styles.goals} testID="points-by-goal">
      <Text style={styles.goalsHead}>{COPY_POINTS_BY_GOAL}</Text>
      {rows.map((r) => (
        <View key={r.key} style={styles.goalRow} testID="points-goal-row">
          <Text style={[styles.goalText, r.archived && styles.archived]} numberOfLines={1}>
            {r.text}
          </Text>
          <Text style={[styles.goalPt, r.archived && styles.archived]}>{r.pt}</Text>
        </View>
      ))}
    </View>
  );
}

// 建物タブの考えポイント（総得点＋目標ごとの内訳・#351）。読み込めない時は出さない
export function TowerPoints(props: { data: PointsData | null }) {
  const { data } = props;
  if (!data) return null;
  return (
    <View style={styles.tower} testID="tower-points">
      <View style={styles.goalRow}>
        <Text style={styles.week}>{COPY_POINTS_TOTAL}</Text>
        <Text style={styles.total} testID="tower-points-total">{ptText(data.total)}</Text>
      </View>
      <GoalPointsList byGoal={data.byGoal} />
    </View>
  );
}

// 見せるだけの部分（試験しやすいように分ける）
export function PointsSheetBody(props: { data: PointsData | null }) {
  const { data } = props;
  const rows = sheetRows(data?.items);
  return (
    <View style={styles.sheet} testID="points-sheet">
      <Text style={styles.total} testID="points-total">{`累計 ${ptText(data?.total)}`}</Text>
      <Text style={styles.week} testID="points-week">{`今週 ${ptText(data?.week)}`}</Text>
      <GoalPointsList byGoal={data?.byGoal} />
      <ScrollView style={styles.list}>
        {rows.map((r) => (
          <Text key={r.key} style={styles.row}>{r.text}</Text>
        ))}
      </ScrollView>
      <Text style={styles.note} testID="points-note">{POINTS_NOTE}</Text>
    </View>
  );
}

export function PointsSheet(props: { visible: boolean; onClose: () => void }) {
  const [data, setData] = useState<PointsData | null>(null);
  useEffect(() => {
    if (!props.visible) return;
    void api.points().then(setData, () => setData(null));
  }, [props.visible]);
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} accessibilityRole="button" onPress={props.onClose}>
        <PointsSheetBody data={data} />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.surface,
    borderTopWidth: 2,
    borderColor: color.line,
    borderTopLeftRadius: radius.box,
    borderTopRightRadius: radius.box,
    padding: space.lg,
    gap: space.sm,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  total: { fontSize: font.large, fontWeight: '900', color: color.primary },
  week: { fontSize: font.body, fontWeight: '800', color: color.text },
  list: { maxHeight: 240 },
  row: { fontSize: font.body, fontWeight: '600', color: color.text, paddingVertical: space.xs },
  note: { fontSize: font.small, fontWeight: '600', color: color.muted },
  tower: { gap: space.xs },
  goals: { gap: space.xs },
  goalsHead: { fontSize: font.small, fontWeight: '800', color: color.muted },
  goalRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  goalText: { flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '600', color: color.text },
  goalPt: { fontSize: font.body, fontWeight: '800', color: color.text },
  archived: { color: color.muted },
});
