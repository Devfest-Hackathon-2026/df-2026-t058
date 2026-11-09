// 使い方の流れ（ホームが空の時・進め方がまだの時）。説明の文章は置かず、順番と今いる所だけを見せる。
// 終わった所は ✓、今の所は主色で大きく（ボタンつき）、先は灰色。

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space } from '../theme';

export const FLOW_STEPS = ['目標を書く', '案から選ぶ', '始める', '集中する', '振り返る'] as const;

const DOT = 36;

export function FlowSteps(props: {
  current: number; // 1 始まり。今の段
  action?: ReactNode; // 今の段の下に置くボタン
  goalText?: string; // 1 段目が済んだ時に、書いた目標を 1 行で見せる
}) {
  const { current, action, goalText } = props;
  return (
    <View accessibilityLabel={`全${FLOW_STEPS.length}段のうち ${current} 段目`}>
      {FLOW_STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const now = n === current;
        const last = n === FLOW_STEPS.length;
        return (
          <View key={label} style={styles.row}>
            <View style={[styles.rail, now && action ? styles.railWithAction : null]}>
              <View style={[styles.dot, done && styles.dotDone, now && styles.dotNow]}>
                <Text style={[styles.dotText, (done || now) && { color: color.onPrimary }]}>{done ? '✓' : String(n)}</Text>
              </View>
              {last ? null : <View style={[styles.line, done && { backgroundColor: color.primary }]} />}
            </View>
            <View style={styles.body}>
              {/* 今の段にボタンがある時は、ボタンがその段の名前を兼ねる（同じ言葉を 2 度出さない） */}
              {now && action ? (
                action
              ) : (
                <Text style={[styles.label, now && styles.labelNow, !done && !now && styles.labelLater]}>{label}</Text>
              )}
              {done && n === 1 && goalText ? (
                <Text style={styles.sub} numberOfLines={2}>
                  {goalText}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: DOT },
  railWithAction: { paddingTop: 12 }, // ボタン（高さ 60）の真ん中に丸を合わせる
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunk,
    borderWidth: 2,
    borderColor: color.edge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: color.primary, borderColor: color.primary },
  dotNow: { backgroundColor: color.primary, borderColor: color.primaryLip },
  dotText: { fontSize: font.body, fontWeight: '800', color: color.muted },
  line: { flex: 1, width: 4, minHeight: space.lg, backgroundColor: color.line, marginVertical: space.xs, borderRadius: radius.full },
  body: { flex: 1, paddingBottom: space.lg, gap: space.xs },
  label: { fontSize: font.large, fontWeight: '700', color: color.text, minHeight: DOT, textAlignVertical: 'center', lineHeight: DOT },
  labelNow: { fontWeight: '900' },
  labelLater: { color: color.muted },
  sub: { fontSize: font.body, color: color.muted, fontWeight: '600' },
});
