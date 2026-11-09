// 足す（準備のフローの 1 場面目・#315）。モルティに話すと、目標と期限をカードに入れて見せる。
// 入口は 1 つ: 話す・打ち込む・見せる（クリップ）。課題の一覧を見せれば課題の取り込みへ、資料を見せればこの目標の資料になる。
// AI は目標を書かない（P1）: カードの目標は本人が話した文そのもの（期限の言い回しだけ抜く・押せば直せる）。
// 期限は画面の中で読み取る（サーバーに送らない）。読めない時は札で選ぶ（その場ですぐしたい操作は部品で・決定 11/9）。
// 1 日の時間は聞かない（#265・おまかせ）。「これで決める」で目標を作り、そのまま道を決める場面へ。

import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorText } from '../../api';
import { AgentSays } from '../../components/AgentSays';
import { MaterialsField } from '../../components/MaterialsField';
import { MoltyDock } from '../../components/MoltyDock';
import { SceneTop } from '../../components/SceneTop';
import { BigButton, Card, Chip, ErrorLine, Field, RiseIn, Screen, TextLink } from '../../components/ui';
import { addDecided, addDeadlineSet, addHeard, addIntro, addMaterialsIn, type AgentLine } from '../../lib/agentLines';
import {
  COPY_ADD_DEADLINE_PICK,
  COPY_ADD_EMPTY,
  COPY_ADD_MATERIALS_EMPTY,
  COPY_CARD_DEADLINE,
  COPY_CARD_GOAL,
  COPY_CARD_MATERIALS,
  COPY_CLOSE,
  COPY_DECIDE,
  COPY_PREP_QUIT,
  COPY_SHOW_MATERIALS,
  COPY_SHOW_MATERIALS_SUB,
  COPY_SHOW_TASKS,
  COPY_SHOW_TASKS_SUB,
} from '../../lib/copy';
import { ADD_TO_PLAN_MS, DEADLINE_CHIPS, goalFromSaid, heardDeadline, onlyDeadline } from '../../lib/deadlineSpeech';
import { deadlineFromDays, formatDeadline } from '../../lib/goalForm';
import { tap } from '../../lib/haptics';
import { useTabTitle } from '../../lib/tabTitle';
import { color, font, radius, space, touch } from '../../theme';

const GOAL_MAX = 500;

export default function AddGoal() {
  useTabTitle('目標を足す');
  const [goal, setGoal] = useState('');
  const [editGoal, setEditGoal] = useState(false);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [pickDeadline, setPickDeadline] = useState(false);
  const [materials, setMaterials] = useState('');
  const [matOpen, setMatOpen] = useState(false);
  const [showing, setShowing] = useState(false);
  const [mine, setMine] = useState<string | null>(null);
  const [line, setLine] = useState<AgentLine>(addIntro());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (d: Date) => formatDeadline(d);

  // 話した（打ち込んだ）文をカードに入れる。期限だけの言い直しなら、目標は変えない
  function hear(said?: string) {
    const s = (said ?? text).trim();
    if (!s) return;
    setText('');
    setMine(s);
    setError(null);
    const h = heardDeadline(s);
    if (goal && h && onlyDeadline(s, h)) {
      setDeadline(h.date);
      setPickDeadline(false);
      setLine(addDeadlineSet(label(h.date)));
      return;
    }
    const g = goalFromSaid(s, h).slice(0, GOAL_MAX) || s.slice(0, GOAL_MAX);
    setGoal(g);
    setEditGoal(false);
    const d = h?.date ?? deadline;
    if (h) setDeadline(h.date);
    setPickDeadline(!d);
    setLine(addHeard(g, d ? label(d) : null));
  }

  function chooseDays(days: number) {
    const d = deadlineFromDays(days);
    setDeadline(d);
    setPickDeadline(false);
    setLine(addDeadlineSet(label(d)));
  }

  async function decide() {
    if (!goal.trim() || !deadline) return;
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGoal({ text: goal.trim(), deadline: deadline.toISOString() });
      // 資料は目標の資料として残す（タスクの間ずっと見返し・直せる・11/9）。失敗しても目標は作ったまま進める
      if (materials.trim()) await api.addGoalDoc(g.id, { text: materials.trim(), from: 'goal' }).catch(() => undefined);
      setMine(null);
      setLine(addDecided());
      setLeaving(true);
      setTimeout(() => router.replace(`/plan/${g.id}`), ADD_TO_PLAN_MS);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const ready = goal.trim().length > 0 && deadline !== null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.top}>
        <SceneTop
          scene="add"
          right={<TextLink label={COPY_PREP_QUIT} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="add-quit" />}
        />
      </View>
      <Screen
        footerPlain
        footer={
          leaving ? undefined : (
            <MoltyDock
              text={text}
              setText={setText}
              busy={busy}
              send={hear}
              onShow={() => setShowing(true)}
              hint="例: 期末で 8 割。試験は来週の金曜"
              testID="add-dock"
            />
          )
        }
      >
        <View style={styles.hero} testID="add-molty">
          {mine ? (
            <Text style={styles.mine} numberOfLines={3} testID="add-mine">
              {mine}
            </Text>
          ) : null}
          <AgentSays {...line} chat waiting={busy && !leaving} done={leaving} testID="add-molty-says" />

          <Card style={styles.card}>
            <View testID="add-card">
              <Text style={styles.k}>{COPY_CARD_GOAL}</Text>
              {editGoal ? (
                <Field
                  value={goal}
                  onChangeText={(t) => setGoal(t.slice(0, GOAL_MAX))}
                  multiline
                  maxLength={GOAL_MAX}
                  accessibilityLabel={COPY_CARD_GOAL}
                  autoFocus
                  voice
                  testID="add-goal-input"
                />
              ) : goal ? (
                <Pressable accessibilityRole="button" accessibilityHint="押すと直せます" onPress={() => setEditGoal(true)} testID="add-goal">
                  <Text style={styles.v}>{goal}</Text>
                </Pressable>
              ) : (
                <Text style={styles.empty}>{COPY_ADD_EMPTY}</Text>
              )}

              <Text style={[styles.k, styles.kGap]}>{COPY_CARD_DEADLINE}</Text>
              {deadline && !pickDeadline ? (
                <Pressable accessibilityRole="button" accessibilityHint="押すと選び直せます" onPress={() => setPickDeadline(true)} testID="add-deadline">
                  <Text style={styles.v}>{label(deadline)}</Text>
                </Pressable>
              ) : goal ? (
                <View style={styles.chips} accessibilityLabel={COPY_ADD_DEADLINE_PICK} testID="add-deadline-chips">
                  {DEADLINE_CHIPS.map((c) => (
                    <Chip key={c.days} label={c.label} onPress={() => chooseDays(c.days)} testID={`add-days-${c.days}`} />
                  ))}
                </View>
              ) : (
                <Text style={styles.empty}>{COPY_ADD_EMPTY}</Text>
              )}

              <Text style={[styles.k, styles.kGap]}>{COPY_CARD_MATERIALS}</Text>
              {matOpen ? (
                <MaterialsField
                  label=""
                  value={materials}
                  onChange={(t) => {
                    if (!materials.trim() && t.trim()) setLine(addMaterialsIn());
                    setMaterials(t);
                  }}
                  testID="add-materials"
                />
              ) : materials.trim() ? (
                <Pressable accessibilityRole="button" onPress={() => setMatOpen(true)} style={styles.matChip} testID="add-materials-chip">
                  <Text style={styles.matChipText} numberOfLines={1}>
                    {`📄 ${materials.trim().split('\n')[0]}`}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.empty}>{COPY_ADD_MATERIALS_EMPTY}</Text>
              )}
            </View>
          </Card>

          {ready ? (
            <RiseIn>
              <BigButton label={COPY_DECIDE} busy={busy} disabled={leaving} onPress={() => void decide()} testID="add-decide" />
            </RiseIn>
          ) : null}
          <ErrorLine text={error} />
        </View>
      </Screen>

      {/* 見せる物を選ぶ（下から出る板）。課題の一覧 → 取り込み／資料 → この目標の資料 */}
      <Modal visible={showing} transparent animationType="slide" onRequestClose={() => setShowing(false)}>
        <Pressable style={styles.veil} onPress={() => setShowing(false)} accessibilityLabel={COPY_CLOSE} />
        <View style={styles.sheet} testID="add-show-sheet">
          <ShowOption
            title={COPY_SHOW_TASKS}
            sub={COPY_SHOW_TASKS_SUB}
            onPress={() => {
              setShowing(false);
              router.push('/goal/import');
            }}
            testID="add-show-tasks"
          />
          <ShowOption
            title={COPY_SHOW_MATERIALS}
            sub={COPY_SHOW_MATERIALS_SUB}
            onPress={() => {
              setShowing(false);
              setMatOpen(true);
            }}
            testID="add-show-materials"
          />
          <View style={styles.center}>
            <TextLink label={COPY_CLOSE} onPress={() => setShowing(false)} testID="add-show-close" />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ShowOption(props: { title: string; sub: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.title}
      onPress={() => {
        tap();
        props.onPress();
      }}
      style={({ pressed }) => [styles.opt, pressed && { opacity: 0.7 }]}
      testID={props.testID}
    >
      <Text style={styles.optTitle}>{props.title}</Text>
      <Text style={styles.optSub}>{props.sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.bg,
    width: '100%',
    overflow: 'hidden',
  },
  top: {
    paddingHorizontal: space.lg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  hero: { gap: space.lg, paddingTop: space.sm },
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
  k: { fontSize: font.small, color: color.muted, fontWeight: '700' },
  kGap: { marginTop: space.md },
  v: {
    fontSize: font.large - 2,
    color: color.text,
    fontWeight: '700',
    marginTop: 2,
  },
  empty: { fontSize: font.body, color: color.muted, marginTop: 2 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
  matChip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: touch.min,
    justifyContent: 'center',
    marginTop: space.xs,
  },
  matChipText: {
    fontSize: font.small,
    fontWeight: '800',
    color: color.primaryLip,
    backgroundColor: color.primarySoft,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  // 下から出る板（建物の考えポイントの板と同じ作り・幕の色は付けない）
  veil: { flex: 1 },
  sheet: {
    backgroundColor: color.bg,
    borderTopWidth: 2,
    borderColor: color.line,
    borderTopLeftRadius: radius.box,
    borderTopRightRadius: radius.box,
    padding: space.lg,
    paddingBottom: space.xxxl,
    gap: space.sm,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  opt: {
    minHeight: touch.min,
    padding: space.md,
    borderWidth: 1.5,
    borderColor: color.line,
    borderRadius: radius.box,
    backgroundColor: color.surface,
    gap: 2,
  },
  optTitle: { fontSize: font.body, fontWeight: '800', color: color.text },
  optSub: { fontSize: font.small, fontWeight: '700', color: color.muted },
});
