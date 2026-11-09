// ホームの一番上の「今日の提案」のカード（#187）。エビのあいさつ・提案の行（1〜3 件）。
// 時間は先に聞かない（#265）。開いたらそのまま api.today を minutes なしで呼び、量はサーバーが決める。
// キャラをホームに出すのは、このカードのあいさつだけ（ほかの部品には増やさない）。
// 提案は POST /api/today（何も保存しない）。採るかは本人が決める。行の「始める」は薄いボタン。
// 主ボタン（下に固定）は画面が持つ。1 件目を指すように、取れた提案を onProposals で画面へ渡す。

// Web でサーバーがクライアント ID を返した時だけ、行に「カレンダーに入れる」（Google カレンダーへ直接書く・#208）。
// トークンは押した時の関数の中の変数だけ。端末に残すのは「入れた」印（提案の ID）だけ。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { HomeData, TodayProposalItem, TodayResult } from '../api/types';
import {
  COPY_ADD_CALENDAR,
  COPY_CALENDAR_ADDED,
  COPY_OPEN_GOOGLE_CALENDAR,
  COPY_RETRY,
  COPY_START,
  COPY_TODAY_FAILED,
  COPY_TODAY_NOTE,
  COPY_TODAY_NOTE_APPLIED,
  COPY_TODAY_NOTE_APPLY,
  COPY_TODAY_NOTE_HINT,
  COPY_TODAY_NOTE_UNDO,
} from '../lib/copy';
import { addedMarks, addProposalToCalendar, calendarErrorText, loadGis, proposalMarkId, showGoogleButton } from '../lib/googleCalendar';
import { lastOnly, proposalKey, TODAY_NOTE_MAX, todayNote } from '../lib/homeView';
import { color, font, radius, space } from '../theme';
import { Mascot } from './Mascot';
import { Skeleton } from './State';
import { BigButton, Card, Field, TextLink } from './ui';

type GoalEntry = HomeData['goals'][number];

// あいさつの横のエビの丸の直径
export const GREETING_ICON_SIZE = 36;

export function TodayProposal(props: { goals: GoalEntry[]; onProposals: (list: TodayProposalItem[]) => void }) {
  const { goals, onProposals } = props;
  const [result, setResult] = useState<TodayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // 「今日やりたいこと」（#222）。画面の状態だけ（端末に残さない）。applied は今の提案に使った希望
  const [noteText, setNoteText] = useState('');
  const [applied, setApplied] = useState<string | undefined>(undefined);
  const asked = useRef<string | undefined>(undefined);
  const report = useRef(onProposals);
  report.current = onProposals;

  // 連打しても最後の 1 回だけを使う
  const runner = useRef(
    lastOnly(
      (a: { note?: string }) => api.today(undefined, a.note),
      (r) => {
        setLoading(false);
        if (r.ok) {
          setFailed(false);
          setApplied(asked.current);
          setResult(r.value);
          report.current(r.value.proposals);
        } else {
          setFailed(true);
          report.current([]);
        }
      },
    ),
  ).current;
  useEffect(() => () => runner.cancel(), [runner]);

  // 開いた時・目標の次の一歩が変わった時に取り直す（時間は聞かない・#265）
  const key = proposalKey(goals);
  // note を省くと、今の提案に使った希望のまま取り直す
  const fetchNow = (note: string | undefined = applied) => {
    setLoading(true);
    asked.current = note;
    runner.request({ note });
  };
  const reapply = () => {
    const note = todayNote(noteText);
    if (note) fetchNow(note);
  };
  // 元の提案に戻す（希望を消して取り直す）
  const undo = () => {
    setNoteText('');
    fetchNow(undefined);
  };
  useEffect(() => {
    fetchNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Google カレンダーに入れる（Web・クライアント ID がある時だけ）
  const [googleClientId, setGoogleClientId] = useState<string | null>(null); // 公開の値（秘密ではない）
  const [added, setAdded] = useState<string[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [calBusy, setCalBusy] = useState<string | null>(null);
  const [calError, setCalError] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    api
      .config()
      .then((c) => {
        if (!alive || !c.googleClientId) return;
        setGoogleClientId(c.googleClientId);
        void loadGis().catch(() => {}); // 押した時に窓がすぐ開くよう、先に読んでおく
      })
      .catch(() => {});
    void addedMarks(AsyncStorage).then((m) => alive && setAdded(m));
    return () => {
      alive = false;
    };
  }, []);
  const canWrite = showGoogleButton(Platform.OS, googleClientId);

  async function addToGoogleCalendar(p: TodayProposalItem) {
    if (!googleClientId || calBusy) return;
    const id = proposalMarkId(p);
    setCalBusy(id);
    setCalError(null);
    try {
      const r = await addProposalToCalendar(p, { clientId: googleClientId, store: AsyncStorage });
      setAdded((cur) => (cur.includes(id) ? cur : [...cur, id]));
      const link = r.htmlLink;
      if (link) setLinks((cur) => ({ ...cur, [id]: link }));
    } catch (e) {
      setCalError({ id, text: calendarErrorText(e, 'write') });
    } finally {
      setCalBusy(null);
    }
  }

  const nameOf = (goalId: string) =>goals.find((g) => g.goal.id === goalId)?.goal.text ?? '';
  const proposals = result?.proposals ?? [];

  return (
    <Card testID="today-proposal" style={styles.card}>
      {failed && !loading ? (
        // 失敗してもカードは消さない。あいさつの代わりに 1 行と小さな「もう一度」
        <View style={styles.failRow} accessibilityRole="alert">
          <Text style={styles.failText}>{COPY_TODAY_FAILED}</Text>
          <BigButton
            label={COPY_RETRY}
            variant="plain"
            size="small"
            testID="today-retry"
            onPress={() => fetchNow()}
          />
        </View>
      ) : (
        <View style={styles.hello}>
          <Mascot size={GREETING_ICON_SIZE} testID="today-mascot" />
          <View style={styles.bubble}>
            {result ? (
              <Text style={styles.greeting} testID="today-greeting">
                {result.greeting}
              </Text>
            ) : (
              <Skeleton width="80%" height={font.body} />
            )}
          </View>
        </View>
      )}

      {loading ? (
        // 待っている間は行を骨組みにする
        <View style={styles.rows} testID="today-loading">
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      ) : !failed && proposals.length > 0 ? (
        <View style={styles.rows}>
          {proposals.map((p, i) => (
            <View key={`${p.goalId}:${p.checkpointId}`} style={styles.row} testID={`today-row-${i}`}>
              <View style={styles.rowText}>
                <Text style={styles.goalName} numberOfLines={1}>
                  {nameOf(p.goalId)}
                </Text>
                <Text style={styles.step} numberOfLines={2}>
                  {p.title}
                </Text>
                <Text style={styles.reason} numberOfLines={1}>
                  {`${p.minutes} 分　${p.reason}`}
                </Text>
                {canWrite ? (
                  <View style={styles.calRow}>
                    {added.includes(proposalMarkId(p)) ? (
                      <>
                        <Text style={styles.calDone} testID={`today-cal-added-${i}`}>
                          {COPY_CALENDAR_ADDED}
                        </Text>
                        {links[proposalMarkId(p)] ? (
                          <Text
                            style={styles.calLink}
                            accessibilityRole="link"
                            testID={`today-cal-open-${i}`}
                            onPress={() => void Linking.openURL(links[proposalMarkId(p)] ?? '')}
                          >
                            {COPY_OPEN_GOOGLE_CALENDAR}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <BigButton
                        label={COPY_ADD_CALENDAR}
                        variant="plain"
                        size="small"
                        busy={calBusy === proposalMarkId(p)}
                        disabled={calBusy !== null}
                        testID={`today-cal-${i}`}
                        onPress={() => void addToGoogleCalendar(p)}
                      />
                    )}
                    {calError?.id === proposalMarkId(p) ? (
                      <Text style={styles.calError} accessibilityRole="alert">
                        {calError.text}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <BigButton
                label={COPY_START}
                variant="plain"
                size="small"
                testID={`today-start-${i}`}
                onPress={() => router.push(`/start/${p.goalId}/${p.checkpointId}`)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* 本人の希望で組み直す（目標は変えない・並べ方と理由だけ）。提案が出ている時だけ */}
      {result && result.proposals.length > 0 ? (
        <View style={styles.note}>
          <Field
            label={COPY_TODAY_NOTE}
            value={noteText}
            onChangeText={setNoteText}
            placeholder={COPY_TODAY_NOTE_HINT}
            maxLength={TODAY_NOTE_MAX}
            returnKeyType="done"
            onSubmitEditing={reapply}
            voice
            testID="today-note"
          />
          <BigButton
            label={COPY_TODAY_NOTE_APPLY}
            variant="plain"
            size="small"
            disabled={loading || !todayNote(noteText)}
            testID="today-note-apply"
            onPress={reapply}
          />
          {applied && !loading && !failed ? (
            <View style={styles.appliedRow} testID="today-note-applied">
              <Text style={styles.appliedText}>{COPY_TODAY_NOTE_APPLIED}</Text>
              <TextLink label={COPY_TODAY_NOTE_UNDO} onPress={undo} testID="today-note-undo" />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  hello: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bubble: {
    flex: 1,
    minWidth: 0,
    backgroundColor: color.primarySoft,
    borderRadius: radius.box,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  greeting: { fontSize: font.body, fontWeight: '700', color: color.text },
  failRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  failText: { flex: 1, minWidth: 160, fontSize: font.body, fontWeight: '700', color: color.danger },
  rows: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  goalName: { fontSize: font.small, fontWeight: '700', color: color.muted },
  step: { fontSize: font.body, fontWeight: '800', color: color.text },
  reason: { fontSize: font.small, fontWeight: '700', color: color.muted },
  calRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  calDone: { fontSize: font.small, fontWeight: '800', color: color.text },
  calLink: { fontSize: font.small, fontWeight: '800', color: color.primary, textDecorationLine: 'underline' },
  calError: { fontSize: font.small, fontWeight: '700', color: color.danger },
  note: { gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.line },
  appliedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  appliedText: { fontSize: font.small, fontWeight: '700', color: color.muted },
});
