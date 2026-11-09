// 建物。集中 1 回の Floor が floors 個の階になり、下から積み上がる。色は金・銀・銅。
// 斜め上から見下ろした絵（等角・仰角 30°）。1 階 = 直方体の 3 面（上面・左・右）。計算は lib/isoTower（#269）。

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Polygon } from 'react-native-svg';
import type { Floor } from '../api/types';
import { tap } from '../lib/haptics';
import { crownColor, DROP_PX, seamBelow, showOutline, windowsByColor } from '../lib/buildFit';
import {
  BODY_W,
  CANVAS_W,
  canvasHeight,
  type IsoFaces,
  faceQuad,
  floorBlock,
  floorHitRect,
  floorOrigin,
  FLOOR_D,
  FLOOR_H,
  FLOOR_W,
  isoBlock,
  OUTLINE_ROWS,
  points,
  roof,
  TOP_H,
} from '../lib/isoTower';
import { showNextSlot, slotFill, slotFillHeight, slotLabel } from '../lib/towerSlot';
import { useReduceMotion } from '../lib/useReduceMotion';
import { color, type FloorColor, floorColor, font, towerArt } from '../theme';

const ART_W = Math.ceil(BODY_W) + 2; // 1 階の絵の箱
const ART_H = Math.ceil(FLOOR_H + TOP_H) + 2;
const WINDOW_FLOORS = 60; // 上からこの階数より下は、窓を描かない（階が多くても重くしない）
const DASH = '6 5';
const TOP_COLOR: Record<FloorColor, string> = { gold: towerArt.topGold, silver: towerArt.topSilver, bronze: towerArt.topBronze };

// 読み上げから隠す（絵の部品）
const hidden = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

const COLOR_NAME = { gold: '金', silver: '銀', bronze: '銅' } as const;

// 読み上げの名前。色（金・銀・銅）は見た目だけで伝わるので、文字でも言う
export function floorLabel(floor: Floor, k: number): string {
  const d = new Date(floor.at);
  return `${d.getMonth() + 1}/${d.getDate()} ${COLOR_NAME[floor.color]} ${k + 1} 階目`;
}

// 窓 w（0〜3）の形。0・1 は左の側面、2・3 は右の側面に、面の斜めに合わせて置く
function windowQuad(f: IsoFaces, w: number) {
  const u = w % 2 === 0 ? 0.22 : 0.6;
  return faceQuad(w < 2 ? f.left : f.right, u, u + 0.2, 0.3, 0.72);
}

// 3 面（左・右・上）の多角形。fill が null の面は塗らない（破線の枠）
function Faces(props: { f: IsoFaces; c?: FloorColor; stroke: string; width?: number; dash?: string; opacity?: number }) {
  const { f, c, stroke, width = 1, dash, opacity } = props;
  const fills = c ? [floorColor[c].fill, floorColor[c].lip, TOP_COLOR[c]] : ['none', 'none', 'none'];
  return (
    <G opacity={opacity}>
      {[f.left, f.right, f.top].map((face, n) => (
        <Polygon key={n} points={points(face)} fill={fills[n]} stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
      ))}
    </G>
  );
}

// 1 階の絵（hooks を使わない。試験で呼んで中身を見る）
export function FloorArt(props: { c: FloorColor; lit: boolean[]; selected?: boolean; windows?: boolean; seam?: boolean }) {
  const { c, lit, selected, windows = true, seam } = props;
  const f = floorBlock({ x: ART_W / 2, y: ART_H - 1 });
  const [o, l, , ] = f.left;
  const r = f.right[1];
  return (
    <Svg width={ART_W} height={ART_H}>
      <Faces f={f} c={c} stroke={selected ? color.text : floorColor[c].lip} width={selected ? 2 : 1} />
      {windows
        ? lit.map((on, w) => (
            <Polygon key={w} points={points(windowQuad(f, w))} fill={on ? towerArt.windowLit : towerArt.windowOff} />
          ))
        : null}
      {/* 下の階が同じ色の時の継ぎ目 */}
      {seam && o && l && r ? (
        <G>
          <Line x1={o[0]} y1={o[1]} x2={l[0]} y2={l[1]} stroke={towerArt.seam} strokeWidth={2} />
          <Line x1={o[0]} y1={o[1]} x2={r[0]} y2={r[1]} stroke={towerArt.seam} strokeWidth={2} />
        </G>
      ) : null}
    </Svg>
  );
}

function Block(props: {
  floor: Floor;
  index: number;
  k: number;
  fresh: boolean;
  reduce: boolean;
  selected: boolean;
  label: string | null;
  lit: boolean[];
  seam: boolean;
  windows: boolean;
  origin: { x: number; y: number };
  onPress?: () => void;
}) {
  const { floor, index, k, fresh, reduce, selected, label, lit, seam, windows, origin, onPress } = props;
  const drop = useRef(new Animated.Value(fresh ? 0 : 1)).current;
  useEffect(() => {
    if (!fresh) return;
    // 端末の「動きを減らす」がオンなら落とさず、すぐ置く
    if (reduce) {
      drop.setValue(1);
      return;
    }
    drop.setValue(0);
    const a = Animated.timing(drop, {
      toValue: 1,
      duration: 380,
      delay: 250 + index * 260,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [drop, fresh, index, reduce]);
  const top = origin.y - ART_H + 1;
  const hit = floorHitRect(origin);
  return (
    <Animated.View
      style={[
        styles.row,
        {
          top,
          opacity: drop,
          transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-DROP_PX, 0] }) }],
        },
      ]}
    >
      <View {...hidden} style={[styles.art, { left: origin.x - ART_W / 2 }]}>
        <FloorArt c={floor.color} lit={lit} selected={selected} windows={windows} seam={seam} />
      </View>
      {label ? (
        <Text {...hidden} style={[styles.dateLabel, { left: origin.x + BODY_W / 2 + 4, top: ART_H - FLOOR_H - TOP_H / 2 - 8 }]}>
          {label}
        </Text>
      ) : null}
      {/* 押せる範囲: 側面の帯を四角で近似（階ごとに重ならない） */}
      <Pressable
        style={[styles.hit, { left: hit.left, top: hit.top - top, width: hit.width, height: hit.height }]}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={floorLabel(floor, k)}
        accessibilityState={{ selected }}
        disabled={!onPress}
        onPress={() => {
          tap();
          onPress?.();
        }}
      />
    </Animated.View>
  );
}

const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export function Tower(props: {
  floors: Floor[];
  freshId?: string | null;
  selectedId?: string | null;
  onPressFloor?: (f: Floor) => void;
  maxBlocks?: number;
  nextSlot?: boolean;
}) {
  const { floors, freshId, selectedId, onPressFloor, maxBlocks = 40, nextSlot } = props;
  const reduce = useReduceMotion();
  // 古い順 → 1 階ずつのブロックに開く
  const blocks: { floor: Floor; k: number; first: boolean }[] = [];
  for (const f of floors) for (let k = 0; k < f.floors; k++) blocks.push({ floor: f, k, first: k === 0 });
  const start = Math.max(0, blocks.length - maxBlocks);
  const shown = blocks.slice(start);
  const colors = blocks.map((b) => b.floor.color);
  const top = crownColor(shown.map((b) => b.floor.color));
  // 次の階の枠は、今回の集中（freshId の階）の端数の分だけ塗る。0 階でも塗る
  const freshFloor = freshId ? floors.find((f) => f.id === freshId) : undefined;
  const fill = freshFloor ? slotFill(freshFloor.focusMin) : 0;
  const outline = showOutline(nextSlot, shown.length, fill);
  const slot = !outline && showNextSlot(nextSlot, shown.length);
  const levels = outline ? OUTLINE_ROWS : shown.length + (slot ? 1 : 0);
  const H = canvasHeight(levels);
  const slotO = floorOrigin(shown.length, H);
  const slotHit = floorHitRect(slotO);
  return (
    <View style={[styles.canvas, { height: H }]} testID="tower-canvas">
      <View {...hidden} style={styles.layer}>
        <Ground H={H} />
      </View>
      {shown.map((b, j) => {
        const i = start + j; // 建物の下から数えた位置（0 から）
        const fresh = b.floor.id === freshId;
        return (
          <Block
            key={`${b.floor.id}-${b.k}`}
            floor={b.floor}
            index={fresh ? b.k : 0}
            k={b.k}
            fresh={fresh}
            reduce={reduce}
            selected={b.floor.id === selectedId}
            label={b.first ? dateLabel(b.floor.at) : null}
            lit={windowsByColor(`${b.floor.id}:${i + 1}`, b.floor.color)}
            seam={seamBelow(colors, i)}
            windows={shown.length - j <= WINDOW_FLOORS}
            origin={floorOrigin(j, H)}
            onPress={onPressFloor ? () => onPressFloor(b.floor) : undefined}
          />
        );
      })}
      {levels > 0 ? (
        <View {...hidden} style={styles.layer} testID="tower-crown">
          <Svg width={CANVAS_W} height={H}>
            {slot && fill > 0 && freshFloor ? (
              <Faces f={floorBlock(slotO, slotFillHeight(fill, FLOOR_H))} c={freshFloor.color} stroke="none" opacity={0.7} />
            ) : null}
            {slot ? <Faces f={floorBlock(slotO)} stroke={color.edge} width={2} dash={DASH} /> : null}
            {top && !outline ? <Crown base={floorOrigin(levels - 1, H)} c={top} /> : null}
          </Svg>
        </View>
      ) : null}
      {outline ? <Outline H={H} /> : null}
      {slot ? (
        <View
          testID="next-slot"
          accessible
          accessibilityLabel={slotLabel(fill)}
          style={[styles.hit, { left: slotHit.left, top: slotHit.top, width: slotHit.width, height: slotHit.height }]}
        />
      ) : null}
    </View>
  );
}

// 地面（大きな菱形の線）と足元の影（建物の右下へずらした菱形）
function Ground({ H }: { H: number }) {
  const o = floorOrigin(0, H);
  const shadow = isoBlock({ x: o.x + 10, y: o.y + 6, w: FLOOR_W + 12, d: FLOOR_D + 12, h: 0 }).top;
  const ground = isoBlock({ x: o.x, y: o.y + 12, w: FLOOR_W + 36, d: FLOOR_D + 36, h: 0 }).top;
  return (
    <Svg width={CANVAS_W} height={H}>
      <Polygon points={points(ground)} fill="none" stroke={towerArt.ground} strokeWidth={2} />
      <Polygon points={points(shadow)} fill={towerArt.shadow} />
    </Svg>
  );
}

// 屋根（四角すいの手前の 2 面）と旗。色は最上階の色
function Crown({ base, c, dash }: { base: { x: number; y: number }; c?: FloorColor; dash?: string }) {
  const r = roof(base);
  const [ax, ay] = r.apex;
  const [fx, fy] = r.flagTop;
  const fc = c ? floorColor[c] : null;
  const line = fc ? fc.lip : color.edge;
  return (
    <G>
      <Line x1={ax} y1={ay} x2={fx} y2={fy} stroke={fc ? towerArt.pole : color.edge} strokeWidth={2} strokeDasharray={dash ? '3 3' : undefined} />
      {fc ? <Polygon points={`${fx + 1},${fy} ${fx + 15},${fy + 4} ${fx + 1},${fy + 9}`} fill={fc.fill} stroke={fc.lip} /> : null}
      <Polygon points={points(r.left)} fill={fc ? fc.fill : 'none'} stroke={line} strokeWidth={2} strokeDasharray={dash} />
      <Polygon points={points(r.right)} fill={fc ? fc.lip : 'none'} stroke={line} strokeWidth={2} strokeDasharray={dash} />
    </G>
  );
}

// 0 階の建物: 屋根と胴の輪郭（破線）と、消えた窓。ここに階が積み上がることを絵で見せる
function Outline({ H }: { H: number }) {
  const rows = Array.from({ length: OUTLINE_ROWS }, (_, r) => r);
  return (
    <View
      style={styles.layer}
      testID="tower-outline"
      accessible
      accessibilityLabel="まだ階がない建物。集中すると、ここに階が積み上がる"
    >
      <Svg width={CANVAS_W} height={H}>
        <Faces f={floorBlock(floorOrigin(0, H), OUTLINE_ROWS * FLOOR_H)} stroke={color.edge} width={2} dash={DASH} />
        {rows.map((r) =>
          [0, 1, 2, 3].map((w) => (
            <Polygon
              key={`${r}-${w}`}
              points={points(windowQuad(floorBlock(floorOrigin(r, H)), w))}
              fill={towerArt.windowOff}
              opacity={0.6}
            />
          )),
        )}
        <Crown base={floorOrigin(OUTLINE_ROWS - 1, H)} dash={DASH} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { width: CANVAS_W, alignSelf: 'center' },
  layer: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
  row: { position: 'absolute', left: 0, width: CANVAS_W, height: ART_H, pointerEvents: 'box-none' },
  art: { position: 'absolute', top: 0, width: ART_W, height: ART_H, pointerEvents: 'none' },
  hit: { position: 'absolute' },
  dateLabel: { position: 'absolute', fontWeight: '800', fontSize: font.small, color: color.muted },
});
