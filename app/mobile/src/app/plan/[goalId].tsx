// 進め方を比べて選ぶ。3 案を 1 つのレーダーに重ね、選ぶ・直す・自分で作る。理由を書くまで決められない（P1）。
// 直した中身は案ごとに、自分で作った中身は 1 つ、別々に持つ。レーダーの札で案を見比べても消えない。

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBlink } from '../../components/useBlink';
import {
  COPY_PLAN_MODE_LABEL,
  COPY_REMAKE_BUTTON,
  COPY_REMAKE_EXAMPLE,
  COPY_REMAKE_LABEL,
  COPY_WHY_FREE_LABEL,
  COPY_WHY_TAGS,
} from '../../lib/copy';
import { composeWhy, toggleTag } from '../../lib/whyCompose';
import { COLUMN_WIDTH } from '../../lib/navLayout';
import {
  candidatesBody,
  decideAction,
  decideRequest,
  decideTargetLine,
  emphasizedAt,
  modeAfterChoose,
  planLayoutFor,
  REMAKE_NOTE_MAX,
  selectionAfterRemake,
  showWhyRequired,
  WHY_EXAMPLE,
  WHY_REQUIRED,
} from '../../lib/planView';
import { api, errorText } from '../../api';
import type { AgentTurn } from '../../api/types';
import { pushTurns } from '../../components/MoltyPanel';
import { COPY_MOLTY_INPUT, COPY_ROADMAP_ASK_HINT, COPY_ROADMAP_ASK_SEND, copyPlanTab } from '../../lib/copy';
import type { Axis, Candidate, CheckpointInput, Goal } from '../../api/types';
import { RadarChart } from '../../components/RadarChart';
import { PlanRoad } from '../../components/PlanRoad';
import { GoalDocsSheet } from '../../components/GoalDocsSheet';
import { docsCount } from '../../lib/goalDocs';
import { COPY_DOCS_OPEN } from '../../lib/copy';
import { formatDeadline } from '../../lib/goalForm';
import { SceneTop } from '../../components/SceneTop';
import { COPY_PREP_QUIT } from '../../lib/copy';
import { AgentSays } from '../../components/AgentSays';
import { planTalk } from '../../lib/agentLines';
import { BigButton, Card, Chip, ErrorLine, Field, Label, Screen, ThinkingDots } from '../../components/ui';
import { axesForCandidates } from '../../lib/axes';
import { candidateName, candidateSummary } from '../../lib/candidateLabel';
import { editRatio, percent } from '../../lib/editRatio';
import { tap } from '../../lib/haptics';
import { axesFor, rememberAxes } from '../../lib/local';
import { DONE_MARK_MAX, STEPS_MAX, stepsProblem, TITLE_MAX } from '../../lib/roadmapLimits';
import { color, font, radius, space, touch } from '../../theme';

type Mode = 'pick' | 'edit' | 'own';

const toInput = (c: Candidate): CheckpointInput[] =>
  c.checkpoints.map(({ title, doneMark, estimateMin }) => ({ title, doneMark, estimateMin }));

// 欄の左の記号（文字のラベルは足さない）
const NAME_MARK = '◎';
const DONE_MARK = '✓';

// 見積りの分は本人に聞かない（#268）。新しい行は分を持たず、サーバー（Gemini）が決める
const blank = (): CheckpointInput => ({ title: '', doneMark: '' });

import { useTabTitle } from '../../lib/tabTitle';
import { Platform } from 'react-native';
import { TextLink } from '../../components/ui';
import { COPY_ADD_CALENDAR, COPY_GOAL_CALENDAR_REMOVE, copyGoalCalendarAdded, copyGoalCalendarRemoved } from '../../lib/copy';
import { calendarErrorText, showGoogleButton } from '../../lib/googleCalendar';
import { goalCalStore, removeGoalFromCalendar, savedEvents, syncGoalToCalendar } from '../../lib/goalCalendar';

export default function Plan() {
  useTabTitle('案から選ぶ');
  const { goalId } = useLocalSearchParams<{ goalId: string }>();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [axes, setAxes] = useState<Axis[]>([]);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('pick');
  // 直した中身（案の ID ごと）と、自分で作った中身
  const [edits, setEdits] = useState<Record<string, CheckpointInput[]>>({});
  const [own, setOwn] = useState<CheckpointInput[] | null>(null);
  const [why, setWhy] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // 理由が空のまま「これで決める」を押したか（押した後、書くまで欄の下に 1 行出す）
  const [pressedEmpty, setPressedEmpty] = useState(false);

  // 案への希望（#223）。画面の中だけに持ち、端末には保存しない
  const [note, setNote] = useState('');
  // モルティに頼んで道を直す（#262）。会話は画面の中だけ（端末にもサーバーにも残さない）
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [askReply, setAskReply] = useState<string | null>(null);
  const askHistory = useRef<AgentTurn[]>([]);
  // 「これにする」を押した後（理由を聞いている段）。理由を答えるとそのまま決まる（P1・理由は必須のまま）
  const [confirming, setConfirming] = useState(false);
  // 直した道を手で書き直す欄を開いたか（ふだんは読むだけの一覧。直すのはモルティに言う）
  const [manual, setManual] = useState(false);

  async function make(withNote?: string) {
    setThinking(true);
    setError(null);
    try {
      const r = await api.makeCandidates(goalId, withNote);
      void rememberAxes(goalId, r.axes);
      setAxes(r.axes);
      setCands(r.candidates);
      // 前の案の選択・直した中身は外す。「自分で作る」はそのまま。理由の札と欄は残す
      const cleared = selectionAfterRemake('pick');
      setSel(cleared.sel);
      setEdits(cleared.edits);
      setMode((m) => selectionAfterRemake(m).mode);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setThinking(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.getGoal(goalId);
        if (!alive) return;
        setGoal(d.goal);
        if (d.roadmap) {
          router.dismissTo('/');
          return;
        }
        if (d.candidates.length > 0) {
          // 案はもうある。作り直さない（Gemini の回数と予算を使わない・前に見た案のまま）
          const known = await axesFor(goalId);
          if (!alive) return;
          setAxes(known ?? axesForCandidates(d.candidates));
          setCands(d.candidates);
        } else {
          await make();
        }
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  const chosen = sel === null ? null : (cands[sel] ?? null);
  const draft: CheckpointInput[] =
    mode === 'edit' && chosen ? (edits[chosen.id] ?? toInput(chosen)) : mode === 'own' ? (own ?? []) : [];
  const ratio = useMemo(
    () => (mode === 'edit' && chosen ? editRatio(toInput(chosen), draft) : 0),
    [mode, chosen, draft],
  );
  const steps = mode === 'pick' ? (chosen ? toInput(chosen) : []) : draft;
  // そのまま採る時はサーバーが送られた checkpoints を見ないので、欄の検査をしない
  const problem = mode === 'pick' ? null : stepsProblem(steps);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const { width } = useWindowDimensions();
  const layout = planLayoutFor(width);

  // 直す・自分で作るの中身だけを変える（そのままの案には触らない）
  function setDraft(fn: (d: CheckpointInput[]) => CheckpointInput[]) {
    if (mode === 'edit' && chosen) {
      const id = chosen.id;
      const base = toInput(chosen);
      setEdits((e) => ({ ...e, [id]: fn(e[id] ?? base) }));
    } else if (mode === 'own') {
      setOwn((o) => fn(o ?? []));
    }
  }

  // 案がそろったら 1 つ目のタブを開いておく（見るだけ。決めるのは「これにする」と理由・P1）
  useEffect(() => {
    if (mode === 'pick' && sel === null && cands.length > 0 && !thinking) setSel(0);
  }, [mode, sel, cands.length, thinking]);

  // レーダーの札: 見比べる案を変えるだけ。直した中身・自分で作った中身は消さない
  function choose(i: number) {
    if (i !== sel) setAskReply(null);
    setConfirming(false);
    setSel(i);
    setMode(modeAfterChoose());
  }

  function startEdit() {
    if (!chosen) return;
    setMode('edit');
  }

  // モルティに頼む: いまの道（そのまま＝案の中身／直す・自分で作る＝欄の中身）を送り、返った下書きを欄に入れる。
  // そのままの案を頼んで直した時は「直す」に切り替わる（直した割合が出る）。確定は「これで決める」だけ（P1）
  async function askMolty() {
    const message = ask.trim();
    if (!message || asking || (mode === 'pick' && !chosen)) return;
    const base = mode === 'pick' && chosen ? toInput(chosen) : draft;
    setAsking(true);
    try {
      const r = await api.roadmapChat(goalId, { message, draft: base, history: askHistory.current });
      askHistory.current = pushTurns(askHistory.current, { from: 'me', text: message }, { from: 'agent', text: r.reply });
      if (mode === 'own') setOwn(r.draft);
      else if (chosen) {
        const id = chosen.id;
        setEdits((e) => ({ ...e, [id]: r.draft }));
        setMode('edit');
      }
      setAskReply(r.reply);
      setAsk('');
    } catch (e) {
      setAskReply(errorText(e));
    } finally {
      setAsking(false);
    }
  }

  function startOwn() {
    if (own === null) setOwn([blank(), blank(), blank()]);
    setMode('own');
  }

  function update(i: number, patch: Partial<CheckpointInput>) {
    setDraft((d) => d.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function move(i: number, by: number) {
    setDraft((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      const a = next[i]!;
      next[i] = next[j]!;
      next[j] = a;
      return next;
    });
  }

  // 理由を言って決める（理由の札を押す・一言書く）。直した道に問題があれば決めずにモルティが言う
  async function decideWith(whyText: string) {
    const w = whyText.trim();
    if (!w || busy) return;
    if (mode !== 'pick' && problem) {
      setConfirming(false);
      setAskReply(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decideRoadmap(goalId, decideRequest({ mode, chosen, ratio, steps, why: w }));
      router.dismissTo('/');
    } catch (e) {
      setAskReply(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // 話しかける欄 1 つで進める: 理由を聞いている段＝その文で決める／案を選んだ・自分で作る＝道を直す／まだ選んでいない＝案を出し直す
  async function sendTalk() {
    const message = ask.trim();
    if (!message || asking || busy || thinking) return;
    if (confirming) {
      setAsk('');
      await decideWith(message);
      return;
    }
    if (chosen || mode === 'own') {
      await askMolty();
      return;
    }
    setAsk('');
    await make(candidatesBody(message).note);
    setAskReply('希望に合わせて、案を出し直しました。気になる案を押してください。');
  }

  // 目標の期限を Google カレンダーに入れる（#291）。決める前の主役ではないので一番下へ
  const calendar = goal ? <GoalCalendarButton goal={goal} steps={chosen?.checkpoints ?? []} /> : null;

  const ratioBar =
    mode === 'edit' ? (
      <View style={styles.ratioBar}>
        <Text style={styles.ratio} testID="edit-ratio">{`直した割合 ${percent(ratio)}`}</Text>
      </View>
    ) : null;

  // 上の帯（準備のフロー・足す → 道を決めるの 2 本目・#315）。やめるとホームへ（目標は残る）
  const sceneTop = (
    <View style={styles.sceneTop}>
      {goal && docsOpen ? (
        <GoalDocsSheet goal={goal} from="plan" visible onClose={() => setDocsOpen(false)} onChange={(docs) => setGoal({ ...goal, docs })} />
      ) : null}
      <SceneTop scene="plan" right={<TextLink label={COPY_PREP_QUIT} onPress={() => router.dismissTo('/')} testID="plan-quit" />} />
    </View>
  );

  const head = (
    <>
      {goal ? <Text style={styles.goal}>{goal.text}</Text> : null}
      {/* 目標の資料（道を決める時にも足せる・案づくりと相談でモルティが使う・11/9） */}
      {goal ? (
        <Pressable accessibilityRole="button" onPress={() => setDocsOpen(true)} style={styles.docChip} testID="plan-docs">
          <Text style={styles.docChipText}>{docsCount(goal) > 0 ? `📄 ${COPY_DOCS_OPEN} ${docsCount(goal)}` : `＋ ${COPY_DOCS_OPEN}`}</Text>
        </Pressable>
      ) : null}
      {error && cands.length === 0 && !thinking ? <BigButton label="もう一度" variant="plain" onPress={() => make()} /> : null}
      {/* 案が無い時（作っている途中・失敗した時）も、自分で作る道は閉じない（P1） */}
      {cands.length === 0 && mode !== 'own' ? (
        <BigButton label="自分で作る" variant="plain" onPress={startOwn} testID="own-without-candidates" />
      ) : null}
    </>
  );

  const radar =
      cands.length > 0 && axes.length >= 3 ? (
        <Card>
          <RadarChart
            axes={axes}
            series={cands.map((c, i) => ({
              id: c.id,
              values: c.axes,
              color: color.series[i % color.series.length]!,
              emphasized: emphasizedAt(sel, i),
            }))}
          />
        </Card>
      ) : null;

  // 案の切り替え（11/9 本人）: 上に横のタブ（案 1・2・3 と色の印だけ）。押した案の名前を下に全文で大きく出し、
  // レーダーでその案を強く描き、その案の道（チェックポイント）を続けて見せる。名前は小さな枠に詰めない
  const cards =
      cands.length > 0 ? (
        <View style={styles.tabs} testID="candidate-cards" accessibilityRole="tablist">
          {cands.map((c, i) => {
            const on = i === sel;
            const tint = color.series[i % color.series.length]!;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${copyPlanTab(i)}: ${candidateName(c, i)}`}
                testID={`candidate-${i}`}
                onPress={() => {
                  tap();
                  choose(i);
                }}
                style={[styles.tab, on && { borderColor: tint, backgroundColor: color.surface }]}
              >
                <View style={[styles.swatch, { backgroundColor: tint }]} />
                <Text style={[styles.tabName, on && styles.tabNameOn]}>{copyPlanTab(i)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null;

  // 選んだタブの案の名前（全文）と一言
  const chosenHead =
      mode === 'pick' && chosen && sel !== null ? (
        <View style={styles.chosenHead} testID="candidate-title">
          <View style={styles.chosenRow}>
            <View style={[styles.swatchBig, { backgroundColor: color.series[sel % color.series.length]! }]} />
            <Text style={styles.chosenName}>{candidateName(chosen, sel)}</Text>
          </View>
          {candidateSummary(chosen) ? (
            <Text style={styles.summary} testID="candidate-summary">
              {candidateSummary(chosen)}
            </Text>
          ) : null}
        </View>
      ) : null;

  // 話す場所（UI 刷新 2・11/9 本人「選ぶ部品を並べず、モルティと話して決める」）。
  // モルティの言葉 → 次の 1 手（「これにする」か理由の札）→ 話しかける欄 → 小さなリンク の順
  const talkLine = askReply
    ? { text: askReply, short: askReply }
    : planTalk({
        thinking,
        count: cands.length,
        mode,
        chosenName: chosen && sel !== null ? candidateName(chosen, sel) : null,
        steps: steps.length,
        confirming,
      });
  const canPick = !!chosen || mode === 'own';
  const talk = (
    <View style={styles.talk} testID="plan-talk">
      <AgentSays
        {...talkLine}
        waiting={thinking || asking || busy}
        popKey={`${askReply ?? ''}:${mode}:${sel}:${confirming}:${thinking}`}
        testID="plan-molty"
      />
      <ErrorLine text={error} />
      {/* 理由は札を並べず、話すか一言で答える（P1 の理由は必須のまま・11/9 本人「いっぱい候補を並べるのはやめる」） */}
      {confirming ? null : canPick && !thinking ? (
        <BigButton
          label="これにする"
          disabled={asking}
          onPress={() => {
            setAskReply(null);
            setConfirming(true);
          }}
          testID="decide"
        />
      ) : null}
      {cands.length > 0 || mode === 'own' ? (
        <View style={{ gap: space.sm }} testID="roadmap-ask">
          <Field
            label={COPY_MOLTY_INPUT}
            value={ask}
            onChangeText={setAsk}
            placeholder={confirming ? WHY_EXAMPLE : canPick ? COPY_ROADMAP_ASK_HINT : COPY_REMAKE_EXAMPLE}
            maxLength={300}
            returnKeyType="send"
            onSubmitEditing={() => void sendTalk()}
            voice
            testID="roadmap-ask-input"
          />
          {ask.trim() ? (
            <BigButton
              label={confirming ? 'これで決める' : COPY_ROADMAP_ASK_SEND}
              variant="plain"
              size="small"
              busy={asking || busy || thinking}
              onPress={() => void sendTalk()}
              testID="roadmap-ask-send"
            />
          ) : null}
        </View>
      ) : null}
      <View style={styles.links}>
        {confirming ? <TextLink label="もう少し考える" onPress={() => setConfirming(false)} testID="talk-back" /> : null}
        {mode === 'edit' && !manual ? <TextLink label="自分で書き直す" onPress={() => setManual(true)} testID="manual-edit" /> : null}
        {mode !== 'own' && cands.length > 0 ? <TextLink label="自分で作る" onPress={startOwn} testID="mode-own" /> : null}
      </View>
    </View>
  );

  const content = (
    <>
      {(mode === 'pick' && chosen) || (mode === 'edit' && !manual) ? (
        // その案（直した道）を、ホームと同じ道の絵で。日付は付けず、最後に期限の旗だけ（決定 11/9）
        <View style={styles.steps} testID="plan-steps">
          <PlanRoad
            steps={steps}
            deadlineLabel={goal ? formatDeadline(new Date(goal.deadline)) : null}
            tint={mode === 'pick' && sel !== null ? color.series[sel % color.series.length]! : color.primary}
          />
        </View>
      ) : null}

      {mode === 'own' || (mode === 'edit' && manual) ? (
        <View style={styles.list}>
          {draft.map((s, i) => (
            <Card key={i} style={styles.editCard}>
              <View style={styles.editHead}>
                <Text style={styles.stepNo}>{i + 1}</Text>
                <View style={styles.editTools}>
                  <Tool label="↑" onPress={() => move(i, -1)} disabled={i === 0} />
                  <Tool label="↓" onPress={() => move(i, 1)} disabled={i === draft.length - 1} />
                  <Tool label="×" onPress={() => setDraft((d) => d.filter((_, j) => j !== i))} disabled={draft.length <= 1} />
                </View>
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.mark}>{NAME_MARK}</Text>
                <View style={{ flex: 1 }}>
                  <Field value={s.title} onChangeText={(t) => update(i, { title: t })} placeholder="やること" maxLength={TITLE_MAX} accessibilityLabel="やること" />
                </View>
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.mark}>{DONE_MARK}</Text>
                <View style={{ flex: 1 }}>
                  <Field value={s.doneMark} onChangeText={(t) => update(i, { doneMark: t })} placeholder="完了の目印" maxLength={DONE_MARK_MAX} accessibilityLabel="完了の目印" />
                </View>
              </View>
            </Card>
          ))}
          {draft.length < STEPS_MAX ? (
            <BigButton label="＋ 足す" variant="plain" onPress={() => setDraft((d) => [...d, blank()])} />
          ) : null}
        </View>
      ) : null}

      {problem && (mode === 'own' || manual) ? <ErrorLine text={problem} /> : null}
    </>
  );

  if (layout.columns === 2) {
    // PC: 左にレーダーと案の札、右に案の中身。右の列の下に理由の欄とボタンを固定する（各列が別々に流れる）
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
        {sceneTop}
        <View style={styles.wideRow} testID="plan-columns-2">
          <ScrollView style={styles.wideCol} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
            {head}
            {cards}
            {chosenHead}
            {radar}
            {calendar}
          </ScrollView>
          <View style={[styles.wideCol, styles.wideRight]}>
            {ratioBar}
            <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
              {content}
              {talk}
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // スマホ: 下に固定のボタンは置かない。比べる（札とレーダー）→ 中身 → モルティと話す の 1 本の流れ
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    {sceneTop}
    <Screen scroll={false}>
      {/* Screen の余白を打ち消し、直した割合を上端に固定する。下の ScrollView だけが流れる */}
      <View style={styles.pane} testID="plan-columns-1">
        {ratioBar}
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
          {head}
          {cards}
          {chosenHead}
          {radar}
          {content}
          {talk}
          {calendar}
        </ScrollView>
      </View>
    </Screen>
    </SafeAreaView>
  );
}

// 記号だけの札なので、読み上げ用の名前を付ける
const TOOL_NAME: Record<string, string> = { '↑': '上へ', '↓': '下へ', '×': '消す' };

function Tool(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={TOOL_NAME[props.label] ?? props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={() => {
        tap();
        props.onPress();
      }}
      style={[styles.tool, props.disabled && { opacity: 0.3 }]}
    >
      <Text style={styles.toolText}>{props.label}</Text>
    </Pressable>
  );
}

// 目標の期限（とステップの日）を Google カレンダーに入れる（#291・Web・押した時だけ）
function GoalCalendarButton(props: { goal: Goal; steps: { id: string; title: string }[] }) {
  const [clientId, setClientId] = useState<string | null>(null); // 公開の値（秘密ではない）
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const goalId = props.goal.id;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    api.config().then((c) => alive && setClientId(c.googleClientId), () => {});
    void savedEvents(goalCalStore, goalId).then((s) => alive && setSaved(Object.keys(s).length));
    return () => {
      alive = false;
    };
  }, [goalId]);
  if (!showGoogleButton(Platform.OS, clientId)) return null;
  async function run(remove: boolean) {
    if (!clientId || busy) return;
    setBusy(true);
    setErr(null);
    setLine(null);
    const deps = { clientId, store: goalCalStore };
    try {
      const r = remove ? await removeGoalFromCalendar(goalId, deps) : await syncGoalToCalendar(props.goal, props.steps, deps);
      setLine(remove ? copyGoalCalendarRemoved(r.count) : copyGoalCalendarAdded(r.count));
    } catch (e) {
      setErr(calendarErrorText(e, 'write'));
    } finally {
      setSaved(Object.keys(await savedEvents(goalCalStore, goalId)).length);
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: space.xs }}>
      <BigButton label={COPY_ADD_CALENDAR} variant="plain" busy={busy} onPress={() => void run(false)} testID="goal-calendar" />
      {line ? <Text style={styles.targetLine}>{line}</Text> : null}
      <ErrorLine text={err} />
      {saved > 0 ? <TextLink label={COPY_GOAL_CALENDAR_REMOVE} onPress={() => void run(true)} testID="goal-calendar-remove" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 長い文は語の切れ目で折り返す（語の途中で切らない）
  goal: { fontSize: font.large, fontWeight: '800', color: color.text, ...({ wordBreak: 'auto-phrase' } as object) },
  // 案の札は縦に 1 枚ずつ。幅いっぱいを使い、文は折り返す（行数の制限なし・#268）
  talk: { gap: space.md, paddingTop: space.sm },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  tabs: { flexDirection: 'row', gap: space.sm },
  chosenHead: { gap: space.xs },
  chosenRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  swatchBig: { width: 14, height: 14, borderRadius: radius.full, marginTop: 8 },
  chosenName: { flex: 1, minWidth: 0, fontSize: font.large, fontWeight: '900', color: color.text, ...({ wordBreak: 'auto-phrase' } as object) },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.box,
    borderWidth: 2,
    borderColor: color.line,
    backgroundColor: color.surfaceSunk,
  },
  tabName: { fontSize: font.body, fontWeight: '700', color: color.muted, ...({ wordBreak: 'auto-phrase' } as object) },
  tabNameOn: { color: color.text, fontWeight: '900' },
  cards: { gap: space.sm },
  candCard: {
    gap: space.xs,
    borderWidth: 2,
    borderColor: color.line,
    borderRadius: radius.box,
    backgroundColor: color.surface,
    padding: space.md,
    minHeight: touch.min,
  },
  candHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 12, height: 12, borderRadius: radius.full },
  candName: { flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '900', color: color.text, ...({ wordBreak: 'auto-phrase' } as object) },
  candSummary: { fontSize: font.small, color: color.text, ...({ wordBreak: 'auto-phrase' } as object) },
  candCount: { fontSize: font.small, fontWeight: '700', color: color.muted },
  summary: { fontSize: font.body, fontWeight: '700', color: color.text },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chipIdle: { opacity: 0.4 },
  targetLine: { fontSize: font.small, fontWeight: '700', color: color.text, textAlign: 'center' },
  ratio: { fontSize: font.title, fontWeight: '900', color: color.primary },
  // Screen（scroll=false）の body の余白を打ち消し、同じ余白を中の ScrollView に移す
  pane: { flex: 1, margin: -space.lg },
  // PC の 2 列: 1 列の幅（560）を 2 つ並べ、画面の中央に置く
  screen: { flex: 1, backgroundColor: color.bg },
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
  sceneTop: { paddingHorizontal: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  wideRow: { flex: 1, flexDirection: 'row', width: '100%', maxWidth: COLUMN_WIDTH * 2, alignSelf: 'center' },
  wideCol: { flex: 1, minWidth: 0 },
  wideRight: { borderLeftWidth: 1, borderLeftColor: color.line },
  wideFooter: {
    gap: space.sm,
    padding: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
    backgroundColor: color.bg,
  },
  scrollBody: { padding: space.lg, gap: space.lg },
  ratioBar: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mark: { width: space.lg, textAlign: 'center', fontSize: font.large, fontWeight: '900', color: color.primary },
  list: { gap: space.sm },
  // 案の中身は札を並べず、1 枚の中に区切り線で並べる
  steps: {
    backgroundColor: color.surface,
    borderWidth: 2,
    borderColor: color.line,
    borderRadius: radius.box,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  stepDivider: { borderTopWidth: 1, borderTopColor: color.line },
  stepNo: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: color.primarySoft,
    color: color.primary,
    textAlign: 'center',
    lineHeight: 32,
    fontWeight: '900',
    overflow: 'hidden',
  },
  // タイトルと完了の目印は全文を折り返す（行数の制限なし・#268）
  stepTitle: { fontSize: font.body, fontWeight: '700', color: color.text, ...({ wordBreak: 'auto-phrase' } as object) },
  stepMark: { fontSize: font.small, color: color.muted, ...({ wordBreak: 'auto-phrase' } as object) },
  // 点滅用の枠。枠と余白の分だけ外へ出して、中の欄の左端を他の欄に合わせる
  whyTags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  whyFrame: { borderWidth: 2, borderRadius: radius.box, padding: space.xs, margin: -(2 + space.xs) },
  editCard: { padding: space.md, gap: space.sm },
  editHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editTools: { flexDirection: 'row', gap: space.xs },
  tool: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color.edge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: { fontSize: font.large, fontWeight: '800', color: color.primary },
});
