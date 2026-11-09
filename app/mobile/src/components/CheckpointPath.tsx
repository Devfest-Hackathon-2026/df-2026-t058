// ホームの道。チェックポイントを丸で 1 本の道に並べ、今日の分を光らせる。
// 丸どうしは太い道でつなぐ（終わった所までは主色、先は灰色）。

import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Checkpoint } from '../api/types';
import { tap } from '../lib/haptics';
import { NATIVE_DRIVER, useReduceMotion } from '../lib/useReduceMotion';
import { color, font, radius, space } from '../theme';

const NODE = 72;
const LIP = 6;
const ROW = 112;
const RING = NODE + 16;
const ROAD = 16;
const OFFSETS = [0, 48, 64, 48, 0, -48, -64, -48];

// 今日の分＝まだ終わっていない最初のチェックポイント。
export function todayCheckpoint(cps: Checkpoint[]): Checkpoint | null {
  return [...cps].sort((a, b) => a.order - b.order).find((c) => c.state !== 'done') ?? null;
}

const offsetAt = (i: number) => OFFSETS[i % OFFSETS.length] ?? 0;

function Glow() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1100, useNativeDriver: false }),
        Animated.timing(v, { toValue: 0, duration: 1100, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
        },
      ]}
    />
  );
}

// 前に見た時、丸が終わっていたか（アプリを開いている間だけ覚える）。
// 前は未完了で今は完了の丸だけを「今回新しく完了した」とみなす。初めて見る丸は動かさない
const lastDone = new Map<string, boolean>();
export function newlyDone(prev: ReadonlyMap<string, boolean>, cp: Pick<Checkpoint, 'id' | 'state'>): boolean {
  return cp.state === 'done' && prev.get(cp.id) === false;
}

// 今回新しく完了した丸: 空の丸が消えて塗りが見え、ポンと小さく大きくなって戻る（0.45 秒）
function FillPop(props: { pop: boolean; children: ReactNode }) {
  const { pop } = props;
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pop || reduce) return;
    v.setValue(0);
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.quad),
      useNativeDriver: NATIVE_DRIVER,
    });
    anim.start();
    return () => anim.stop();
  }, [pop, reduce, v]);
  const scale = v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1.15, 1] });
  const cover = v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0, 0] });
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {props.children}
      {pop ? <Animated.View pointerEvents="none" style={[styles.cover, { opacity: cover }]} /> : null}
    </Animated.View>
  );
}

// 丸の中心どうしを S 字でつなぐ道
function Road(props: { width: number; cps: Checkpoint[] }) {
  const { width, cps } = props;
  if (width <= 0 || cps.length < 2) return null;
  // 道の上下の余白（styles.path の paddingVertical）の分だけ下げる
  const at = (i: number) => ({ x: width / 2 + offsetAt(i), y: space.sm + i * ROW + ROW / 2 });
  return (
    <Svg width={width} height={cps.length * ROW + space.sm * 2} style={StyleSheet.absoluteFill} pointerEvents="none">
      {cps.slice(0, -1).map((cp, i) => {
        const a = at(i);
        const b = at(i + 1);
        const mid = (a.y + b.y) / 2;
        return (
          <Path
            key={cp.id}
            d={`M ${a.x} ${a.y} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}`}
            stroke={cp.state === 'done' ? color.primary : color.line}
            strokeWidth={ROAD}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
    </Svg>
  );
}

export function CheckpointPath(props: {
  checkpoints: Checkpoint[];
  selectedId: string | null;
  onSelect: (cp: Checkpoint) => void;
}) {
  const cps = [...props.checkpoints].sort((a, b) => a.order - b.order);
  const today = todayCheckpoint(cps);
  const [width, setWidth] = useState(0);
  const todayRef = useRef<ComponentRef<typeof View>>(null);
  const todayIndex = cps.findIndex((c) => c.id === today?.id);
  const todayId = today?.id;

  // 今回新しく完了した丸（一度決まったら、この道を出している間は保つ）
  const popped = useRef(new Set<string>()).current;
  for (const cp of cps) if (newlyDone(lastDone, cp)) popped.add(cp.id);
  useEffect(() => {
    for (const cp of cps) lastDone.set(cp.id, cp.state === 'done');
  });

  // 今日の丸が 6 個目以降なら、開いた時にそこへ寄せる（web のみ。native は丸が画面内に入りにくい場合の対応が別途要る）
  useEffect(() => {
    if (todayIndex < 5) return;
    const el = todayRef.current as unknown as { scrollIntoView?: (o: { block: string }) => void } | null;
    el?.scrollIntoView?.({ block: 'center' });
  }, [todayId, todayIndex]);

  return (
    <View style={styles.path} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Road width={width} cps={cps} />
      {cps.map((cp, i) => {
        const done = cp.state === 'done';
        const isToday = today?.id === cp.id;
        const selected = props.selectedId === cp.id;
        const lit = done || isToday;
        const partial = !done && (cp.achievement === 1 || cp.achievement === 2);
        const half = isToday ? color.onPrimary : color.primary;
        const labelLeft = offsetAt(i) >= 0;
        return (
          <View
            key={cp.id}
            ref={isToday ? todayRef : undefined}
            style={[styles.row, { transform: [{ translateX: offsetAt(i) }] }]}
          >
            {isToday ? <Glow /> : selected ? <View pointerEvents="none" style={[styles.ring, styles.ringStill]} /> : null}
            <FillPop pop={done && popped.has(cp.id)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${cp.order} ${cp.title}${done ? ' 完了' : ''}`}
              accessibilityState={{ selected }}
              onPress={() => {
                tap();
                props.onSelect(cp);
              }}
            >
              {({ pressed }) => (
                <View style={[styles.lip, { backgroundColor: lit ? color.primaryLip : color.edge }]}>
                  <View
                    style={[
                      styles.node,
                      {
                        backgroundColor: lit ? color.primary : color.surfaceSunk,
                        transform: [{ translateY: pressed ? LIP : 0 }],
                      },
                      // 途中までできた丸は、縁の上と左だけ主色にする
                      partial && {
                        borderWidth: 5,
                        borderColor: 'transparent',
                        borderTopColor: half,
                        borderLeftColor: half,
                      },
                    ]}
                  >
                    <Text style={[styles.nodeText, { color: lit ? color.onPrimary : color.muted }]}>
                      {done ? '✓' : String(cp.order)}
                    </Text>
                  </View>
                </View>
              )}
            </Pressable>
            </FillPop>
            <Text
              pointerEvents="none"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.label, labelLeft ? styles.labelLeft : styles.labelRight]}
            >
              {cp.title}
            </Text>
            {isToday ? (
              <View style={[styles.tag, labelLeft ? null : styles.tagLeft]} pointerEvents="none">
                <Text style={styles.tagText}>今日</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  path: { paddingVertical: space.sm },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    top: (ROW - RING) / 2,
    alignSelf: 'center',
    width: RING,
    height: RING,
    borderRadius: radius.full,
    borderWidth: 4,
    borderColor: color.primary,
    backgroundColor: color.bg,
  },
  ringStill: { borderColor: color.edge },
  // 塗りに変わる前の、空の丸（完了した瞬間だけ上に重ねて消す）
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: NODE,
    height: NODE,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunk,
  },
  lip: { width: NODE, height: NODE + LIP, borderRadius: radius.full },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeText: { fontSize: 28, fontWeight: '800' },
  tag: {
    position: 'absolute',
    left: '50%',
    marginLeft: RING / 2 + space.xs,
    backgroundColor: color.primary,
    borderRadius: radius.box,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  tagLeft: { left: undefined, marginLeft: 0, right: '50%', marginRight: RING / 2 + space.xs },
  label: { position: 'absolute', maxWidth: 112, fontSize: font.small, fontWeight: '700', color: color.text },
  labelLeft: { right: '50%', marginRight: RING / 2 + space.xs, textAlign: 'right' },
  labelRight: { left: '50%', marginLeft: RING / 2 + space.xs },
  tagText: { color: color.onPrimary, fontWeight: '800', fontSize: font.small },
});
