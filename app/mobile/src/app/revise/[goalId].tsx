// ロードマップの見直し（#353・#359）。振り返りの最後の持ちかけから来る。
// 開いたらモルティが進み具合に合わせた残りの下書きを出す → 話すと下書きを直す → 「この形にする」で残りを置き換える。
// 「今のまま」「やめる」は何も送らずホームへ（決めるのは本人・P1）。日付・目安の時間は出さない。

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorText } from '../../api';
import type { AgentTurn, Checkpoint, CheckpointInput } from '../../api/types';
import { AgentSays } from '../../components/AgentSays';
import { MicRow } from '../../components/MoltyDock';
import { MOLTY_MESSAGE_MAX, pushTurns } from '../../components/MoltyPanel';
import { PlanRoad } from '../../components/PlanRoad';
import { SceneTop } from '../../components/SceneTop';
import { BigButton, Card, ErrorLine, Field, TextLink } from '../../components/ui';
import { canRecord, VoiceButton, type Voice } from '../../components/VoiceButton';
import { REVISE_FAILED } from '../../lib/agentLines';
import { COPY_MOLTY_SEND, COPY_PREP_QUIT, COPY_REVISE_APPLY, COPY_REVISE_HINT, COPY_REVISE_KEEP, COPY_REVISE_OPEN } from '../../lib/copy';
import { remainingDraft, reviseRoadSteps } from '../../lib/roadmapRevise';
import { useTabTitle } from '../../lib/tabTitle';
import { transcribeErrorText } from '../../lib/voiceFill';
import { color, space } from '../../theme';

const goHome = () => router.dismissTo('/');

export default function Revise() {
  useTabTitle(COPY_REVISE_OPEN);
  const { goalId } = useLocalSearchParams<{ goalId: string }>();
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [draft, setDraft] = useState<CheckpointInput[] | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [thinking, setThinking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(!canRecord()); // 声を録れない端末でははじめから打ち込む欄
  const [hearing, setHearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useRef<AgentTurn[]>([]);

  // 開いたら: 今のロードマップを読み、message 無しでモルティの案を取る
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.getGoal(goalId);
        if (!alive) return;
        if (!d.roadmap) {
          goHome();
          return;
        }
        setCheckpoints(d.roadmap.checkpoints);
        setDraft(remainingDraft(d.roadmap.checkpoints));
        const r = await api.reviseRoadmap(goalId, {});
        if (!alive) return;
        setDraft(r.draft);
        setReply(r.reply);
        history.current = pushTurns([], { from: 'agent', text: r.reply });
      } catch (e) {
        if (!alive) return;
        setFailed(true);
        setError(errorText(e));
      } finally {
        if (alive) setThinking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [goalId]);

  // 話す: 言葉と今の下書き・やり取りを送り、返った下書きに替える（保存はしない）
  async function send(said?: string) {
    const message = Array.from((said ?? text).trim()).slice(0, MOLTY_MESSAGE_MAX).join('');
    if (!message || thinking || saving) return;
    setThinking(true);
    setError(null);
    try {
      const r = await api.reviseRoadmap(goalId, { message, ...(draft ? { draft } : {}), history: history.current });
      history.current = pushTurns(history.current, { from: 'me', text: message }, { from: 'agent', text: r.reply });
      setDraft(r.draft);
      setReply(r.reply);
      setFailed(false);
      setText('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setThinking(false);
    }
  }

  async function onVoice(v: Voice) {
    setError(null);
    setHearing(true);
    try {
      const r = await api.transcribe(v.audio);
      const said = (r.text ?? '').trim();
      if (said) await send(said);
    } catch (e) {
      setError(transcribeErrorText(e));
    } finally {
      setHearing(false);
    }
  }

  // この形にする: 残りを置き換えてホームへ
  async function apply() {
    if (!draft || draft.length === 0 || saving || thinking) return;
    setSaving(true);
    setError(null);
    try {
      await api.replaceRemaining(goalId, draft);
      goHome();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  // 返事待ちの間は AgentSays が点を出す。案を取れなかった時は、話せば直せることを言う
  const line = reply ? { text: reply, short: reply } : REVISE_FAILED;
  const busy = thinking || saving;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topPad}>
        <SceneTop scene="plan" right={<TextLink label={COPY_PREP_QUIT} onPress={goHome} testID="revise-quit" />} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <AgentSays {...line} chat waiting={thinking} popKey={`${reply ?? ''}:${failed}`} testID="revise-molty" />
        {draft ? (
          <Card>
            {/* 終わった物は済みの見た目で前に、下書きの残りをその後に。期限の旗に日付は付けない */}
            <PlanRoad steps={reviseRoadSteps(checkpoints, draft)} deadlineLabel={null} testID="revise-road" />
          </Card>
        ) : null}
        <ErrorLine text={error} />
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.dock} testID="revise-dock">
          {canRecord() ? (
            <MicRow
              mic={<VoiceButton big disabled={hearing || busy} onDone={(v) => void onVoice(v)} onError={setError} testID="revise-voice" />}
              onType={typing ? undefined : () => setTyping(true)}
              testID="revise"
            />
          ) : null}
          {typing ? (
            <View style={styles.row}>
              <View style={styles.grow}>
                <Field
                  value={text}
                  onChangeText={setText}
                  placeholder={COPY_REVISE_HINT}
                  maxLength={MOLTY_MESSAGE_MAX}
                  returnKeyType="send"
                  onSubmitEditing={() => void send()}
                  autoFocus={canRecord()}
                  testID="revise-input"
                />
              </View>
              {text.trim() ? <BigButton label={COPY_MOLTY_SEND} size="small" variant="plain" busy={thinking} onPress={() => void send()} testID="revise-send" /> : null}
            </View>
          ) : null}
        </View>
        <BigButton label={COPY_REVISE_APPLY} busy={saving} disabled={!draft || draft.length === 0 || thinking} onPress={apply} testID="revise-apply" />
        <View style={styles.center}>
          <TextLink label={COPY_REVISE_KEEP} onPress={goHome} testID="revise-keep" />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  topPad: { paddingHorizontal: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  body: { padding: space.lg, paddingTop: space.sm, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1 },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm, maxWidth: 560, width: '100%', alignSelf: 'center' },
  dock: { alignItems: 'center', gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, width: '100%' },
  grow: { flex: 1 },
  center: { flexDirection: 'row', justifyContent: 'center' },
});
