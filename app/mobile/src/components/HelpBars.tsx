// AI の手助けの棒。ヒント・やり方の 2 本。文字は出さない。色は theme の値だけ。

import { StyleSheet, Text, View } from 'react-native';
import { barFill, HELP_BAR_FULL_MEDIUM, HELP_BAR_FULL_SMALL, miniLit } from '../lib/helpBar';
import { COPY_AI_HELP, COPY_HELP_MEDIUM, COPY_HELP_SMALL } from '../lib/copy';
import { BAR_MARK } from '../lib/tutorExamples';
import { color, font, radius, space } from '../theme';

const SMALL = color.primary;
const MEDIUM = color.series[1];

function Bar(props: { fill: number; tint: string; width: number; height: number; testID?: string }) {
  return (
    <View
      testID={props.testID}
      style={[styles.track, { width: props.width, height: props.height }]}
    >
      <View style={{ width: `${Math.round(props.fill * 100)}%`, height: '100%', backgroundColor: props.tint }} />
    </View>
  );
}

// 棒は長さだけなので、回数を文字でも言う（読み上げ用）
export const helpBarLabel = (small: number, medium: number) => `${COPY_AI_HELP} ${COPY_HELP_SMALL} ${small} ${COPY_HELP_MEDIUM} ${medium}`;

// 上の大きい棒（手助けの回数）
export function HelpBars(props: { small: number; medium: number }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={helpBarLabel(props.small, props.medium)}>
      <Text style={styles.mark}>{BAR_MARK.small}</Text>
      <Bar fill={barFill(props.small, HELP_BAR_FULL_SMALL)} tint={SMALL} width={72} height={space.md} testID="help-small" />
      <Text style={styles.mark}>{BAR_MARK.medium}</Text>
      <Bar fill={barFill(props.medium, HELP_BAR_FULL_MEDIUM)} tint={MEDIUM} width={72} height={space.md} testID="help-medium" />
    </View>
  );
}

// 返事の横の小さい棒
export function HelpMini(props: { level: 'none' | 'small' | 'medium' }) {
  if (props.level === 'none') return null;
  const lit = miniLit(props.level);
  return (
    <View style={styles.mini} accessible accessibilityLabel={`${COPY_AI_HELP} ${props.level === 'small' ? COPY_HELP_SMALL : COPY_HELP_MEDIUM}`}>
      <Bar fill={lit.small ? 1 : 0} tint={SMALL} width={space.xl} height={space.xs} />
      <Bar fill={lit.medium ? 1 : 0} tint={MEDIUM} width={space.xl} height={space.xs} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mark: { fontSize: font.small, fontWeight: '900', color: color.text },
  mini: { gap: space.xs, paddingBottom: space.xs },
  track: { backgroundColor: color.surfaceSunk, borderRadius: radius.full, overflow: 'hidden' },
});
