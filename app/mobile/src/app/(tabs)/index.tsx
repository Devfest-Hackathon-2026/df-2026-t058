// ホーム（今日タブ・#315 の 1 枚目）: モルティとの対話で進める。余計な部品は出さない。
// 開いた直後はモルティが大きく考えていて、今日の提案がそろったら、自分から一言で提案してくる。
// 並びは「モルティの一言 → 今日の一歩のカード → 始める（1 つ）→ ほかの目標（畳んで 1 行）」、下に大きなマイク。
// 会話は積み上げず、最新の 1 往復だけを置き換えて見せる（ずっと同じトーク画面にいるように見せない・11/9 本人）。
// 数字の集計（連続記録・階・ポイント）はホームに並べない（建物タブで見る）。友達の動きはモルティの 2 文目で言う。

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, config } from '../../api';
import { showDemoSeed } from '../../api/demoSeed';
import type { AgentAction, Goal, HomeData, TodayProposalItem } from '../../api/types';
import { AgentSays, MoltyBig } from '../../components/AgentSays';
import { MiniRoad } from '../../components/MiniRoad';
import { FriendRow } from '../../components/FriendRow';
import { GoalDocsSheet } from '../../components/GoalDocsSheet';
import { docsCount } from '../../lib/goalDocs';
import { formatDeadline } from '../../lib/goalForm';
import { SceneTop } from '../../components/SceneTop';
import { MoltyDock } from '../../components/MoltyDock';
import { useMoltyChat } from '../../components/MoltyPanel';
import { ErrorBox } from '../../components/State';
import { BigButton, Card, RiseIn, Screen, staggerDelay, TextLink } from '../../components/ui';
import {
  COPY_CARD_DEADLINE,
  COPY_CARD_GOAL,
  COPY_CARD_STEP,
  COPY_DOCS_OPEN,
  COPY_FINISHED_GOALS,
  COPY_NO_ROAD,
  COPY_OTHER_GOALS,
  COPY_SHORT_START,
} from '../../lib/copy';
import { focusTracker } from '../../lib/focusSession';
import { flowActive, takeResume, useFlowGuard } from '../../lib/flowGuard';
import { tap } from '../../lib/haptics';
import { homeCard } from '../../lib/homeCard';
import { daysLeft, daysLeftText, isFinished, isUrgent, lastOnly, newGoalId, proposalKey, sortByDeadline } from '../../lib/homeView';
import { actionKey, actionLabel, actionPath } from '../../lib/moltyActions';
import { HOME_EMPTY_LINE, moltyHome } from '../../lib/moltyHome';
import { askWithAgent, nativeNotify } from '../../lib/nativeNotify';
import { useLoad } from '../../lib/useLoad';
import { useTabTitle } from '../../lib/tabTitle';
import { color, font, radius, space, touch } from '../../theme';

type GoalEntry = HomeData['goals'][number];

// 開いた直後の大きなモルティ: 最低これだけ見せ、提案がそろわなくても最長でここまでで切り替える
export const INTRO_MIN_MS = 900;
export const INTRO_MAX_MS = 3500;
// 起動してから 1 回だけ（タブを行き来するたびには出さない）
let introPlayed = false;

// 今日の提案（POST /api/today・何も保存しない）。目標の次の一歩が変わった時だけ取り直す。失敗は空（モルティはルールで言う）。
// settled＝答えが返った（または取りに行く必要がない）
function useTodayProposals(goals: GoalEntry[], enabled: boolean): { list: TodayProposalItem[]; settled: boolean } {
  const [list, setList] = useState<TodayProposalItem[]>([]);
  const [got, setGot] = useState(false);
  const runner = useRef(
    lastOnly(
      (_: void) => api.today(),
      (r) => {
        setList(r.ok ? r.value.proposals : []);
        setGot(true);
      },
    ),
  ).current;
  useEffect(() => () => runner.cancel(), [runner]);
  const key = proposalKey(goals);
  useEffect(() => {
    if (enabled) runner.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { list, settled: !enabled || got };
}

// 開いた直後の大きなモルティを出している間か。2 回目以降・読み込み失敗では出さない。
// 絵は動かない大きな姿で、出入りは RiseIn（動きを減らす設定では動かない）なので、その設定でも出す
function useIntro(ready: boolean, settled: boolean, failed: boolean): boolean {
  const [on, setOn] = useState(!introPlayed);
  const [minDone, setMinDone] = useState(false);
  useEffect(() => {
    if (!on || !ready) return;
    const a = setTimeout(() => setMinDone(true), INTRO_MIN_MS);
    const b = setTimeout(() => setOn(false), INTRO_MAX_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [on, ready]);
  useEffect(() => {
    if (on && (failed || (minDone && settled))) setOn(false);
  }, [on, failed, minDone, settled]);
  useEffect(() => {
    if (!on) introPlayed = true;
  }, [on]);
  return on;
}

export default function Home() {
  useTabTitle(null);
  const { data, error, loading, reload } = useLoad<HomeData>(() => api.home());
  const [health, setHealth] = useState<{ demoSeed?: boolean } | null>(null);
  useEffect(() => {
    void api.health().then(setHealth, () => undefined);
  }, []);
  // 本人が選んだ目標（モルティがその目標の次の一歩を言う）。選ぶまでは今日の提案
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);
  const goals = data ? sortByDeadline(data.goals) : [];
  const empty = !!data && data.goals.length === 0;
  const { list: proposals, settled } = useTodayProposals(goals, !!data && !empty);
  const intro = useIntro(!!data, settled, !!error && !data);

  // 新しい目標を作って戻った時は、モルティがその目標の話をする
  const prevIds = useRef<string[] | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = sortByDeadline(data.goals).map((g) => g.goal.id);
    const added = newGoalId(prevIds.current, ids);
    prevIds.current = ids;
    if (added) setPickedId(added);
  }, [data]);

  // 進行中の集中があれば、ホームにいる間も離れた／戻ったを送る（起動し直した後でも）
  const active = data?.active ?? null;
  useEffect(() => {
    if (active) void focusTracker.track(active.id, active.startedAt).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // 流れの途中（集中中・振り返り待ち）の間は閉じる確認を付ける。開いた直後に 1 回だけ、続きの画面へ入る
  useFlowGuard(flowActive({ activeSession: active, pendingReflect: data?.toReflect?.[0] }));
  useEffect(() => {
    if (!data) return;
    const path = takeResume(data);
    if (path) router.push(path as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

  // Android の通知: 最初の目標の道筋を決めた後に 1 回だけ許可を聞く・毎日の声かけを通知の強さに合わせる
  useEffect(() => {
    if (!data) return;
    void nativeNotify.onHome(
      { hasRoadmap: data.goals.some((g) => !!g.roadmap), nudgeLevel: data.me.nudgeLevel },
      api,
      askWithAgent,
    );
  }, [data]);

  const view = data ? moltyHome(data, proposals, pickedId) : null;
  const chat = useMoltyChat({
    screen: 'home',
    ...(pickedId ? { goalId: pickedId } : {}),
    line: view?.line ?? HOME_EMPTY_LINE,
    actions: view?.actions ?? [],
  });
  const shown = chat.shown;
  const [first, ...rest] = shown.actions;
  const card = homeCard(first, goals);
  const [docsFor, setDocsFor] = useState<Goal | null>(null);
  const go = (a: AgentAction) => router.push(actionPath(a) as never);
  // ほかの目標: カードに出ている目標を除いた一覧（終わった物は最後）
  const others = goals.filter((g) => g.goal.id !== card?.goalId);
  const now = new Date();

  const renderOther = (g: GoalEntry, i: number) => {
    const days = daysLeft(g.goal.deadline, now);
    const urgent = isUrgent(days) && !isFinished(g);
    const mark = data?.active?.goalId === g.goal.id ? '● ' : '';
    return (
      <RiseIn key={g.goal.id} delay={staggerDelay(i)}>
        <Pressable
          testID={`goal-card-${i}`}
          accessibilityRole="button"
          onPress={() => {
            tap();
            setPickedId(g.goal.id);
            setOthersOpen(false);
          }}
          style={({ pressed }) => [styles.slim, urgent && styles.urgentEdge, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.slimText, isFinished(g) && styles.dim]} numberOfLines={1}>{`${mark}${g.goal.text}`}</Text>
          <Text style={[styles.meta, urgent && styles.urgentText]}>{isFinished(g) ? COPY_FINISHED_GOALS : daysLeftText(days)}</Text>
        </Pressable>
      </RiseIn>
    );
  };
  const othersSorted = [...others.filter((g) => !isFinished(g)), ...others.filter(isFinished)];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      {/* 上は場面の帯だけ（今日）。目標を足すのはモルティに話しかけて（「書く」「取り込む」のボタンが返る・11/9 本人） */}
      <View style={styles.top}>
        <SceneTop scene="home" />
      </View>
      {config.mode === 'mock' ? <Text style={styles.mock}>mock</Text> : null}

      <Screen footer={data && !intro ? <MoltyDock text={chat.text} setText={chat.setText} busy={chat.busy} send={chat.send} testID="home-dock" /> : undefined} footerPlain>
        <ErrorBox text={error} onRetry={reload} />

        {/* 開いた直後: モルティが大きく、今日の分を考えている */}
        {intro || (!data && loading) ? (
          <View style={styles.intro} testID="home-intro">
            <RiseIn>
              <MoltyBig />
            </RiseIn>
          </View>
        ) : null}

        {view && !intro ? (
          <View style={styles.hero} testID="home-molty">
            {/* 一番上に友達の列（今日積んだ階・取り組み中。中身・数字は出さない・11/9 本人）。その下にモルティ */}
            <FriendRow friends={data?.friends ?? []} />
            {/* 直前の自分の言葉（最新の 1 往復だけ。前のやり取りは積まない） */}
            {chat.reply || chat.busy ? (
              <Text style={styles.mine} numberOfLines={2} testID="home-molty-mine">
                {chat.reply?.asked ?? chat.pending}
              </Text>
            ) : null}
            <AgentSays
              {...shown.line}
              chat
              waiting={chat.busy}
              done={!chat.reply && view.done}
              testID="home-molty-says"
            />

            {card ? (
              <RiseIn key={`${card.goalId}:${card.step?.id ?? ''}`} delay={staggerDelay(1)}>
                <Card style={styles.card}>
                  <View testID="home-card">
                    <Text style={styles.k}>{COPY_CARD_GOAL}</Text>
                    <Text style={styles.v} numberOfLines={2}>
                      {card.goalText}
                    </Text>
                    {/* タスク（取り込んだ課題）は一歩の名前が題と同じなので、繰り返さない */}
                    {card.step?.title !== card.goalText ? (
                      <>
                        <Text style={[styles.k, styles.kGap]}>{COPY_CARD_STEP}</Text>
                        <Text style={styles.vMain} numberOfLines={2}>
                          {card.step ? card.step.title : COPY_NO_ROAD}
                        </Text>
                      </>
                    ) : null}
                    <Text style={[styles.k, styles.kGap]}>{COPY_CARD_DEADLINE}</Text>
                    {(() => {
                      const days = daysLeft(card.deadline, now);
                      return <Text style={[styles.v, isUrgent(days) && styles.urgentText]}>{daysLeftText(days)}</Text>;
                    })()}
                  </View>
                  {/* 目標の資料（タスクの間ずっと残る・押すと見返し・直し・足せる・11/9） */}
                  {(() => {
                    const g = goals.find((x) => x.goal.id === card.goalId)?.goal;
                    if (!g) return null;
                    const n = docsCount(g);
                    return (
                      <Pressable accessibilityRole="button" onPress={() => setDocsFor(g)} style={styles.docChip} testID="home-docs">
                        <Text style={styles.docChipText}>{n > 0 ? `📄 ${COPY_DOCS_OPEN} ${n}` : `＋ ${COPY_DOCS_OPEN}`}</Text>
                      </Pressable>
                    );
                  })()}
                  {/* 道は小さな横の 1 行（押すと縦の道が開く・決定 11/9）。大きな S 字の道はホームに置かない */}
                  <MiniRoad checkpoints={card.checkpoints} goalText={card.goalText} deadlineLabel={formatDeadline(new Date(card.deadline))} />
                </Card>
              </RiseIn>
            ) : null}

            {first ? (
              <RiseIn delay={staggerDelay(2)}>
                <BigButton label={actionLabel(first, goals, true)} onPress={() => go(first)} testID="home-molty-action-0" />
              </RiseIn>
            ) : null}
            {/* 5 分だけやる: 始めるの下に小さく（気が重い日の入り口） */}
            {first?.kind === 'start' ? (
              <View style={styles.center}>
                <TextLink
                  label={COPY_SHORT_START}
                  onPress={() => router.push(`/start/${first.goalId}/${first.checkpointId}?short=1` as never)}
                  testID="home-short-start"
                />
              </View>
            ) : null}
            {/* 2 つ目以降は小さく（目標なしの「書く」など）。カードがある時は出さない（別の一歩は「ほかの目標」から） */}
            {rest.length > 0 && !card ? (
              <View style={styles.restRow}>
                {rest.map((a, i) => (
                  <TextLink key={actionKey(a)} label={actionLabel(a, goals, false)} onPress={() => go(a)} testID={`home-molty-action-${i + 1}`} />
                ))}
              </View>
            ) : null}

            {empty && showDemoSeed(health, 0) ? (
              <View style={styles.center}>
                <TextLink
                  label="デモ用の見本を入れる"
                  onPress={() => {
                    void api
                      .demoSeed()
                      .then(() => reload())
                      .catch(() => reload());
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ほかの目標: 畳んで 1 行。開くと 1 行ずつ並び、押すとモルティがその目標の話をする */}
        {view && !intro && othersSorted.length > 0 ? (
          <View style={styles.others}>
            <Pressable
              testID="other-goals"
              accessibilityRole="button"
              accessibilityState={{ expanded: othersOpen }}
              style={styles.othersHead}
              onPress={() => {
                tap();
                setOthersOpen((v) => !v);
              }}
            >
              <Text style={styles.othersText}>{`${COPY_OTHER_GOALS} ${othersSorted.length} 件`}</Text>
              <Text style={styles.othersText}>{othersOpen ? '▴' : '▾'}</Text>
            </Pressable>
            {othersOpen ? <View style={styles.list}>{othersSorted.map(renderOther)}</View> : null}
          </View>
        ) : null}
      </Screen>
      {docsFor ? (
        <GoalDocsSheet goal={docsFor} from="goal" visible onClose={() => (setDocsFor(null), void reload())} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 外側の幅は画面に合わせる。中の物が広くても、ホーム全体は横にずれない
  root: { flex: 1, backgroundColor: color.bg, width: '100%', overflow: 'hidden' },
  mock: { position: 'absolute', right: space.sm, bottom: space.sm, color: color.muted, fontSize: font.small, zIndex: 1 },
  // 開いた直後の大きなモルティ（画面の真ん中より少し上）
  intro: { alignItems: 'center', paddingTop: space.xxxl * 2 },
  // モルティの周りは広く取る（窮屈に見せない・11/9 本人指摘）
  top: { paddingHorizontal: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  hero: { gap: space.lg, paddingTop: space.sm },
  // TextLink は自分で左に寄るので、行にして真ん中へ
  center: { flexDirection: 'row', justifyContent: 'center' },
  mine: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    fontSize: font.body,
    color: color.text,
    backgroundColor: color.primarySoft,
    borderRadius: radius.card,
    borderBottomRightRadius: radius.box,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    overflow: 'hidden',
  },
  card: { gap: space.md },
  docChip: { alignSelf: 'flex-start', minHeight: touch.min, justifyContent: 'center' },
  docChipText: {
    fontSize: font.small,
    fontWeight: '800',
    color: color.primaryLip,
    backgroundColor: color.primarySoft,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  k: { fontSize: font.small, color: color.muted, fontWeight: '700' },
  kGap: { marginTop: space.md },
  v: { fontSize: font.large - 2, color: color.text, fontWeight: '700', marginTop: 2 },
  // 今日の一歩はカードの主役（一段大きく）
  vMain: { fontSize: font.large, color: color.text, fontWeight: '800', marginTop: 2 },
  restRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space.lg },
  others: { gap: space.sm, borderTopWidth: 1, borderTopColor: color.line, marginTop: space.sm },
  othersHead: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  othersText: { fontSize: font.small, fontWeight: '800', color: color.muted },
  list: { gap: space.sm },
  // 急ぎの印: 左端の細い縦線と、太い警告色の期限
  urgentEdge: { borderLeftWidth: space.xs, borderLeftColor: color.danger },
  urgentText: { color: color.danger, fontWeight: '900' },
  dim: { color: color.muted },
  // 畳んだ行（1 行・押せる高さ 48）
  slim: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: color.surface,
    borderRadius: radius.box,
    borderWidth: 2,
    borderColor: color.line,
  },
  slimText: { flex: 1, fontSize: font.body, fontWeight: '800', color: color.text },
  meta: { fontSize: font.small, color: color.muted, fontWeight: '700' },
});
