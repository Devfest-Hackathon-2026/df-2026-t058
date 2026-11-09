// 始める（#315）: 聞かずにそのまま集中へ入る、1 秒ほどの場面転換。
// どこまでやるかはロードマップのチェックポイントで決まっているので、もう聞かない（11/9 本人「くどい」）。
// 今日の一行は、前の振り返りで決めた次の一歩があればそれ、無ければチェックポイントの名前。
// ホームと同じ並び（場面の帯 → モルティの一言 → カード）で始め、モルティが一言まとめ、
// カードが上の帯の位置へ縮み、地が集中の色に変わってから集中の画面へ移る。動きは控えめに（11/9 本人）。

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorText } from '../../../api';
import type { Checkpoint } from '../../../api/types';
import { AgentSays } from '../../../components/AgentSays';
import { SceneTop } from '../../../components/SceneTop';
import { ErrorBox } from '../../../components/State';
import { TextLink } from '../../../components/ui';
import { focusLock } from '../../../focusLock';
import { startTalkGo } from '../../../lib/agentLines';
import { COPY_CARD_GOAL, COPY_CARD_STEP } from '../../../lib/copy';
import { focusTracker } from '../../../lib/focusSession';
import { getNextStep, rememberSession, setNextStep } from '../../../lib/local';
import { goLine } from '../../../lib/startGo';
import { useTabTitle } from '../../../lib/tabTitle';
import { useReduceMotion } from '../../../lib/useReduceMotion';
import { color, font, radius, space } from '../../../theme';

// モルティの一言を読める間 → カードが縮む間。合わせて 1 秒ほど
export const GO_SAY_MS = 700;
export const GO_SHRINK_MS = 450;

export default function Start() {
  useTabTitle('始める');
  const { goalId, checkpointId, short } = useLocalSearchParams<{ goalId: string; checkpointId: string; short?: string }>();
  const [goal, setGoal] = useState<string | null>(null);
  const [cp, setCp] = useState<Checkpoint | null>(null);
  const [line, setLine] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reduce = useReduceMotion();
  const shrink = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    shrink.setValue(0);
    setError(null);
    (async () => {
      try {
        const [d, next] = await Promise.all([api.getGoal(goalId), getNextStep(goalId)]);
        if (!alive) return;
        const found = d.roadmap?.checkpoints.find((c) => c.id === checkpointId) ?? null;
        const oneLine = goLine(next, found?.title);
        setGoal(d.goal.text);
        setCp(found);
        setLine(oneLine);
        if (!oneLine) throw new Error('この一歩が見つかりません');
        // 一言を読む間 → 縮む動きと、集中を作るのを同時に
        await new Promise((r) => setTimeout(r, reduce ? 0 : GO_SAY_MS));
        if (!alive) return;
        const moved = new Promise<void>((r) =>
          reduce ? r() : Animated.timing(shrink, { toValue: 1, duration: GO_SHRINK_MS, useNativeDriver: false }).start(() => r()),
        );
        const s = await api.startSession({ goalId, checkpointId, oneLine });
        await rememberSession(s.id, { goalId, checkpointId });
        focusTracker.begin(s.id, s.startedAt);
        await setNextStep(goalId, null);
        if (await focusLock.isAvailable()) await focusLock.start();
        await moved;
        if (alive) router.replace(short === '1' ? `/focus/${s.id}?shortStart=1` : `/focus/${s.id}`);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, checkpointId, attempt]);

  // 地: 紙色 → 集中の色。カード: 上の帯の高さへ縮み、薄くなる
  const bg = shrink.interpolate({ inputRange: [0, 1], outputRange: [color.bg, color.bgFocus] });
  const cardMove = {
    opacity: shrink.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.6, 0] }),
    transform: [
      { translateY: shrink.interpolate({ inputRange: [0, 1], outputRange: [0, -90] }) },
      { scale: shrink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }) },
    ],
  };

  return (
    <Animated.View style={[styles.root, { backgroundColor: bg }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <SceneTop scene="home" />
        {line ? <AgentSays {...startTalkGo(line)} chat testID="start-molty" /> : null}
        {cp ? (
          <Animated.View style={[styles.card, cardMove]} testID="start-card">
            <Text style={styles.k}>{COPY_CARD_GOAL}</Text>
            <Text style={styles.v} numberOfLines={2}>
              {goal}
            </Text>
            {/* タスク（取り込んだ課題）は一歩の名前が題と同じなので繰り返さない */}
            {line !== goal ? (
              <>
                <Text style={[styles.k, styles.kGap]}>{COPY_CARD_STEP}</Text>
                <Text style={styles.vMain} numberOfLines={2}>
                  {line}
                </Text>
              </>
            ) : null}
          </Animated.View>
        ) : null}
        <ErrorBox text={error} onRetry={() => setAttempt((n) => n + 1)} />
        {error ? (
          <View style={styles.center}>
            <TextLink label="ホームに戻る" onPress={() => router.dismissTo('/')} testID="start-back" />
          </View>
        ) : null}
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: space.lg, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.line,
    borderRadius: radius.card,
    padding: space.lg,
  },
  k: { fontSize: font.small, color: color.muted, fontWeight: '700' },
  kGap: { marginTop: space.md },
  v: { fontSize: font.large - 2, color: color.text, fontWeight: '700', marginTop: 2 },
  vMain: { fontSize: font.large, color: color.text, fontWeight: '800', marginTop: 2 },
  center: { flexDirection: 'row', justifyContent: 'center' },
});
