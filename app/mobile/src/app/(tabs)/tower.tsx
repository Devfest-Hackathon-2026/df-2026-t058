// 建物。階を押すと、その日の記録（目標・選んだ理由・集中した分数・AI の手助け）。
// 建物は縦にスクロールでき、地面（最初の階）まで見られる。開いた時は最上階が見える位置（#269）。

import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { api } from '../../api';
import type { Floor } from '../../api/types';
import { Tower } from '../../components/Tower';
import { Card, ErrorLine, Screen } from '../../components/ui';
import { sessionInfo } from '../../lib/local';
import { ptText } from '../../lib/pointsView';
import { useCountUp } from '../../lib/useCountUp';
import { useLoad } from '../../lib/useLoad';
import { COPY_AI_HELP, COPY_TOWER_COLOR_NOTE } from '../../lib/copy';
import { thoughtLine } from '../../lib/reflectView';
import {
  achievementWords,
  helpWords,
  latestScrollY,
  ownScoreWords,
  SCROLL_MAX_BLOCKS,
  towerNeedsScroll,
} from '../../lib/towerView';
import { Skeleton } from '../../components/State';
import { WeeklyCard } from '../../components/WeeklyCard';
import { TowerPoints } from '../../components/PointsSheet';
import { cardTop, isWideTower, WIDE_CARD_W, WIDE_GAP, WIDE_MAX_W, WIDE_PAD, wideTowerScale } from '../../lib/buildFit';
import { towerSize } from '../../lib/isoTower';
import { color, floorColor, font, radius, space } from '../../theme';

interface DayRecord {
  floor: Floor;
  goalText: string | null;
  why: string | null;
  cpTitle: string | null;
  ai: number | null;
  mine: number | null;
  help: { small: number; medium: number } | null;
}

// 判定（AI・自分）は階（この集中）の値を使う。チェックポイントの値は、同じチェックポイントの後の集中で上書きされるため使わない。
const blankRecord = (floor: Floor): DayRecord => ({
  floor,
  goalText: null,
  why: null,
  cpTitle: null,
  ai: floor.aiAchievement ?? null,
  mine: floor.achievement ?? null,
  help: null,
});

async function loadRecord(floor: Floor): Promise<DayRecord> {
  const rec = blankRecord(floor);
  const [info, help] = await Promise.all([
    sessionInfo(floor.sessionId),
    api.tutorHistory(floor.sessionId).then((r) => r.helpTotal).catch(() => null),
  ]);
  rec.help = help;
  if (info) {
    try {
      const d = await api.getGoal(info.goalId);
      rec.goalText = d.goal.text;
      rec.why = d.roadmap?.why ?? null;
      const cp = d.roadmap?.checkpoints.find((c) => c.id === info.checkpointId);
      if (cp) rec.cpTitle = cp.title;
    } catch {
      // 目標が引けなくても、階の数字は出す
    }
  }
  return rec;
}

const dateText = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function Row(props: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{props.label}</Text>
      <Text style={styles.rowValue}>{props.value}</Text>
    </View>
  );
}

import { useTabTitle } from '../../lib/tabTitle';

export default function TowerScreen() {
  useTabTitle('建物');
  const { data, error } = useLoad(() => api.tower());
  // 建物の上の「今週」のカード（#202）。失敗しても建物は出す
  const week = useLoad(() => api.weekly());
  const pts = useLoad(() => api.points()); // 失敗しても週のまとめの 1 行が出ないだけ
  // 考えポイントの総得点と目標ごとの内訳は、建物タブのここだけに出す（#351・ホームには出さない）
  const weekly = (
    <>
      <WeeklyCard data={week.data} error={week.error} onRetry={() => void week.reload()} points={pts.data} />
      <TowerPoints data={pts.data} />
    </>
  );
  const [rec, setRec] = useState<DayRecord | null>(null);
  // 数字は開いた直後と変わった時に増えていく（読み込み中は動かさない）
  const totalShown = useCountUp(data?.totalFloors);
  const streakShown = useCountUp(data?.streak);
  const focusShown = useCountUp(rec?.floor.focusMin);

  async function open(f: Floor) {
    setRec(blankRecord(f));
    setRec(await loadRecord(f));
  }

  const { width: screenW, height: screenH } = useWindowDimensions();
  const wide = isWideTower(screenW);
  const floors = data?.floors ?? [];
  const blockCount = floors.reduce((n, f) => n + f.floors, 0);
  // 縮めて 1 画面に収めず、スクロールで地面まで見せる。PC 幅だけ列の幅に合わせて大きくする
  const shown = Math.min(blockCount, SCROLL_MAX_BLOCKS);
  const scale = wide ? wideTowerScale(screenW, screenH, blockCount).scale : 1;
  const natH = towerSize(shown).h; // 0 階は輪郭の建物の高さ
  const boxH = natH * scale;

  // スクロール: 見える高さ・中身の高さ・建物の上端の位置を測り、必要な時だけボタンを出す
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [viewH, setViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [towerY, setTowerY] = useState<number | null>(null);
  const needScroll = towerNeedsScroll(contentH, viewH);
  const toLatest = (animated: boolean) =>
    scrollRef.current?.scrollTo({ y: latestScrollY(towerY ?? 0, scale, viewH), animated });
  const placed = useRef(false);
  useEffect(() => {
    // 開いた時の初期位置: 最上階（最新）が見える位置。一度だけ
    if (placed.current || !data || towerY === null || !needScroll) return;
    placed.current = true;
    toLatest(false);
  });

  // 押した階（いくつかの階にまたがる時は、いちばん上）の、見えている中での位置（下から 0 から）
  let shownIndex = 0;
  if (rec) {
    let end = 0;
    for (const f of floors) {
      end += f.floors;
      if (f.id === rec.floor.id) break;
    }
    shownIndex = Math.max(0, end - 1 - (blockCount - shown));
  }

  const achievement = rec ? achievementWords(rec.ai, rec.mine) : null;

  const recordCard = rec ? (
    <Card style={{ borderColor: floorColor[rec.floor.color].fill }}>
      <Text style={styles.date}>{dateText(rec.floor.at)}</Text>
      {rec.goalText ? <Text style={styles.goal}>{rec.goalText}</Text> : null}
      {rec.cpTitle ? <Row label="チェックポイント" value={rec.cpTitle} /> : null}
      {rec.why ? <Row label="選んだ理由" value={rec.why} /> : null}
      <Row label="集中した時間" value={`${focusShown} 分`} />
      {rec.help ? <Row label={COPY_AI_HELP} value={helpWords(rec.help)} /> : null}
      {achievement ? <Row label="どこまでできたか" value={achievement} /> : null}
      <Row label="自分で決めた度" value={ownScoreWords(rec.floor.ownScore)} />
      <Row label="シェル" value={ptText(rec.floor.pt)} />
      {thoughtLine(rec.floor.asks, rec.floor.thoughtAsks) ? (
        <Text style={styles.date} testID="thought-line">{thoughtLine(rec.floor.asks, rec.floor.thoughtAsks)}</Text>
      ) : null}
    </Card>
  ) : null;

  // スマホ: 札は押した階のすぐ下に重ねて出す。PC 幅: 右の列に固定で出す（建物に重ねない）
  const card =
    recordCard && !wide ? (
      <View style={[styles.cardPos, { top: cardTop(shownIndex, shown, scale, boxH) }]}>{recordCard}</View>
    ) : null;

  const head = data ? (
    <View>
      <View style={styles.head}>
        <Text style={styles.total} accessibilityLabel={`${data.totalFloors} 階`}>{`${totalShown} 階`}</Text>
        <Text style={styles.streak} accessibilityLabel={`${data.streak} 日連続`}>{`${streakShown} 日連続`}</Text>
      </View>
      {pts.data ? (
        <Text style={styles.tally} testID="tower-head-points">
          {ptText(pts.data.total)}
        </Text>
      ) : null}
    </View>
  ) : null;

  // 読み込み中は骨組み（見出しの 2 行と建物の形）
  const loading =
    !data && !error ? (
      <View style={styles.skeleton} testID="tower-loading">
        <Skeleton width={160} height={44} />
        <Skeleton width={220} height={18} />
        <View style={styles.skeletonTower}>
          <Skeleton width={200} height={wide ? 360 : 240} />
        </View>
      </View>
    ) : null;

  const building = data ? (
    <Pressable accessible={false} style={{ height: Math.max(boxH, 1) }} onPress={() => setRec(null)}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: natH,
          transform: [{ translateY: -(natH * (1 - scale)) / 2 }, { scale }],
        }}
      >
        <Tower
          floors={data.floors}
          nextSlot
          maxBlocks={SCROLL_MAX_BLOCKS}
          selectedId={rec?.floor.id ?? null}
          onPressFloor={(f) => (rec?.floor.id === f.id ? setRec(null) : open(f))}
        />
      </View>
      {card}
    </Pressable>
  ) : null;

  // 「地面まで」「最新へ」のボタン（スクロールが要る高さの時だけ）
  const jump = needScroll ? (
    <View style={styles.jump}>
      <Pressable accessibilityRole="button" accessibilityLabel="最新の階へ" style={styles.jumpBtn} onPress={() => toLatest(true)}>
        <Text style={styles.jumpText}>↑ 最新へ</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="地面（最初の階）まで"
        style={styles.jumpBtn}
        onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <Text style={styles.jumpText}>↓ 地面まで</Text>
      </Pressable>
    </View>
  ) : null;

  // 建物の側のスクロール。PC 幅では建物の列だけが独立してスクロールする
  const scroller = (children: ReactNode, grounded: boolean) => (
    <View style={styles.scrollBox}>
      <ScrollView
        ref={scrollRef}
        testID="tower-scroll"
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentH(h)}
        contentContainerStyle={grounded ? styles.scrollGrounded : styles.scrollBody}
      >
        {children}
      </ScrollView>
      {jump}
    </View>
  );
  const measured = <View onLayout={(e) => setTowerY(e.nativeEvent.layout.y)}>{building}</View>;

  if (wide) {
    return (
      <View style={styles.wideScreen}>
        <View style={styles.wideRow} testID="tower-wide">
          <View style={styles.wideTower}>{loading ? <Skeleton width={200} height={360} /> : scroller(measured, true)}</View>
          <View style={styles.wideSide}>
            <ErrorLine text={error} />
            {loading ? (
              <>
                <Skeleton width={160} height={44} />
                <Skeleton width={220} height={18} />
              </>
            ) : null}
            {head}
            {recordCard ?? (data && blockCount > 0 ? <Text style={styles.hint}>{TOWER_HINT}</Text> : null)}
            {weekly}
          </View>
        </View>
      </View>
    );
  }

  return (
    <Screen scroll={false}>
      {scroller(
        <>
          <ErrorLine text={error} />
          {loading}
          {head}
          {measured}
          {weekly}
        </>,
        false,
      )}
    </Screen>
  );
}

const TOWER_HINT = '階を押すと、その日の記録がここに出ます';

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  total: { fontSize: font.hero, fontWeight: '900', color: color.primary },
  tally: { fontSize: font.body, fontWeight: '800', color: color.text },
  tallyNote: { fontSize: font.small, fontWeight: '600', color: color.muted },
  cardPos: { position: 'absolute', left: 0, right: 0 },
  skeleton: { gap: space.sm },
  skeletonTower: { alignItems: 'center', marginTop: space.lg },
  wideScreen: { flex: 1, backgroundColor: color.bg },
  wideRow: {
    flex: 1,
    flexDirection: 'row',
    gap: WIDE_GAP,
    padding: WIDE_PAD,
    width: '100%',
    maxWidth: WIDE_MAX_W,
    alignSelf: 'center',
  },
  wideTower: { flex: 1, minWidth: 0, justifyContent: 'flex-end', alignItems: 'stretch' },
  wideSide: { width: WIDE_CARD_W, gap: space.lg },
  hint: { fontSize: font.body, color: color.muted, fontWeight: '700' },
  scrollBox: { flex: 1, minHeight: 0 },
  scrollBody: { gap: space.lg, paddingBottom: space.xxxl },
  scrollGrounded: { flexGrow: 1, justifyContent: 'flex-end', paddingBottom: space.lg },
  jump: { position: 'absolute', right: 0, bottom: space.sm, gap: space.sm, alignItems: 'flex-end' },
  jumpBtn: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.edge,
    backgroundColor: color.surface,
  },
  jumpText: { fontSize: font.small, fontWeight: '800', color: color.text },
  streak: { fontSize: font.body, fontWeight: '800', color: color.muted },
  date: { fontSize: font.small, fontWeight: '800', color: color.muted },
  goal: { fontSize: font.large, fontWeight: '800', color: color.text },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  rowLabel: { width: 128, fontSize: font.small, color: color.muted, fontWeight: '700' },
  rowValue: { flex: 1, fontSize: font.body, color: color.text, fontWeight: '600' },
});
