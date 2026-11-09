// ホームのカードの中の小さな横の道（#315・決定 11/9）。丸と線だけを 1 行に並べ、終わった丸は塗り、今日の丸は光らせ、
// 右端に期限の旗。名前は出さない。押すと、案の画面と同じ縦の道（名前と目印は全文）が下から開く。

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Checkpoint } from '../api/types';
import { COPY_CLOSE, COPY_ROAD_OPEN } from '../lib/copy';
import { tap } from '../lib/haptics';
import { color, font, radius, space, touch } from '../theme';
import { todayCheckpoint } from './CheckpointPath';
import { PlanRoad } from './PlanRoad';
import { TextLink } from './ui';

const DOT = 18;

export function MiniRoad(props: { checkpoints: Checkpoint[]; deadlineLabel: string | null; goalText: string; testID?: string }) {
  const { deadlineLabel, goalText, testID = 'mini-road' } = props;
  const cps = [...props.checkpoints].sort((a, b) => a.order - b.order);
  const today = todayCheckpoint(cps);
  const [open, setOpen] = useState(false);
  if (cps.length === 0) return null;
  const done = cps.filter((c) => c.state === 'done').length;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${COPY_ROAD_OPEN}（${cps.length} 個のうち ${done} 個終わった）`}
        onPress={() => {
          tap();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        testID={testID}
      >
        {cps.map((c, i) => {
          const isDone = c.state === 'done';
          const isToday = today?.id === c.id;
          return (
            <View key={c.id} style={i > 0 ? styles.cell : styles.first}>
              {i > 0 ? <View style={[styles.line, (isDone || isToday) && styles.lineOn]} /> : null}
              <View style={[styles.dot, isDone && styles.dotDone, isToday && styles.dotToday]} />
            </View>
          );
        })}
        <View style={styles.cell}>
          <View style={[styles.line, done === cps.length && styles.lineOn]} />
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color.primary} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
          </Svg>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.veil} onPress={() => setOpen(false)} accessibilityLabel={COPY_CLOSE} />
        <View style={styles.sheet} testID={`${testID}-sheet`}>
          <Text style={styles.goal}>{goalText}</Text>
          <ScrollView style={styles.scroll}>
            <PlanRoad
              steps={cps.map((c) => ({ title: c.title, doneMark: c.doneMark, done: c.state === 'done', today: today?.id === c.id }))}
              deadlineLabel={deadlineLabel}
              testID={`${testID}-road`}
            />
          </ScrollView>
          <View style={styles.center}>
            <TextLink label={COPY_CLOSE} onPress={() => setOpen(false)} testID={`${testID}-close`} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touch.min, marginTop: space.sm },
  first: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  line: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line, marginHorizontal: 2 },
  lineOn: { backgroundColor: color.primary },
  dot: { width: DOT, height: DOT, borderRadius: radius.full, borderWidth: 3, borderColor: color.edge, backgroundColor: color.surface },
  dotDone: { backgroundColor: color.primary, borderColor: color.primary },
  dotToday: { borderColor: color.primary, borderWidth: 4, width: DOT + 6, height: DOT + 6, backgroundColor: color.primarySoft },
  veil: { flex: 1 },
  sheet: {
    backgroundColor: color.bg,
    borderTopWidth: 2,
    borderColor: color.line,
    borderTopLeftRadius: radius.box,
    borderTopRightRadius: radius.box,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '80%',
  },
  scroll: { flexGrow: 0 },
  goal: { fontSize: font.large - 2, fontWeight: '800', color: color.text },
  center: { flexDirection: 'row', justifyContent: 'center' },
});
