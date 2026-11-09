// 共通の上の帯。見出し・左の戻る矢印・右の操作を、本文の列（560px）にそろえて置く。
// 流れの画面（Stack）とタブの画面の両方で使う。戻る矢印はこの 1 種類だけ。

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLUMN_WIDTH } from '../lib/navLayout';
import { color, font, space, touch } from '../theme';
import { ChevronRightIcon } from './Icons';

export function ColumnHeader(props: { title: string; onBack?: (() => void) | null; left?: ReactNode; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        {props.onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="戻る"
            hitSlop={12}
            onPress={props.onBack}
            testID="header-back"
            style={styles.side}
          >
            {/* 右向きの矢印を左右反転して使う（Icons.tsx に左向きが無いため） */}
            <View style={styles.flip}>
              <ChevronRightIcon color={color.primary} size={28} strokeWidth={2.75} />
            </View>
          </Pressable>
        ) : props.left ? (
          <View style={styles.side}>{props.left}</View>
        ) : null}
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {props.title}
        </Text>
        {props.right ? <View style={[styles.side, styles.right]}>{props.right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.bg, width: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min + space.sm,
    paddingHorizontal: space.lg,
    maxWidth: COLUMN_WIDTH,
    width: '100%',
    alignSelf: 'center',
  },
  side: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  right: { marginLeft: 'auto', alignItems: 'flex-end' },
  flip: { transform: [{ scaleX: -1 }], alignSelf: 'flex-start' },
  title: { flexShrink: 1, fontSize: font.large, fontWeight: '800', color: color.text },
});
