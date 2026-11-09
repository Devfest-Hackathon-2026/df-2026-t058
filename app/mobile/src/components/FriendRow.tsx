// ホームの一番上の友達の列（11/9 本人・インスタのホームの上の列を参考）。
// 丸の中に、その人が今日積んだ階だけを、その数だけ立体（建物タブと同じ斜め上から見た箱・金銀銅）で積む。
// 取り組み中の人は、今積んでいる途中の階を破線の枠で灯らせ、輪に色と「取り組み中」の札。
// 前に見ていない階（このアプリを開いている間に初めて見た階）は、上から落ちてきて積まれる。
// 中身（何に取り組んだか）・数字・順位は出さない。押しても何も開かない。

import { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import type { HomeFriend, TodayFloor } from '../api/types';
import { COPY_FRIEND_ACTIVE_TAG } from '../lib/copy';
import { NATIVE_DRIVER, useReduceMotion } from '../lib/useReduceMotion';
import { color, floorColor, font, radius, space, towerArt } from '../theme';

const RING = 60;
const ART = 52;
const W = 15; // 上面の半分の幅
const H = 7.5; // 上面の半分の高さ
const F = 9; // 1 階の厚み
const TOP = { gold: towerArt.topGold, silver: towerArt.topSilver, bronze: towerArt.topBronze } as const;

// このアプリを開いている間に、もう見た階（落ちてくる動きは 1 回だけ）
const seen = new Set<string>();
export function unseenFloors(today: TodayFloor[], known: ReadonlySet<string> = seen): Set<string> {
  return new Set(today.filter((f) => !known.has(f.id)).map((f) => f.id));
}

// i 階目（0＝いちばん下）の 3 面の形。n＝積む数（取り組み中の途中の階を含む）。真ん中に収める
export function blockPaths(i: number, n: number): { left: string; right: string; top: string; outline: string } {
  const cx = ART / 2;
  const base = ART / 2 + (n * F + H * 2) / 2 - H - F;
  const y = base - i * F;
  return {
    left: `M${cx - W} ${y} L${cx} ${y + H} L${cx} ${y + H + F} L${cx - W} ${y + F}Z`,
    right: `M${cx} ${y + H} L${cx + W} ${y} L${cx + W} ${y + F} L${cx} ${y + H + F}Z`,
    top: `M${cx - W} ${y} L${cx} ${y - H} L${cx + W} ${y} L${cx} ${y + H}Z`,
    outline: `M${cx - W} ${y} L${cx} ${y - H} L${cx + W} ${y} L${cx + W} ${y + F} L${cx} ${y + H + F} L${cx - W} ${y + F}Z M${cx - W} ${y} L${cx} ${y + H} L${cx + W} ${y} M${cx} ${y + H} L${cx} ${y + H + F}`,
  };
}

function Floors(props: { today: TodayFloor[]; active: boolean; fresh: Set<string> }) {
  const { today, active, fresh } = props;
  const n = today.length + (active ? 1 : 0);
  return (
    <Svg width={ART} height={ART} viewBox={`0 0 ${ART} ${ART}`}>
      {today.map((f, i) => {
        const p = blockPaths(i, n);
        const c = floorColor[f.color];
        return (
          <G key={f.id} opacity={fresh.has(f.id) ? 0 : 1}>
            <Path d={p.left} fill={c.fill} />
            <Path d={p.right} fill={c.lip} />
            <Path d={p.top} fill={TOP[f.color]} />
          </G>
        );
      })}
    </Svg>
  );
}

// 取り組み中の人の、今積んでいる途中の階（破線の枠・ゆっくり明るくなったり戻ったりする）
function Ghost(props: { today: TodayFloor[] }) {
  const glow = useGlow(true);
  const n = props.today.length + 1;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: glow }]}>
      <Svg width={ART} height={ART} viewBox={`0 0 ${ART} ${ART}`}>
        <Path d={blockPaths(props.today.length, n).outline} fill={color.primarySoft} stroke={color.primary} strokeWidth={1.2} strokeDasharray="2 2" />
      </Svg>
    </Animated.View>
  );
}

// 新しく積まれた階: 上から落ちてきて止まる（動きを減らす設定では、はじめから置く）
function DropIn(props: { today: TodayFloor[]; active: boolean; fresh: Set<string>; delay: number }) {
  const { today, active, fresh, delay } = props;
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce || fresh.size === 0 ? 1 : 0)).current;
  useEffect(() => {
    if (reduce || fresh.size === 0) return;
    const a = Animated.spring(v, { toValue: 1, delay, useNativeDriver: NATIVE_DRIVER, friction: 6 });
    a.start();
    return () => a.stop();
  }, [reduce, fresh.size, delay, v]);
  if (fresh.size === 0) return null;
  const n = today.length + (active ? 1 : 0);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] },
      ]}
    >
      <Svg width={ART} height={ART} viewBox={`0 0 ${ART} ${ART}`}>
        {today.map((f, i) => {
          if (!fresh.has(f.id)) return null;
          const p = blockPaths(i, n);
          const c = floorColor[f.color];
          return (
            <G key={f.id}>
              <Path d={p.left} fill={c.fill} />
              <Path d={p.right} fill={c.lip} />
              <Path d={p.top} fill={TOP[f.color]} />
            </G>
          );
        })}
      </Svg>
    </Animated.View>
  );
}

// 取り組み中の途中の階: ゆっくり明るくなったり戻ったりする
function useGlow(on: boolean) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on || reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.45, duration: 800, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, reduce, v]);
  return v;
}

function Friend(props: { f: HomeFriend; index: number }) {
  const { f, index } = props;
  const fresh = useRef(unseenFloors(f.today)).current;
  useEffect(() => {
    for (const x of f.today) seen.add(x.id);
  }, [f.today]);
  const name = f.displayName || '名前なし';
  const label = `${name}${f.activeNow ? '・取り組み中' : ''}${f.today.length > 0 ? `・今日 ${f.today.length} 階` : ''}`;
  return (
    <View style={styles.item} accessible accessibilityLabel={label} testID={`friend-row-${f.userId}`}>
      <View style={[styles.ring, f.activeNow ? styles.ringOn : f.today.length > 0 ? styles.ringToday : null]}>
        <View style={styles.face}>
          <Floors today={f.today} active={f.activeNow} fresh={fresh} />
          {f.activeNow ? <Ghost today={f.today} /> : null}
          <DropIn today={f.today} active={f.activeNow} fresh={fresh} delay={250 + index * 200} />
        </View>
        {f.activeNow ? (
          <View style={styles.badgeWrap} pointerEvents="none">
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {COPY_FRIEND_ACTIVE_TAG}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

export function FriendRow(props: { friends: HomeFriend[] }) {
  if (props.friends.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} testID="friend-row">
      {props.friends.map((f, i) => (
        <Friend key={f.userId} f={f} index={i} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingVertical: space.xs },
  item: { width: RING + 6, alignItems: 'center', gap: space.xs },
  ring: {
    width: RING,
    height: RING,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringOn: { borderColor: color.primary },
  ringToday: { borderColor: color.edge },
  face: {
    width: ART,
    height: ART,
    borderRadius: radius.full,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  // 札は丸より広く出してよい（1 行で収める）
  badgeWrap: { position: 'absolute', bottom: -9, left: -12, right: -12, alignItems: 'center' },
  badge: {
    backgroundColor: color.primary,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 2,
    borderColor: color.bg,
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: color.onPrimary, ...({ whiteSpace: 'nowrap' } as object) },
  name: { fontSize: font.small - 2, fontWeight: '700', color: color.muted, marginTop: 4, maxWidth: RING + 6 },
});
