// 振り返り（#315・対話の形）。モルティが聞く → 話す（声は文字にして「できたこと」へ）か写真 → モルティに見てもらう
// → モルティの見立てと、自分の判定（決めるのは本人・P1）→ 次の一歩（話すか候補から）→ これで決める
// → モルティが評価し、建物の横で窓が灯ったことを伝える。場面の帯（振り返り）・下に大きなマイク。

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Image, Pressable, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SceneTop } from '../../components/SceneTop';
import { transcribeErrorText } from '../../lib/voiceFill';
import { api, errorText } from '../../api';
import type { Achievement, Floor, Goal, ReflectResult } from '../../api/types';
import { GoalDocsSheet } from '../../components/GoalDocsSheet';
import { docsChipText, pickGoal } from '../../lib/goalDocs';
import { Tower } from '../../components/Tower';
import { canRecord, VoiceButton, type Voice } from '../../components/VoiceButton';
import { audioTooBig, withAudio } from '../../lib/voice';
import { buildFit } from '../../lib/buildFit';
import { showLater } from '../../lib/voiceHint';
import {
  COPY_ADD_SOURCE,
  COPY_CARD_NEXT,
  COPY_CARD_STEP,
  COPY_DECIDE,
  COPY_DOCS_OPEN,
  COPY_JUDGE,
  COPY_MOLTY_VIEW,
  COPY_MY_VIEW,
  COPY_REFLECT_DONE,
  COPY_REFLECT_DONE_EMPTY,
  COPY_REFLECT_HINT_DONE,
  COPY_REFLECT_HINT_NEXT,
  COPY_REFLECT_NEXT_EMPTY,
  COPY_REFLECT_HINT_STUCK,
  COPY_REFLECT_STUCK,
  COPY_REFLECT_STUCK_EMPTY,
  COPY_REVISE_OPEN,
  COPY_TO_TODAY,
  COPY_PICK_PHOTO,
  COPY_VERDICT,
} from '../../lib/copy';
import { BigButton, Card, Chip, ErrorLine, Field, TextLink, ThinkingDots } from '../../components/ui';
import { MAX_REFLECT_BODY_BYTES, reflectBodyBytes } from '../../lib/bodySize';
import { useFlowGuard } from '../../lib/flowGuard';
import { builtLine, REFLECT_ASK, REFLECT_STUCK_ASK, reflectPick, reviseOffer } from '../../lib/agentLines';
import { jstDayKey, shouldOfferRevise } from '../../lib/roadmapRevise';
import { AgentSays, MoltyStand } from '../../components/AgentSays';
import { MicRow } from '../../components/MoltyDock';
import { litByColor } from '../../lib/buildFit';
import { success, tap } from '../../lib/haptics';
import { focusMemos, goalForSession, memoNote, rememberReviseOffer, reviseOfferedOn, setNextStep } from '../../lib/local';
import { canUseCamera, MAX_PHOTOS, pickPhotos, preparePhoto, type Photo } from '../../lib/photo';
import { levelWord, nextStepOnJudge } from '../../lib/reflectView';
import { color, font, radius, space, touch } from '../../theme';

const LEVELS: Achievement[] = [0, 1, 2, 3];

// choose: 資料が空のまま「AI に見てもらう」を押した時。AI を呼ばずに本人が選ぶ段
// stuck: 見てもらう前に、手が止まった所を 1 問だけ聞く段（P8・11/9 本人 A）。答えなくても進める
type Phase = 'input' | 'stuck' | 'judging' | 'choose' | 'result' | 'build';

import { useTabTitle } from '../../lib/tabTitle';

// 階を積んだ後のモルティの一言と評価の札の高さ。建物の高さから引く
const AGENT_ROW_H = 150;
// 場面の帯・下のボタン・余白の分
const BUILD_CHROME_H = 180;
// 見直しの持ちかけ（モルティの一言とボタン）の分
const REVISE_OFFER_H = 140;

export default function Reflect() {
  useTabTitle('振り返る');
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [phase, setPhase] = useState<Phase>('input');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [shrinking, setShrinking] = useState(false);
  const [voice, setVoice] = useState<Voice | null>(null);
  const [note, setNote] = useState('');
  const [materials, setMaterials] = useState('');
  const [stuckNote, setStuckNote] = useState(''); // 手が止まった所（一言・任意）
  const [stuckAsked, setStuckAsked] = useState(false); // 1 問は 1 回だけ聞く（送れずに戻った時は聞き直さない）
  const [result, setResult] = useState<ReflectResult | null>(null);
  const [mine, setMine] = useState<Achievement | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [towerFloors, setTowerFloors] = useState<Floor[]>([]);
  const [towerTotal, setTowerTotal] = useState(0);
  const [towerStreak, setTowerStreak] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [lastSaid, setLastSaid] = useState<string | null>(null); // 直前に話した言葉（自分の吹き出し）
  const [typing, setTyping] = useState(!canRecord()); // 打ち込む欄（声を録れない端末でははじめから出す）
  const [oneLine, setOneLine] = useState<string | null>(null); // 今日の一歩（集中を始めた時の一行）
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null); // マイクのエラー（写真の列の直下に出す。次の画面へは持ち越さない）
  const [goalId, setGoalId] = useState<string | null>(null);
  const [docsGoal, setDocsGoal] = useState<Goal | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [doneMark, setDoneMark] = useState<string | null>(null);
  const [leaveCount, setLeaveCount] = useState(0);
  const blink = useRef(new Animated.Value(0)).current;
  const { height: screenH } = useWindowDimensions(); // 階を積む段で、建物に出す階数を決める
  useFlowGuard(phase !== 'build'); // 階を積んだら（確定したら）流れは終わり
  // 階を積んだ後、遅れ・先行の時だけロードマップの見直しを持ちかける（#359・その目標に 1 日 1 回）
  const [offer, setOffer] = useState<{ goalId: string; pace: 'behind' | 'ahead' } | null>(null);
  const offerGoalId = goalId ?? docsGoal?.id ?? null;
  useEffect(() => {
    if (phase !== 'build' || !offerGoalId) return;
    let alive = true;
    const today = jstDayKey(Date.now());
    Promise.all([api.getGoal(offerGoalId), reviseOfferedOn(offerGoalId)])
      .then(async ([d, last]) => {
        if (!alive || !shouldOfferRevise(d.pace, last, today)) return;
        setOffer({ goalId: offerGoalId, pace: d.pace });
        await rememberReviseOffer(offerGoalId, today);
      })
      .catch(() => {}); // 取れなくても、今までどおりホームへ戻れる
    return () => {
      alive = false;
    };
  }, [phase, offerGoalId]);

  useEffect(() => {
    goalForSession(sessionId).then(setGoalId).catch(() => setGoalId(null));
  }, [sessionId]);

  // メモ欄の初期値は、集中中に端末へ残したメモ（直せる。無ければ空のまま。先に書いた文は消さない）
  useEffect(() => {
    focusMemos(sessionId)
      .then((m) => {
        if (m.length > 0) setNote((cur) => cur || memoNote(m));
      })
      .catch(() => {});
  }, [sessionId]);

  // 「使った資料」の初期値は、その集中を始める時に入れた資料（直せる）。取れなくても振り返りは続けられる
  useEffect(() => {
    let alive = true;
    const localGoal = goalForSession(sessionId).catch(() => null);
    Promise.all([api.home(), localGoal])
      .then(([h, localGoalId]) => {
        const ses = h.toReflect.find((s) => s.id === sessionId);
        const m = ses?.materials;
        if (alive && m) setMaterials((cur) => cur || m);
        if (alive && ses) setLeaveCount(ses.leaveCount);
        if (alive && ses?.oneLine) setOneLine(ses.oneLine);
        const g = pickGoal(h.goals, ses?.goalId ?? localGoalId);
        if (alive && g) setDocsGoal(g);
        const mark = h.goals
          .find((g) => g.goal.id === ses?.goalId)
          ?.roadmap?.checkpoints.find((c) => c.id === ses?.checkpointId)?.doneMark;
        if (alive && mark) setDoneMark(mark);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Android の戻るキー: 階を積んだ後と、送れなかった後（ホームの入口から戻れる）はホームへ。それ以外は止める
  const canLeave = phase === 'build' || (phase === 'input' && error !== null);
  useEffect(() => {
    // 戻るキーは Android だけ（Web の BackHandler は何もせずにエラーを出す）
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canLeave) router.dismissTo('/');
      return true;
    });
    return () => sub.remove();
  }, [canLeave]);

  async function addPhotos(mode: 'camera' | 'library') {
    setError(null);
    try {
      const picked = await pickPhotos(mode, MAX_PHOTOS - photos.length);
      if (picked.length === 0) return;
      setShrinking(true);
      const ready: Photo[] = [];
      for (const p of picked) ready.push(await preparePhoto(p));
      setPhotos((ps) => [...ps, ...ready].slice(0, MAX_PHOTOS));
    } catch {
      setError('写真を読めませんでした');
    } finally {
      setShrinking(false);
    }
  }

  // 押せない時、足りない欄の枠を点滅させる
  function flash() {
    blink.setValue(0);
    Animated.sequence(
      [0, 1, 2].map(() =>
        Animated.sequence([
          Animated.timing(blink, { toValue: 1, duration: 200, useNativeDriver: false }),
          Animated.timing(blink, { toValue: 0, duration: 200, useNativeDriver: false }),
        ]),
      ),
    ).start();
  }

  async function judge() {
    setError(null);
    // 材料が空なら AI を呼ばず、自分で選ぶ段へ
    if (nextStepOnJudge({ photoCount: photos.length, note }) === 'choose') {
      setPhase('choose');
      return;
    }
    // 見てもらう前に 1 問だけ（手が止まった所）。答えなくても、もう一度押せば見てもらえる
    if (!stuckAsked) {
      setStuckAsked(true);
      setMicError(null);
      setTyping(!canRecord());
      setLastSaid(null);
      setPhase('stuck');
      return;
    }
    const body = withAudio({
      note: note.trim(),
      // 【仮】契約にはまだ done がある。完了は判定（AI か本人の決め直し）が 3 かで決める案を出している（未決）。
      // それまでは本人の申告を送らない（申告だけで道が進むのを防ぐ）。
      done: false,
      images: photos.map((p) => p.image),
      materials: materials.trim(),
      // 原因の種類は選ばせず（選ぶ物を並べない）、一言を「その他」として送る。一言から次の一歩の候補が返る
      ...(stuckNote.trim() ? { stuck: { cause: 'other' as const, note: clipStuck(stuckNote.trim()) } } : {}),
    }, voice?.audio ?? null);
    if (voice && audioTooBig(voice.audio)) {
      setError('音声が大きすぎます。短く話し直してください');
      return;
    }
    if (reflectBodyBytes(body) > MAX_REFLECT_BODY_BYTES) {
      setError('写真が大きすぎます。1 枚減らしてください');
      return;
    }
    setPhase('judging');
    try {
      const r = await api.reflect(sessionId, body);
      setVoice(null); // 送ったら捨てる（保存しない）
      setResult(r);
      setFloor(r.floor);
      setMine(r.achievement);
      setPhase('result');
    } catch (e) {
      setError(errorText(e));
      setPhase('input');
    }
  }

  async function confirm(a: Achievement) {
    if (!result) {
      setMine(a); // 材料なしで選ぶ段: 階を積む時にまとめて送る
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.confirmReflect(sessionId, a);
      setMine(r.achievement);
      setFloor(r.floor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    const needPick = phase === 'choose' || (phase === 'result' && !result?.judgeable);
    if (needPick && mine === null) {
      flash();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let fl = floor;
      if (phase === 'choose' && mine !== null) {
        // 集中の記録は reflect → confirm の順で 1 回送る（契約どおり）。材料は空
        const r = await api.reflect(sessionId, { note: '', done: false, images: [], materials: materials.trim() });
        const c = await api.confirmReflect(sessionId, mine);
        fl = c.floor;
        setFloor(c.floor);
        setResult(r);
      }
      if (goalId) await setNextStep(goalId, next);
      const t = await api.tower();
      setTowerFloors(t.floors);
      setTowerTotal(t.totalFloors);
      setTowerStreak(t.streak);
      setPhase('build');
      if ((fl?.floors ?? 0) > 0) setTimeout(success, 500);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // 声: 文字にして「できたこと」（判定の前）か「次の一歩」（判定の後）に入れる。言葉は本人の物のまま（P1）
  async function onSay(v: Voice) {
    setMicError(null);
    setHearing(true);
    try {
      const r = await api.transcribe(v.audio);
      const said = (r.text ?? '').trim();
      if (!said) return;
      setLastSaid(said);
      if (phase === 'input') setNote((cur) => clipNote(cur ? `${cur}\n${said}` : said));
      else if (phase === 'stuck') setStuckNote((cur) => clipStuck(cur ? `${cur}\n${said}` : said));
      else setNext(Array.from(said).slice(0, 200).join(''));
    } catch (e) {
      setMicError(transcribeErrorText(e));
    } finally {
      setHearing(false);
    }
  }

  // 下の大きなマイクと、左に打ち込む（キーボード）・右に写真（クリップ・判定の前だけ）の丸（#315・本人 11/9）
  const dock = (
    <View style={styles.dock} testID="reflect-dock">
      {canRecord() ? (
        <MicRow
          mic={<VoiceButton big disabled={hearing || busy || phase === 'judging'} onDone={(v) => void onSay(v)} onError={setMicError} testID="reflect-voice" />}
          onType={typing ? undefined : () => setTyping(true)}
          onShow={!typing && phase === 'input' && photos.length < MAX_PHOTOS ? () => addPhotos('library') : undefined}
          showLabel={COPY_PICK_PHOTO}
          testID="reflect"
        />
      ) : null}
      <ErrorLine text={micError} />
      {typing ? (
        <Field
          value={phase === 'input' ? note : phase === 'stuck' ? stuckNote : (next ?? '')}
          onChangeText={phase === 'input' ? setNote : phase === 'stuck' ? setStuckNote : (t) => setNext(t || null)}
          placeholder={phase === 'input' ? COPY_REFLECT_HINT_DONE : phase === 'stuck' ? COPY_REFLECT_HINT_STUCK : COPY_REFLECT_HINT_NEXT}
          maxLength={phase === 'input' ? 1000 : phase === 'stuck' ? 500 : 200}
          autoFocus
          testID="note"
        />
      ) : !canRecord() ? (
        <View style={styles.pills}>
          {phase === 'input' && photos.length < MAX_PHOTOS ? (
            <Pill label="写真" onPress={() => addPhotos('library')} testID="pick" />
          ) : null}
          {phase === 'input' && canUseCamera && photos.length < MAX_PHOTOS ? <Pill label="撮る" onPress={() => addPhotos('camera')} /> : null}
        </View>
      ) : null}
    </View>
  );

  const shell = (body: ReactNode, footer?: ReactNode) => (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topPad}>
        <SceneTop scene="reflect" />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );

  // 最後: モルティが見て評価し、建物の横で窓が灯ったことを伝える（11/9 本人「モルティが評価していると分かるように」）
  if (phase === 'build') {
    const f = floor;
    const builtPt = towerFloors.find((x) => x.id === f?.id)?.pt ?? f?.pt;
    const fit = buildFit(screenH - AGENT_ROW_H - BUILD_CHROME_H - (offer ? REVISE_OFFER_H : 0));
    const builtColor = towerFloors.find((x) => x.id === f?.id)?.color ?? f?.color;
    const lit = litByColor(builtColor);
    return shell(
      <>
        <AgentSays {...builtLine(builtPt, lit, builtColor, f?.floors ?? null)} chat noIcon done testID="build-molty" />
        {/* モルティが見た評価の札（見てもらった時だけ。決めたのは本人の判定） */}
        {result?.judgeable && result.aiAchievement != null ? (
          <Text style={styles.verdict} testID="build-verdict">
            {`${COPY_VERDICT}　${levelWord(result.aiAchievement)}`}
          </Text>
        ) : null}
        {/* 建物は地面に立てる。モルティは建物の横に立ち、積んだ階を見ている */}
        <View style={styles.ground}>
          <Tower floors={towerFloors} freshId={f?.id ?? null} maxBlocks={fit.maxBlocks} nextSlot />
          <View style={styles.stand}>
            <MoltyStand />
          </View>
        </View>
      </>,
      <View style={styles.footStack}>
        {/* 見直しの持ちかけ（遅れ・先行の時だけ）。押さなくても下のボタンでホームへ戻れる */}
        {offer ? (
          <View style={styles.footStack} testID="revise-offer">
            <AgentSays {...reviseOffer(offer.pace)} chat noIcon testID="revise-offer-molty" />
            <BigButton
              label={COPY_REVISE_OPEN}
              variant="plain"
              onPress={() => router.replace(`/revise/${offer.goalId}`)}
              testID="revise-open"
            />
          </View>
        ) : null}
        <BigButton label={COPY_TO_TODAY} onPress={() => router.dismissTo('/')} testID="go-home" />
      </View>,
    );
  }

  // 見てもらう前の 1 問: 手が止まった所を一言（声か打ち込み）。空のままでも見てもらえる
  if (phase === 'stuck') {
    return shell(
      <>
        {lastSaid ? <Text style={styles.mine}>{lastSaid}</Text> : null}
        <AgentSays {...REFLECT_STUCK_ASK} chat testID="reflect-stuck-molty" />
        <Card style={styles.card}>
          <Text style={styles.k}>{COPY_REFLECT_STUCK}</Text>
          {stuckNote.trim() ? (
            <Text style={styles.v} testID="stuck-shown">
              {stuckNote.trim()}
            </Text>
          ) : (
            <Text style={styles.empty}>{COPY_REFLECT_STUCK_EMPTY}</Text>
          )}
        </Card>
        <BigButton label={COPY_JUDGE} onPress={judge} testID="judge" />
        <ErrorLine text={error} />
      </>,
      dock,
    );
  }

  // 判定の後（または自分で選ぶ）: モルティの見立て → 自分の判定 → 次の一歩 → これで決める
  if (phase === 'choose' || (phase === 'result' && result && floor)) {
    const judged = phase === 'result' && result && floor ? { result, floor } : null;
    const aiLevel = judged?.result.judgeable ? judged.result.aiAchievement : null;
    return shell(
      <>
        {lastSaid ? <Text style={styles.mine}>{lastSaid}</Text> : null}
        <AgentSays
          {...reflectPick({
            judged: !!judged,
            judgeable: !!judged?.result.judgeable,
            aiWord: aiLevel != null ? levelWord(aiLevel) : null,
          })}
          chat
          testID="reflect-pick-molty"
        />
        <Card style={styles.card}>
          {note.trim() ? (
            <>
              <Text style={styles.k}>{COPY_REFLECT_DONE}</Text>
              <Text style={styles.v} numberOfLines={3}>
                {note.trim()}
              </Text>
            </>
          ) : null}
          {/* モルティの見立て（判定できた時だけ言葉を大きく。できなかった時は理由だけ） */}
          {judged && aiLevel != null ? (
            <>
              <Text style={[styles.k, styles.kGap]}>{COPY_MOLTY_VIEW}</Text>
              <Text style={styles.vMain} testID="ai-achievement">
                {levelWord(aiLevel)}
              </Text>
              <Text style={styles.reason}>{judged.result.reason}</Text>
            </>
          ) : null}
          <Text style={[styles.k, styles.kGap]}>{COPY_MY_VIEW}</Text>
          <Animated.View
            style={[styles.levels, { borderColor: blink.interpolate({ inputRange: [0, 1], outputRange: [color.surface, color.danger] }) }]}
          >
            {LEVELS.map((a) => (
              <Pressable
                key={a}
                accessibilityRole="button"
                accessibilityLabel={levelWord(a)}
                accessibilityState={{ selected: mine === a }}
                disabled={busy}
                onPress={() => {
                  tap();
                  if (mine !== a) void confirm(a);
                }}
                style={[styles.level, mine === a && styles.levelOn]}
                testID={`level-${a}`}
              >
                <Text style={[styles.levelText, mine === a && styles.levelTextOn]}>{levelWord(a)}</Text>
              </Pressable>
            ))}
          </Animated.View>
          <Text style={[styles.k, styles.kGap]}>{COPY_CARD_NEXT}</Text>
          {next ? (
            <Text style={styles.v} testID="next-step">
              {next}
            </Text>
          ) : (
            <Text style={styles.empty}>{COPY_REFLECT_NEXT_EMPTY}</Text>
          )}
          {judged && judged.result.nextSteps.length > 0 ? (
            <View style={styles.wrap}>
              {judged.result.nextSteps.map((s) => (
                <Chip key={s} label={s} selected={next === s} onPress={() => setNext(next === s ? null : s)} />
              ))}
            </View>
          ) : null}
        </Card>
        <BigButton label={COPY_DECIDE} busy={busy} onPress={build} testID="build" />
        <View style={styles.center}>
          <TextLink
            label={COPY_ADD_SOURCE}
            onPress={() => {
              setMicError(null);
              setTyping(false);
              setPhase('input');
            }}
            testID="add-material"
          />
        </View>
        <ErrorLine text={error} />
      </>,
      dock,
    );
  }

  // はじめ: モルティが聞き、話した言葉と写真がカードに入る。見てもらうか、自分で選ぶ
  const hasInput = note.trim().length > 0 || photos.length > 0;
  return shell(
    <>
      {lastSaid ? <Text style={styles.mine}>{lastSaid}</Text> : null}
      <AgentSays {...REFLECT_ASK} chat waiting={phase === 'judging'} testID="reflect-molty" />
      {docsChipText(docsGoal, COPY_DOCS_OPEN) ? (
        <Pressable accessibilityRole="button" onPress={() => setDocsOpen(true)} style={styles.docChip} testID="reflect-docs">
          <Text style={styles.docChipText}>{docsChipText(docsGoal, COPY_DOCS_OPEN)}</Text>
        </Pressable>
      ) : null}
      {docsGoal && docsOpen ? (
        <GoalDocsSheet goal={docsGoal} from="reflect" visible onClose={() => setDocsOpen(false)} onChange={(docs) => setDocsGoal({ ...docsGoal, docs })} />
      ) : null}
      <Card style={styles.card}>
        {oneLine ? (
          <>
            <Text style={styles.k}>{COPY_CARD_STEP}</Text>
            <Text style={styles.vMain} numberOfLines={2}>
              {oneLine}
            </Text>
          </>
        ) : null}
        <Text style={[styles.k, oneLine ? styles.kGap : null]}>{COPY_REFLECT_DONE}</Text>
        {note.trim() ? (
          <Text style={styles.v} testID="note-shown">
            {note.trim()}
          </Text>
        ) : (
          <Text style={styles.empty}>{COPY_REFLECT_DONE_EMPTY}</Text>
        )}
        {photos.length > 0 || shrinking ? (
          <View style={styles.photos}>
            {photos.map((p, i) => (
              <View key={i} style={styles.photoWrap}>
                <Image source={{ uri: p.uri }} style={styles.photo} accessibilityLabel={`写真 ${i + 1}`} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`写真 ${i + 1} を消す`}
                  hitSlop={space.md}
                  onPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                  style={styles.photoX}
                >
                  <Text style={styles.photoXText}>×</Text>
                </Pressable>
              </View>
            ))}
            {shrinking ? <ThinkingDots /> : null}
          </View>
        ) : null}
      </Card>
      {hasInput ? (
        <BigButton label={COPY_JUDGE} busy={phase === 'judging'} disabled={shrinking} onPress={judge} testID="judge" />
      ) : null}
      <View style={styles.center}>
        <TextLink
          label="自分で選ぶ"
          onPress={() => {
            setMicError(null);
            setTyping(false);
            setPhase('choose');
          }}
          testID="choose"
        />
      </View>
      <ErrorLine text={error} />
      {/* 送れなかった時の出口。終えた集中はホームに残るので、あとで同じ所から振り返れる */}
      {showLater({ error, micError, phase }) ? (
        <View style={styles.center}>
          <TextLink label="あとで振り返る" onPress={() => router.dismissTo('/')} testID="later" />
        </View>
      ) : null}
    </>,
    dock,
  );
}

const clipNote = (s: string) => Array.from(s).slice(0, 1000).join('');
const clipStuck = (s: string) => Array.from(s).slice(0, 500).join('');

function Pill(props: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      onPress={() => {
        tap();
        props.onPress();
      }}
      style={({ pressed }) => [styles.pill, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.pillText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  topPad: { paddingHorizontal: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  body: { padding: space.lg, paddingTop: space.sm, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1 },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, maxWidth: 560, width: '100%', alignSelf: 'center' },
  card: { gap: 0 },
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
  vMain: { fontSize: font.large, color: color.text, fontWeight: '800', marginTop: 2 },
  empty: { fontSize: font.body, color: color.muted, marginTop: 2 },
  reason: { fontSize: font.body, color: color.text, lineHeight: 24, marginTop: space.xs },
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
  center: { flexDirection: 'row', justifyContent: 'center' },
  levels: { flexDirection: 'row', gap: space.sm, borderWidth: 2, borderRadius: radius.box, padding: space.xs, marginTop: space.xs },
  level: {
    flex: 1,
    height: touch.min,
    borderRadius: radius.box,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelOn: { borderColor: color.primary, backgroundColor: color.primary },
  levelText: { fontSize: font.small, fontWeight: '800', color: color.text },
  levelTextOn: { color: color.onPrimary },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center', marginTop: space.md },
  photoWrap: { width: 72, height: 72 },
  photo: { width: 72, height: 72, borderRadius: radius.box, backgroundColor: color.surfaceSunk },
  photoX: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: color.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoXText: { color: color.onPrimary, fontWeight: '900', fontSize: font.small },
  dock: { alignItems: 'center', gap: space.xs, paddingTop: space.xs },
  pills: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  pill: { minHeight: touch.min, justifyContent: 'center' },
  pillText: {
    fontSize: font.small,
    fontWeight: '700',
    color: color.muted,
    borderWidth: 1.5,
    borderColor: color.edge,
    borderRadius: radius.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    overflow: 'hidden',
    backgroundColor: color.surface,
  },
  // モルティの評価（見立ての言葉）を、建物の上に札で
  verdict: {
    alignSelf: 'center',
    fontSize: font.body,
    fontWeight: '800',
    color: color.primaryLip,
    backgroundColor: color.primarySoft,
    borderRadius: radius.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  ground: { flex: 1, justifyContent: 'flex-end', paddingBottom: space.md },
  footStack: { gap: space.sm },
  // モルティは建物の右下、土台の横に重ねて立つ
  stand: { position: 'absolute', right: 0, bottom: space.xxxl },
});
