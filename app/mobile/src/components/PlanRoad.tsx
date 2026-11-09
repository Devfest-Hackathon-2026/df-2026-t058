// 案の道（道を決める画面・#315）。ホームの道と同じ太い道と丸で、チェックポイントを縦に並べる。
// 名前と「終わったと分かる目印」は丸の右に全文で出す（切らない）。各チェックポイントに日付は付けない（決定 11/9）。
// 道の終わりに期限の旗を 1 本だけ置く。

import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color, font, radius, space } from '../theme';

const NODE = 40;
const LIP = 4;
const ROAD = 10;

export type RoadStep = { title: string; doneMark: string; done?: boolean; today?: boolean };

export function PlanRoad(props: { steps: RoadStep[]; deadlineLabel: string | null; tint?: string; testID?: string }) {
  const { steps, deadlineLabel, tint = color.primary, testID = 'plan-road' } = props;
  return (
    <View style={styles.root} testID={testID}>
      {steps.map((s, i) => (
        <View key={`${i}:${s.title}`} style={styles.row}>
          <View style={styles.rail}>
            {/* 丸の下に次の丸までの道（最後の丸からは旗まで） */}
            <View style={[styles.road, { backgroundColor: s.done ? tint : color.line }]} />
            <View style={[styles.lip, { backgroundColor: s.done || s.today ? color.primaryLip : color.edge }]}>
              <View style={[styles.node, { borderColor: tint }, (s.done || s.today) && { backgroundColor: tint }]}>
                <Text style={[styles.nodeText, (s.done || s.today) && { color: color.onPrimary }]}>{s.done ? '✓' : String(i + 1)}</Text>
              </View>
            </View>
          </View>
          <View style={styles.text}>
            <Text style={styles.title}>
              {s.title}
              {s.today ? <Text style={styles.today}>{'　今日'}</Text> : null}
            </Text>
            {s.doneMark ? <Text style={styles.mark}>{s.doneMark}</Text> : null}
          </View>
        </View>
      ))}
      <View style={[styles.row, styles.last]} testID={`${testID}-flag`}>
        <View style={styles.rail}>
          <View style={[styles.flagNode, { backgroundColor: tint }]}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color.onPrimary} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
            </Svg>
          </View>
        </View>
        <View style={[styles.text, styles.flagText]}>
          <Text style={styles.title}>{deadlineLabel ? `${deadlineLabel} 期限` : '期限'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingVertical: space.xs },
  row: { flexDirection: 'row', gap: space.md, minHeight: NODE + LIP + space.lg },
  last: { minHeight: NODE },
  rail: { width: NODE, alignItems: 'center' },
  road: { position: 'absolute', top: NODE / 2, bottom: -NODE / 2, width: ROAD, borderRadius: ROAD / 2 },
  lip: { width: NODE, height: NODE + LIP, borderRadius: radius.full },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: radius.full,
    borderWidth: 3,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeText: { fontSize: font.body, fontWeight: '800', color: color.text },
  flagNode: { width: NODE, height: NODE, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2, paddingTop: space.xs, paddingBottom: space.md },
  flagText: { justifyContent: 'center', paddingTop: 0, paddingBottom: 0 },
  title: { fontSize: font.body, fontWeight: '800', color: color.text, ...({ wordBreak: 'auto-phrase' } as object) },
  today: { fontSize: font.small, fontWeight: '800', color: color.primary },
  mark: { fontSize: font.small, color: color.muted, ...({ wordBreak: 'auto-phrase' } as object) },
});
