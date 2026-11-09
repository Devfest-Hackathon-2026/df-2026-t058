// 場面の上の帯（#315）: 一周（今日 → 集中 → 振り返り）のどこにいるかの線と、場面の名前の札。右に 1 つだけ置ける。
// どの場面も同じ位置・同じ形にして、札の名前と地の色で場面の違いを見せる。
// 準備のフロー（目標を足す → 道を決める）も同じ作りで、線は 2 本（決定 11/9・本人「B で」）。

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COPY_SCENE_ADD, COPY_SCENE_FOCUS, COPY_SCENE_HOME, COPY_SCENE_PLAN, COPY_SCENE_REFLECT } from '../lib/copy';
import { color, font, radius, space } from '../theme';

export type Scene = 'home' | 'focus' | 'reflect';
export const SCENES: readonly Scene[] = ['home', 'focus', 'reflect'];
export type PrepScene = 'add' | 'plan';
export const PREP_SCENES: readonly PrepScene[] = ['add', 'plan'];
export const SCENE_NAME: Record<Scene | PrepScene, string> = {
  home: COPY_SCENE_HOME,
  focus: COPY_SCENE_FOCUS,
  reflect: COPY_SCENE_REFLECT,
  add: COPY_SCENE_ADD,
  plan: COPY_SCENE_PLAN,
};

// 場面がどちらの流れの何番目か（一周は 3 本・準備は 2 本）
export function sceneBars(scene: Scene | PrepScene): { list: readonly string[]; at: number } {
  const prep = (PREP_SCENES as readonly string[]).indexOf(scene);
  if (prep >= 0) return { list: PREP_SCENES, at: prep };
  return { list: SCENES, at: SCENES.indexOf(scene as Scene) };
}

export function SceneTop(props: { scene: Scene | PrepScene; right?: ReactNode }) {
  const { list, at } = sceneBars(props.scene);
  const SCENES_ = list;
  return (
    <View style={styles.row} testID={`scene-top-${props.scene}`}>
      <View style={styles.bars} accessible accessibilityLabel={`${at + 1} / ${SCENES_.length}`}>
        {SCENES_.map((s, i) => (
          <View key={s} style={[styles.bar, i <= at && styles.barOn]} />
        ))}
      </View>
      <Text accessibilityRole="header" style={styles.tag}>
        {SCENE_NAME[props.scene]}
      </Text>
      <View style={styles.grow} />
      {props.right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  bars: { flexDirection: 'row', gap: space.xs },
  bar: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.line },
  barOn: { backgroundColor: color.primary },
  tag: {
    fontSize: font.small,
    fontWeight: '800',
    color: color.primaryLip,
    backgroundColor: color.primarySoft,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  grow: { flex: 1 },
});
