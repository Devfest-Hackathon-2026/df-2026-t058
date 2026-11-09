// 集中。アプリが裏に回ったら leave、戻ったら return を送る（見張りは lib/focusSession.ts＝この画面を閉じても続く）。
// 時計は ⏸ と ▶ のマークだけで見せる（説明の文も色の変化も出さない＝owner-choices §4）。
// #315: 場面の帯（集中）・上に小さく時計と今日の一歩・真ん中はモルティとの会話・下に大きなマイク。地は少し深い紙色。

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorText } from '../../api';
import type { Checkpoint, Goal, Session } from '../../api/types';
import { GoalDocsSheet } from '../../components/GoalDocsSheet';
import { docsChipText, pickGoal } from '../../lib/goalDocs';
import { BigButton, ErrorLine } from '../../components/ui';
import { SceneTop } from '../../components/SceneTop';
import { TutorChat } from '../../components/TutorChat';
import { focusLock } from '../../focusLock';
import { beginFocusLock } from '../../lib/focusLock';
import { elapsedMs, formatClock, isRunning, type ClockState } from '../../lib/focusClock';
import { focusTracker } from '../../lib/focusSession';
import { nativeNotify } from '../../lib/nativeNotify';
import { useFlowGuard, useKeepScreenOn } from '../../lib/flowGuard';
import { COPY_CARD_STEP, COPY_END, COPY_SHORT_START_KEEP, COPY_SHORT_START_PASSED, COPY_SHORT_START_STOP } from '../../lib/copy';
import { shortStartDue } from '../../lib/shortStart';
import { FRIEND_POLL_MS, FRIEND_TOAST_MS, newStarts, startKey } from '../../lib/friendStart';
import { COPY_DOCS_OPEN, COPY_FRIEND_STARTED } from '../../lib/copy';
import { color, font, radius, space, touch } from '../../theme';

// 絵文字の形にならないよう、文字の形を指定する（U+FE0E）
const PLAY = '\u25B6\uFE0E';
const PAUSE = '\u23F8\uFE0E';

import { useTabTitle } from '../../lib/tabTitle';

export default function Focus() {
  useTabTitle('集中');
  useFlowGuard(true);
  useKeepScreenOn();
  const { sessionId, shortStart } = useLocalSearchParams<{ sessionId: string; shortStart?: string }>();
  const [shortStartDismissed, setShortStartDismissed] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [cp, setCp] = useState<Checkpoint | null>(null);
  const [clock, setClock] = useState<ClockState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 友達が始めた時だけ、短く知らせて消す（常には置かない・やめた知らせは無い・11/9 本人）
  const [friendToast, setFriendToast] = useState<string | null>(null);
  const shownStarts = useRef(new Set<string>()).current;
  const startedAt = session?.startedAt ?? null;
  useEffect(() => {
    if (!startedAt) return;
    let alive = true;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      try {
        const { items } = await api.feed();
        const fresh = newStarts(items, startedAt, shownStarts);
        for (const x of fresh) shownStarts.add(startKey(x));
        const last = fresh[fresh.length - 1];
        if (alive && last) {
          setFriendToast(`${last.displayName || '友達'}さんが${COPY_FRIEND_STARTED}`);
          clearTimeout(hide);
          hide = setTimeout(() => alive && setFriendToast(null), FRIEND_TOAST_MS);
        }
      } catch {
        // 知らせは無くても集中は続ける（何も出さない）
      }
    };
    const t = setInterval(() => void look(), FRIEND_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(hide);
    };
  }, [startedAt, shownStarts]);
  const pop = useRef(new Animated.Value(1)).current;
  // 他のアプリを開けなくする（Android・設定で ON の時だけ）の終了。始まっていなければ何もしない
  const lockEnd = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { session: s } = await api.activeSession();
        if (!alive) return;
        if (!s || s.id !== sessionId) {
          router.dismissTo('/');
          return;
        }
        setSession(s);
        // 開始（重ねた画面で「集中をやめる」が押されたら、「終える」の確かめを出す）
        const endLock = await beginFocusLock(() => setConfirming(true));
        if (alive) lockEnd.current = endLock;
        else endLock();
        const c = await focusTracker.track(s.id, s.startedAt);
        if (alive) setClock(c);
        const d = await api.getGoal(s.goalId);
        if (alive) setCp(d.roadmap?.checkpoints.find((c) => c.id === s.checkpointId) ?? null);
        // 資料の札用。取れなくても集中は続ける（札を出さないだけ）
        try {
          const h = await api.home();
          if (alive) setGoal(pickGoal(h.goals, s.goalId));
        } catch {
          // 札は出さない
        }
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
      lockEnd.current(); // 画面を離れたら必ず解除（残さない）
    };
  }, [sessionId]);

  // 離れた／戻った（送るのは focusTracker。ここは表示だけ）
  useEffect(
    () =>
      focusTracker.subscribe((c, kind) => {
        setClock(c);
        // Android: 離れて 2 分で呼び戻しの通知・戻ったら取り消す
        void nativeNotify.onFocusEvent(kind, sessionId);
        if (kind === 'return') {
          pop.setValue(0.6);
          Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: false }).start();
        }
      }),
    [pop, sessionId],
  );

  // Android の戻るキーでは画面を閉じず、「終える」の確かめを出す
  useEffect(() => {
    // 戻るキーは Android だけ（Web の BackHandler は何もせずにエラーを出す）
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setConfirming(true);
      return true;
    });
    return () => sub.remove();
  }, []);

  // 表示を 1 秒ごとに進める
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function end() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      // 離れた／戻ったの送り残しがあると、サーバーの作業時間がずれる。送れるまで終えない
      if (!(await focusTracker.flush())) {
        setError('記録をまだ送れていません。つながってからもう一度');
        setBusy(false);
        return;
      }
      await api.endSession(session.id);
      focusTracker.finish(session.id);
      void nativeNotify.onFocusEvent('end');
      lockEnd.current(); // 終了（画面を重ねる実装の解除）
      await focusLock.stop(); // 既存の窓口（今は何もしない）
      router.replace(`/reflect/${session.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const running = clock ? isRunning(clock) : true;
  const ms = clock ? elapsedMs(clock, now) : 0;
  // 「5 分だけやる」で始めた時だけ、5 分（動いていた時間）たったら 1 回だけ帯を出す
  const showShortStart = shortStart === '1' && clock !== null && shortStartDue(0, ms, shortStartDismissed);

  const docsChip = docsChipText(goal, COPY_DOCS_OPEN);

  return (
    // キーボードが出ても、入力欄が隠れないように画面ごと押し上げる
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <SceneTop
          scene="focus"
          right={
            confirming ? null : (
              <View style={styles.rightRow}>
                {docsChip ? (
                  <Pressable accessibilityRole="button" onPress={() => setDocsOpen(true)} style={styles.docChip} testID="focus-docs">
                    <Text style={styles.docChipText}>{docsChip}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.end} testID="end">
                  <Text style={styles.endText}>{COPY_END}</Text>
                </Pressable>
              </View>
            )
          }
        />
        {/* 上の帯: 時計と今日の一歩を小さくまとめる（真ん中は会話の場所・#315） */}
        <View style={styles.band} testID="clock-band">
          <View style={styles.clockRow} accessible accessibilityLabel={`${running ? '動いている' : '止まっている'} ${formatClock(ms)}`}>
            <Animated.Text style={[styles.mark, { transform: [{ scale: pop }] }]}>{running ? PLAY : PAUSE}</Animated.Text>
            <Text style={styles.clock} testID="clock">
              {formatClock(ms)}
            </Text>
          </View>
          <View style={styles.step}>
            <Text style={styles.k}>{COPY_CARD_STEP}</Text>
            <Text style={styles.stepText} numberOfLines={1}>
              {session?.oneLine ?? cp?.title ?? ''}
            </Text>
          </View>
        </View>
        {confirming ? (
          <View style={styles.row}>
            <BigButton label={COPY_SHORT_START_KEEP} variant="plain" size="small" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
            <BigButton label={COPY_END} size="small" busy={busy} onPress={end} style={{ flex: 1 }} testID="end-confirm" />
          </View>
        ) : null}
        {showShortStart ? (
          <View style={styles.shortStart} testID="short-start-band">
            <Text style={styles.shortStartText}>{COPY_SHORT_START_PASSED}</Text>
            <View style={styles.row}>
              <BigButton
                label={COPY_SHORT_START_KEEP}
                variant="plain"
                size="small"
                onPress={() => setShortStartDismissed(true)}
                style={{ flex: 1 }}
                testID="short-start-keep"
              />
              <BigButton
                label={COPY_SHORT_START_STOP}
                size="small"
                busy={busy}
                onPress={() => {
                  setShortStartDismissed(true);
                  void end();
                }}
                style={{ flex: 1 }}
                testID="short-start-stop"
              />
            </View>
          </View>
        ) : null}
        {goal && docsOpen ? (
          <GoalDocsSheet goal={goal} from="focus" visible onClose={() => setDocsOpen(false)} onChange={(docs) => setGoal({ ...goal, docs })} />
        ) : null}
        <ErrorLine text={error} />
        {friendToast ? (
          <View style={styles.friendToast} pointerEvents="none" accessibilityLiveRegion="polite" testID="friend-start-toast">
            <View style={styles.friendDot} />
            <Text style={styles.friendToastText}>{friendToast}</Text>
          </View>
        ) : null}
        {/* その場でモルティに相談する（別の画面には移らない）。答えではなく手がかりを出す（P2） */}
        <TutorChat sessionId={sessionId} compact />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // 友達が始めた時の短い知らせ（会話の上に重ねて、3 秒で消す）
  friendToast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    top: 132,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.box,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  friendDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: color.gold },
  friendToastText: { fontSize: font.small, fontWeight: '800', color: color.primaryLip },
  // 集中の場面は地を少し深い紙色に（場面が変わったと分かるように・#315）
  root: { flex: 1, backgroundColor: color.bgFocus },
  safe: { flex: 1, paddingHorizontal: space.lg, gap: space.sm, maxWidth: 560, width: '100%', alignSelf: 'center' },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  docChip: { minHeight: touch.min, justifyContent: 'center' },
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
  end: { minHeight: touch.min, justifyContent: 'center' },
  endText: {
    fontSize: font.small,
    fontWeight: '800',
    color: color.primary,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.edge,
    borderRadius: radius.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    overflow: 'hidden',
  },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.line,
    borderRadius: radius.card,
  },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  mark: { fontSize: 18, color: color.primary, width: 20, textAlign: 'center' },
  clock: { fontSize: 30, fontWeight: '900', color: color.text, fontVariant: ['tabular-nums'] },
  step: { flex: 1, minWidth: 0, borderLeftWidth: 1.5, borderLeftColor: color.line, paddingLeft: space.md },
  k: { fontSize: font.small - 2, color: color.muted, fontWeight: '700' },
  stepText: { fontSize: font.body, color: color.text, fontWeight: '800' },
  row: { flexDirection: 'row', gap: space.md },
  shortStart: { alignSelf: 'stretch', gap: space.sm },
  shortStartText: { fontSize: font.body, color: color.muted, fontWeight: '700', textAlign: 'center' },
});
