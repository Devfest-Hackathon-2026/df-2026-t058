// 読み込み中（Skeleton）とエラー（ErrorBox）、友達のイニシャルの丸（Avatar）の共通部品。

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { useReduceMotion } from '../lib/useReduceMotion';
import { avatarColors, color, font, radius, space } from '../theme';
import { BigButton } from './ui';

// 名前から色を決める（同じ名前は同じ色）
export function avatarColorOf(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return avatarColors[h % avatarColors.length] ?? color.primary;
}

// 名前の最初の 1 文字（サロゲートペアも 1 字）。空なら「?」
export function initialOf(name: string): string {
  const t = name.trim();
  return t ? (Array.from(t)[0] ?? '?') : '?';
}

export function Skeleton(props: { width?: DimensionValue; height?: number; radius?: number; testID?: string }) {
  const { width = '100%', height = 16, radius: r = radius.box, testID } = props;
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);
  return (
    <Animated.View
      testID={testID ?? 'skeleton'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: r, backgroundColor: color.surfaceSunk, opacity: pulse }}
    />
  );
}

export function ErrorBox(props: { text: string | null; onRetry?: () => void }) {
  if (!props.text) return null;
  return (
    <View accessibilityRole="alert" style={styles.box} testID="error-box">
      <Text style={styles.text}>{props.text}</Text>
      {props.onRetry ? <BigButton label="もう一度" variant="plain" size="small" onPress={props.onRetry} testID="error-retry" /> : null}
    </View>
  );
}

export function Avatar(props: { name: string; active?: boolean }) {
  return (
    <View
      testID="avatar"
      style={[
        styles.avatar,
        { backgroundColor: avatarColorOf(props.name), borderColor: props.active ? color.primary : color.line },
      ]}
    >
      <Text style={styles.initial}>{initialOf(props.name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space.sm,
    padding: space.md,
    borderWidth: 2,
    borderColor: color.danger,
    borderRadius: radius.box,
    backgroundColor: color.dangerSoft,
  },
  text: { fontSize: font.body, fontWeight: '700', color: color.danger },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: font.body, fontWeight: '800', color: color.onPrimary },
});
