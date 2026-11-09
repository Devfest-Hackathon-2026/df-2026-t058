// 相談の会話（部品）。相談の画面（tutor/[sessionId]）と集中の画面（focus/[sessionId]）の両方で使う。
// ふつうのチャット。AI の返事ごとに「ヒント」「やり方」の印、上に AI の手助け。答えを見るボタンは無い（P2）。
// compact＝集中の画面の中: 1 行の入力欄・例の札は横に 3 個まで・キーボードの扱いは呼ぶ画面が持つ。

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorText } from '../api';
import type { HelpTotal, StuckOption, TutorIntent, TutorMessage } from '../api/types';
import { Chip, ErrorLine, RiseIn, ThinkingDots } from './ui';
import { Skeleton } from './State';
import { optionAsk } from '../lib/reflectView';
import { PhotoThumbs } from './PhotoThumbs';
import { HelpBars, helpBarLabel } from './HelpBars';
import { AgentSays, CHAT_AVATAR_SIZE } from './AgentSays';
import { Mascot } from './Mascot';
import { canRecord, useVoiceFill, VoiceButton, type Voice } from './VoiceButton';
import { MicRow } from './MoltyDock';
import { fieldMicShown, transcribeErrorText } from '../lib/voiceFill';
import { COPY_AI_HELP, COPY_ASK_AI, COPY_FOCUS_TALK, COPY_OPTION_NOTE, COPY_PICK_PHOTO } from '../lib/copy';
import {
  MASCOT_COMPACT_HERO_HEIGHT,
  MASCOT_COMPACT_HINT,
  MASCOT_HERO_HEIGHT,
  MASCOT_ICON_SIZE,
  MASCOT_NAME,
} from '../lib/mascot';
import { tap } from '../lib/haptics';
import { canUseCamera, pickPhotos, preparePhoto, type Photo } from '../lib/photo';
import { addPhotos, photoRoom } from '../lib/tutorPhotos';
import { splitSources } from '../lib/sources';
import { addFocusMemo, focusMemos, sessionInfo } from '../lib/local';
import {
  applyStarter,
  canSend,
  hintOf,
  intentOf,
  sendText,
  STUCK_STARTERS,
  THINK_CARDS,
  cardsFor,
  withIntent,
  type ThinkCard,
} from '../lib/thinkCards';
import {
  askTutor,
  chatIsActive,
  COMPACT_EXAMPLES,
  pickExample,
  tutorExamples,
  type TutorExample,
} from '../lib/tutorExamples';
import { color, font, radius, space, touch } from '../theme';

export function TutorChat(props: {
  sessionId: string;
  compact?: boolean;
  // 会話が主役になったか（集中の画面が時計を小さくするのに使う）
  onActiveChange?: (active: boolean) => void;
}) {
  const { sessionId, compact = false, onActiveChange } = props;
  // 札の名前（課題に合わせる・11/9）。課題が読めるまでは今の札
  const [cards, setCards] = useState<readonly { card: ThinkCard; label: string }[]>(THINK_CARDS);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [help, setHelp] = useState<HelpTotal>({ small: 0, medium: 0 });
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // 写真はこの画面のメモリだけ。送ったら消え、保存しない
  const [photos, setPhotos] = useState<Photo[]>([]);
  const scroll = useRef<ScrollViewInstance>(null);
  // 例の質問は今日のチェックポイントから作る
  const [examples, setExamples] = useState<TutorExample[]>([]);
  // この画面で新しく届いた返事の ID
  const fresh = useRef(new Set<string>());
  // 取り組み中の場面の札（集中の画面だけ）。送ったら null（自由に聞く）に戻る
  const [card, setCard] = useState<ThinkCard | null>(null);
  const [memoCount, setMemoCount] = useState(0);
  // 札を押して出す候補（null＝札なし・'loading'＝読み込み中）と、候補の下の「ひとこと足す」
  const [opts, setOpts] = useState<StuckOption[] | 'loading' | null>(null);
  const [extra, setExtra] = useState('');
  // 声で入力（ふつうの相談・集中中の相談とメモ）。文字は入力欄の末尾に足すだけで、送るのは本人
  const voice = useVoiceFill(text, setText, 2000);
  const micOn = fieldMicShown(true, canRecord());
  // 集中の中（compact）は声が主役（#315）: 大きなマイクで話すと、聞き取った文をそのまま送る。打ち込みは押した時だけ開く
  const [typing, setTyping] = useState(!micOn);
  const [hearing, setHearing] = useState(false);
  async function onVoiceSay(v: Voice) {
    setError(null);
    setHearing(true);
    try {
      const r = await api.transcribe(v.audio);
      const said = (r.text ?? '').trim();
      if (said) await sendWith(said);
    } catch (e) {
      setError(transcribeErrorText(e));
    } finally {
      setHearing(false);
    }
  }

  // 札（手が止まった・合ってるか確認）を押したら、その課題に応じた候補を読み込む。失敗した時は候補なし（普通に聞く道だけ）
  useEffect(() => {
    if (!compact || (card !== 'stuck' && card !== 'check')) {
      setOpts(null);
      return;
    }
    let live = true;
    setOpts('loading');
    api
      .stuckOptions(sessionId, card)
      .then((r) => live && setOpts(r.options ?? []))
      .catch(() => live && setOpts([]));
    return () => {
      live = false;
    };
  }, [card, compact, sessionId]);

  useEffect(() => {
    if (!compact) return;
    focusMemos(sessionId)
      .then((m) => setMemoCount(m.length))
      .catch(() => setMemoCount(0));
  }, [sessionId, compact]);

  useEffect(() => {
    (async () => {
      const info = await sessionInfo(sessionId);
      if (!info) return;
      const d = await api.getGoal(info.goalId);
      const cp = d.roadmap?.checkpoints.find((c) => c.id === info.checkpointId);
      setExamples(tutorExamples(cp));
      setCards(cardsFor(cp));
    })().catch(() => setExamples([]));
  }, [sessionId]);

  useEffect(() => {
    api
      .tutorHistory(sessionId)
      .then((r) => {
        setMessages(r.messages ?? []);
        // サーバーが古い形（helpTotal なし）で返しても画面が落ちないように
        setHelp(r.helpTotal ?? { small: 0, medium: 0 });
      })
      .catch((e) => setError(errorText(e)));
  }, [sessionId]);

  const active = chatIsActive(messages.length, !!pending, focused);
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  const room = photoRoom(photos.length);

  async function addFrom(mode: 'camera' | 'library') {
    setError(null);
    try {
      const picked = await pickPhotos(mode, room);
      if (picked.length === 0) return;
      const ready: Photo[] = [];
      for (const p of picked) ready.push(await preparePhoto(p));
      setPhotos((cur) => addPhotos(cur, ready));
    } catch {
      setError('写真を読めませんでした');
    }
  }

  function choosePhoto() {
    if (!canUseCamera) return void addFrom('library');
    Alert.alert('写真', undefined, [
      { text: '撮る', onPress: () => void addFrom('camera') },
      { text: COPY_PICK_PHOTO, onPress: () => void addFrom('library') },
      { text: 'やめる', style: 'cancel' },
    ]);
  }

  // メモは端末にだけ残す（AI には送らない）
  async function saveMemo(raw: string = text) {
    const t = raw.trim();
    if (!t) return;
    tap();
    setText('');
    setCard(null);
    try {
      setMemoCount((await addFocusMemo(sessionId, t)).length);
    } catch {
      setText(t);
      setError('メモを残せませんでした');
    }
  }

  async function send() {
    return sendWith(text);
  }

  // raw＝送る文（打ち込みは入力欄の文、声は聞き取った文）
  async function sendWith(raw: string) {
    if (card === 'memo') return void saveMemo(raw);
    if (!canSend(card, raw, photos.length) || pending) return;
    const t = sendText(card, raw, photos.length);
    tap();
    const sending = photos;
    const sentCard = card;
    setPending(t);
    setText('');
    setPhotos([]);
    setCard(null);
    setError(null);
    try {
      const r = await askTutor(withIntent(api.tutor, intentOf(sentCard)), sessionId, [], t, sending.map((p) => p.image));
      // 送って返ってきた返事だけ、出る時に薄く浮かぶ（前の会話は動かさない）
      for (const m of r.messages) if (m.role !== 'user') fresh.current.add(m.id);
      setMessages((m) => [...m, ...r.messages]);
      setHelp(r.help);
    } catch (e) {
      setError(errorText(e));
      setText(raw.trim() ? t : '');
      setPhotos(sending);
      setCard(sentCard);
    } finally {
      setPending(null);
    }
  }

  // 候補を 1 つ押す＝相談を送る（質問文は「札の名前: 候補」・thought は候補の文）
  async function sendOption(label: string) {
    if (!card || card === 'memo' || pending) return;
    const intent: TutorIntent = card;
    const cardLabel = cards.find((c) => c.card === card)?.label ?? '';
    const a = optionAsk(cardLabel, intent, label, extra);
    tap();
    const sentExtra = extra;
    setPending(a.text);
    setExtra('');
    setCard(null);
    setError(null);
    try {
      const r = await askTutor(
        (id, body) => api.tutor(id, { ...body, intent: a.intent, thought: a.thought }),
        sessionId,
        [],
        a.text,
        [],
      );
      for (const m of r.messages) if (m.role !== 'user') fresh.current.add(m.id);
      setMessages((m) => [...m, ...r.messages]);
      setHelp(r.help);
    } catch (e) {
      setError(errorText(e));
      setExtra(sentExtra);
      setCard(intent);
    } finally {
      setPending(null);
    }
  }

  function fillExample(ex: TutorExample) {
    setText(pickExample(ex).text);
  }

  const showExamples = messages.length === 0 && !pending;
  // キャラは相談の相手としてだけ出す（相談の別の画面と、集中の画面の相談。他の画面には出さない）
  const aiIcon = (waiting: boolean) => {
    const icon = (
      <Mascot
        size={compact ? CHAT_AVATAR_SIZE - 8 : MASCOT_ICON_SIZE}
        waiting={waiting}
        testID={waiting ? 'tutor-mascot-waiting' : undefined}
      />
    );
    // 集中の中は、ほかの画面のモルティと同じ薄い地の丸に入れる（#315）
    return compact ? <View style={styles.avatar}>{icon}</View> : icon;
  };
  const aiBubble = styles.bubbleWithIcon;
  const exampleChip = (ex: TutorExample, i: number) => (
    <Chip
      key={ex.text}
      label={ex.text}
      onPress={() => fillExample(ex)}
      testID={`tutor-example-${i}`}
    />
  );
  const placeholder = hintOf(card, compact ? 'いま詰まっていること' : '聞きたいこと');
  const memoMode = card === 'memo';
  const sendable = canSend(card, text, photos.length) && !pending;
  const photoOff = room <= 0 || !!pending || memoMode;
  // 札をもう一度押すと外れる（自由に聞く）
  const pickCard = (c: ThinkCard) => setCard((cur) => (cur === c ? null : c));

  // 手助けの棒は相談の画面だけ（集中の中は会話だけにする・#315）
  const helpBar =
    !compact ? (
      <View style={[styles.helpBar, compact && styles.helpBarCompact]} accessibilityLabel={helpBarLabel(help.small, help.medium)}>
        <Text style={styles.helpLabel}>{COPY_AI_HELP}</Text>
        <HelpBars small={help.small} medium={help.medium} />
      </View>
    ) : null;

  const list = (
    <ScrollView
      ref={scroll}
      style={compact ? { flex: 1 } : undefined}
      contentContainerStyle={[styles.list, compact && styles.listCompact, !compact && showExamples && styles.listEmpty]}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      {compact && showExamples ? (
        // 最初の呼びかけは会話の一番上に、ほかの画面と同じ吹き出しで（#315）
        <View testID="tutor-mascot-hero-compact">
          <AgentSays text={MASCOT_COMPACT_HINT} chat testID="tutor-compact-says" />
        </View>
      ) : null}
      {!compact && showExamples ? examples.map(exampleChip) : null}
      {!compact && showExamples ? (
        <View style={styles.hero}>
          <Mascot height={MASCOT_HERO_HEIGHT} testID="tutor-mascot-hero" />
        </View>
      ) : null}
      {messages.map((m) => {
        const mine = m.role === 'user';
        const { body, sources } = mine ? { body: m.text, sources: [] as string[] } : splitSources(m);
        const row = (
          <View key={m.id} style={[styles.msgRow, compact && styles.msgRowTalk, mine ? styles.rowMine : styles.rowAi]}>
            {mine ? null : aiIcon(false)}
            <View style={[styles.bubble, mine ? [styles.bubbleMine, compact && styles.bubbleMineTalk] : [styles.bubbleAi, aiBubble, compact && styles.bubbleAiTalk]]}>
              <Text style={[styles.msgText, compact && styles.msgTextTalk, mine && !compact && { color: color.onPrimary }]}>{body}</Text>
              {sources.length > 0 ? (
                <Text style={styles.source} numberOfLines={2}>{`出典 ${sources.join('・')}`}</Text>
              ) : null}
            </View>
          </View>
        );
        return fresh.current.has(m.id) ? (
          <RiseIn key={m.id} duration={200}>
            {row}
          </RiseIn>
        ) : (
          row
        );
      })}
      {pending ? (
        <>
          <View style={[styles.msgRow, styles.rowMine]}>
            <View style={[styles.bubble, styles.bubbleMine, compact && styles.bubbleMineTalk]}>
              <Text style={[styles.msgText, compact ? styles.msgTextTalk : { color: color.onPrimary }]}>{pending}</Text>
            </View>
          </View>
          <View style={[styles.msgRow, compact && styles.msgRowTalk, styles.rowAi]}>
            {aiIcon(true)}
            <View style={[styles.bubble, styles.bubbleAi, aiBubble, compact && styles.bubbleAiTalk]}>
              <ThinkingDots label="考えています" />
            </View>
          </View>
        </>
      ) : null}
      <ErrorLine text={error} />
    </ScrollView>
  );

  const composer = (
    <View style={[styles.composer, compact && styles.composerCompact]}>
      {compact ? null : (
        <Text style={styles.mascotName} numberOfLines={1} testID="tutor-mascot-name">
          {MASCOT_NAME}
        </Text>
      )}
      {compact && typing ? (
        // 札は打ち込む時だけ（声が主役・#315）。1 行に収める（幅が足りない端末は横に送れる）
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRow} testID="think-cards">
          {cards.map((c) => (
            <Chip
              key={c.card}
              label={c.label}
              selected={card === c.card}
              onPress={() => pickCard(c.card)}
              testID={`think-card-${c.card}`}
            />
          ))}
          {memoCount > 0 ? (
            <Text style={styles.memoCount} testID="memo-count">{`メモ ${memoCount}`}</Text>
          ) : null}
        </ScrollView>
      ) : null}
      {compact && opts === 'loading' ? (
        <View style={styles.optionCol} testID="stuck-options-loading">
          <Skeleton height={touch.min} />
          <Skeleton height={touch.min} />
          <Skeleton height={touch.min} />
        </View>
      ) : null}
      {compact && Array.isArray(opts) && opts.length > 0 ? (
        <View style={styles.optionCol} testID="stuck-options">
          {opts.slice(0, 4).map((o, i) => (
            <Chip key={o.id} label={o.label} onPress={() => void sendOption(o.label)} testID={`stuck-option-${i}`} />
          ))}
          <TextInput
            value={extra}
            onChangeText={setExtra}
            accessibilityLabel={COPY_OPTION_NOTE}
            placeholder={COPY_OPTION_NOTE}
            placeholderTextColor={color.muted}
            style={styles.input}
            maxLength={200}
            testID="stuck-option-extra"
          />
        </View>
      ) : null}
      {compact && card === 'stuck' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.exampleRow} testID="stuck-starters">
          {STUCK_STARTERS.map((s, i) => (
            <Chip key={s} label={`${s}…`} onPress={() => setText((cur) => applyStarter(cur, s))} testID={`stuck-starter-${i}`} />
          ))}
        </ScrollView>
      ) : null}
      {compact && typing && !card && showExamples && examples.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.exampleRow} testID="tutor-examples-compact">
          {examples.slice(0, COMPACT_EXAMPLES).map(exampleChip)}
        </ScrollView>
      ) : null}
      <PhotoThumbs uris={photos.map((p) => p.uri)} onRemove={(i) => setPhotos((cur) => cur.filter((_, j) => j !== i))} testID="tutor-photo" />
      {compact && micOn ? (
        // 声が主役: 真ん中に大きなマイク、左に打ち込む（キーボード）・右に写真（クリップ）の丸（#315・本人 11/9）
        <View style={styles.dock} testID="tutor-dock">
          <MicRow
            mic={<VoiceButton big label={COPY_FOCUS_TALK} disabled={!!pending || hearing} onDone={(v) => void onVoiceSay(v)} onError={setError} testID="tutor-voice-big" />}
            onType={typing ? undefined : () => setTyping(true)}
            onShow={typing ? undefined : choosePhoto}
            showLabel={COPY_PICK_PHOTO}
            showDisabled={photoOff}
            testID="tutor"
          />
        </View>
      ) : null}
      {compact && !typing ? null : (
      <View style={styles.inputRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="写真"
          disabled={photoOff}
          onPress={choosePhoto}
          style={[styles.photoBtn, photoOff && styles.sendOff]}
          testID="tutor-photo-add"
        >
          <Text style={[styles.photoText, photoOff && { color: color.muted }]}>写真</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor={color.muted}
          style={styles.input}
          multiline={!compact}
          returnKeyType={compact ? 'send' : undefined}
          onSubmitEditing={compact ? () => void send() : undefined}
          maxLength={2000}
          testID="tutor-input"
        />
        {micOn && !compact ? (
          <View style={styles.mic}>
            {voice.busy ? (
              <ThinkingDots />
            ) : (
              <VoiceButton small disabled={!!pending} onDone={voice.onDone} onError={voice.onError} testID="tutor-voice" />
            )}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={memoMode ? 'メモを残す' : COPY_ASK_AI}
          disabled={!sendable}
          onPress={send}
          style={[styles.send, !sendable && styles.sendOff]}
          testID="tutor-send"
        >
          <Text style={[styles.sendText, !sendable && { color: color.muted }]}>{memoMode ? '✓' : '↑'}</Text>
        </Pressable>
      </View>
      )}
      <ErrorLine text={voice.error} />
    </View>
  );

  // 集中の画面の中: 時計は上の帯にあるので、会話の場所をいつも広く取る（#315）
  if (compact) {
    return (
      <View style={{ flex: 1 }} testID="tutor-chat-compact">
        {helpBar}
        {list}
        {composer}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom', 'left', 'right']}>
      {helpBar}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {list}
        {composer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  helpBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 2,
    borderBottomColor: color.line,
  },
  helpBarCompact: { paddingHorizontal: 0 },
  helpLabel: { fontSize: font.body, fontWeight: '800', color: color.text, marginRight: 'auto' },
  list: { padding: space.lg, gap: space.md, maxWidth: 640, width: '100%', alignSelf: 'center' },
  listCompact: { paddingHorizontal: 0, paddingVertical: space.md },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  rowMine: { justifyContent: 'flex-end' },
  rowAi: { justifyContent: 'flex-start' },
  listEmpty: { flexGrow: 1 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.lg },
  bubble: { maxWidth: '82%', borderRadius: radius.box, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  // 絵（直径 38＋間 8）の分だけ吹き出しを狭くする。幅 320 でも 1 行に収まる
  bubbleWithIcon: { maxWidth: '72%', flexShrink: 1 },
  compactHero: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  compactHint: { flexShrink: 1, maxWidth: '75%' },
  mascotName: { fontSize: font.small, fontWeight: '800', color: color.muted },
  bubbleMine: { backgroundColor: color.primary },
  bubbleAi: { backgroundColor: color.surface, borderWidth: 2, borderColor: color.line },
  msgText: { fontSize: font.body, color: color.text, lineHeight: 24 },
  source: { fontSize: font.small, color: color.muted, fontWeight: '700' },
  composer: {
    borderTopWidth: 2,
    borderTopColor: color.line,
    padding: space.md,
    gap: space.sm,
    backgroundColor: color.bg,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  composerCompact: { paddingHorizontal: 0, borderTopWidth: 0, backgroundColor: 'transparent' },
  // 集中の中の会話（ホームのモルティと同じ見た目・#315）
  bubbleAiTalk: { borderWidth: 1.5, borderRadius: radius.card, borderTopLeftRadius: radius.box, paddingHorizontal: space.lg, paddingVertical: space.md },
  bubbleMineTalk: { backgroundColor: color.primarySoft, borderRadius: radius.card, borderBottomRightRadius: radius.box },
  msgTextTalk: { fontSize: font.large - 2, lineHeight: 28 },
  dock: { alignItems: 'center', gap: space.xs, paddingTop: space.xs },
  msgRowTalk: { alignItems: 'flex-start' },
  avatar: {
    width: CHAT_AVATAR_SIZE,
    height: CHAT_AVATAR_SIZE,
    borderRadius: radius.full,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dockRow: { flexDirection: 'row', gap: space.sm },
  pill: {
    minHeight: touch.min,
    minWidth: 96,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  exampleRow: { gap: space.sm },
  optionCol: { gap: space.sm, alignItems: 'stretch' },
  cardRow: { gap: space.sm, alignItems: 'center' },
  memoCount: { fontSize: font.small, fontWeight: '800', color: color.muted },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minWidth: 0, // Web で入力欄が縮まず、送るボタンが画面の外へ出るのを防ぐ
    minHeight: touch.min,
    maxHeight: 140,
    borderWidth: 2,
    borderColor: color.edge,
    borderRadius: radius.box,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: color.text,
    backgroundColor: color.surface,
  },
  send: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtn: {
    minWidth: touch.min,
    height: touch.min,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color.edge,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoText: { color: color.primary, fontSize: font.body, fontWeight: '800' },
  sendOff: { backgroundColor: color.surfaceSunk },
  mic: { minWidth: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: color.onPrimary, fontSize: font.title, fontWeight: '900' },
});
