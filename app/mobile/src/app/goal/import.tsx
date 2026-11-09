// 課題を取り込む（契約 §3.3 POST /api/goals/extract）。足す画面と同じ形（#315・準備の帯・モルティの一言・カード・下の大きなマイク）。課題表・LMS の一覧・メールの文を貼るか、写真を撮る
// → AI が課題の名前と期限の候補を拾う（保存しない）→ 本人が選んで直す →「目標にする」で 1 つずつ POST /api/goals。
// 1 日の時間はおまかせ（null）。案はここでは作らない（ホームから各目標で作る）。

import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorText } from '../../api';
import type { ReflectImage } from '../../api/types';
import {
  extractBody,
  goalsToCreate,
  ImportCandidates,
  MAX_IMPORT_TEXT,
  toRows,
  type ImportRow,
} from '../../components/ImportCandidates';
import { AgentSays } from '../../components/AgentSays';
import { BigButton, Card, ErrorLine, Field, Screen, TextLink, ThinkingDots } from '../../components/ui';
import { MicRow } from '../../components/MoltyDock';
import { SceneTop } from '../../components/SceneTop';
import { canRecord, VoiceButton, type Voice } from '../../components/VoiceButton';
import { COPY_PREP_QUIT } from '../../lib/copy';
import { transcribeErrorText } from '../../lib/voiceFill';
import { AGENT_LINES, importFound, importIntro } from '../../lib/agentLines';
import { calendarErrorText, eventsToText, fetchEvents, requestToken, showGoogleButton } from '../../lib/googleCalendar';
import { classroomErrorText, classroomToText, readClassroom, requestClassroomToken } from '../../lib/googleClassroom';
import { icsFileToText } from '../../lib/ics';
import { canUseCamera, MAX_PHOTOS, pickPhotos, preparePhoto } from '../../lib/photo';
import { useTabTitle } from '../../lib/tabTitle';
import { color, font, space } from '../../theme';

// Web 専用の部品（native では呼ばれない）。tsc がブラウザの型を持たない場合に備えて宣言する
declare const document: any;
declare const FileReader: any;

export default function ImportGoals() {
  useTabTitle('課題を取り込む');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<ReflectImage[]>([]); // メモリだけ。送ったら捨てる
  const [rows, setRows] = useState<ImportRow[] | null>(null); // null = まだ候補を出していない
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null); // 公開の値（秘密ではない）
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [classroomBusy, setClassroomBusy] = useState(false);

  // Web だけ: Google カレンダーのボタンを出すか、サーバーの設定で決める（取れなければ出さない）
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    api
      .config()
      .then((c) => alive && setGoogleClientId(c.googleClientId))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const body = extractBody(text, photos);
  const toCreate = rows ? goalsToCreate(rows) : null;

  async function addPhotos(mode: 'camera' | 'library') {
    setError(null);
    try {
      const picked = await pickPhotos(mode, MAX_PHOTOS - photos.length);
      const next: ReflectImage[] = [];
      for (const p of picked) next.push((await preparePhoto(p)).image);
      setPhotos((cur) => [...cur, ...next].slice(0, MAX_PHOTOS));
    } catch {
      setError('写真を読めませんでした');
    }
  }

  // Web だけ: .ics を端末の中で読み、予定の文を入力欄に入れる（ファイルそのものは送らない）
  function pickIcs() {
    setError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ics,text/calendar';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const out = icsFileToText(String(reader.result ?? ''));
        if (!out) {
          setError('今日から 60 日以内の予定が見つかりませんでした');
          return;
        }
        setText(out.slice(0, MAX_IMPORT_TEXT));
      };
      reader.onerror = () => setError('ファイルを読めませんでした');
      reader.readAsText(file);
    };
    input.click();
  }

  async function extract() {
    if (!body) return;
    setReading(true);
    setError(null);
    try {
      const r = await api.extractGoals(body);
      if (r.candidates.length === 0) {
        setError('課題を見つけられませんでした。文を足すか、別の写真で試してください');
        return;
      }
      setPhotos([]);
      setRows(toRows(r.candidates));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReading(false);
    }
  }

  // Web だけ: Google カレンダーを読み取り専用で読み、予定の文を入力欄に入れる。
  // トークンはこの関数の中の変数だけ（状態や保存先に置かない）。予定はサーバーに送らない
  async function readGoogleCalendar() {
    if (!googleClientId) return;
    setError(null);
    setCalendarBusy(true);
    try {
      const token = await requestToken(googleClientId);
      const out = eventsToText(await fetchEvents(token, new Date()));
      if (!out) {
        setError('今日から 60 日以内の予定が見つかりませんでした');
        return;
      }
      setText(out.slice(0, MAX_IMPORT_TEXT));
    } catch (e) {
      setError(calendarErrorText(e));
    } finally {
      setCalendarBusy(false);
    }
  }

  // Web だけ: Google Classroom の課題を読み取り専用で読み、未提出の課題の文を入力欄に入れる。
  // トークンはこの関数の中の変数だけ（状態や保存先に置かない）。課題はサーバーに送らない
  async function readGoogleClassroom() {
    if (!googleClientId) return;
    setError(null);
    setClassroomBusy(true);
    try {
      const token = await requestClassroomToken(googleClientId);
      const r = await readClassroom(token);
      const out = classroomToText(r.courses, r.works, r.subs, new Date());
      if (!out) {
        setError('未提出で、期限が今日より後の課題はありませんでした');
        return;
      }
      setText(out.slice(0, MAX_IMPORT_TEXT));
    } catch (e) {
      setError(classroomErrorText(e));
    } finally {
      setClassroomBusy(false);
    }
  }

  async function create() {
    if (!toCreate) return;
    setBusy(true);
    setError(null);
    try {
      // 取り込んだ課題は「タスク」（#261）: 目標の文も理由も要らず、「終わった」の 1 歩の道が付く。案の画面は通らない。
      // まとめて 1 回で送る（1 件でも外れたらサーバーは 1 件も作らない）
      await api.importTasks(toCreate.map((g) => ({ title: g.body.text, deadline: g.body.deadline })));
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // 声で課題の文を言う（話した文は欄の後ろに足す・そのまま送らない）
  async function onVoice(v: Voice) {
    setError(null);
    try {
      const r = await api.transcribe(v.audio);
      const said = (r.text ?? '').trim();
      if (said) setText((cur) => (cur.trim() ? `${cur}\n${said}` : said).slice(0, MAX_IMPORT_TEXT));
    } catch (e) {
      setError(transcribeErrorText(e));
    }
  }

  const quit = () => (router.canGoBack() ? router.back() : router.replace('/'));
  // 足す画面と同じ形（#315・準備の帯の 1 本目・モルティの一言・カード・下の大きなマイク）
  const shell = (body: ReactNode, footer?: ReactNode) => (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.top}>
        <SceneTop scene="add" right={<TextLink label={COPY_PREP_QUIT} onPress={quit} testID="import-quit" />} />
      </View>
      <Screen footerPlain footer={footer}>
        <View style={styles.hero}>{body}</View>
      </Screen>
    </SafeAreaView>
  );

  if (rows) {
    const n = rows.filter((r) => r.picked).length;
    return shell(
      <>
        <AgentSays {...importFound(rows.length)} chat done={rows.length > 0} popKey="found" testID="import-agent-found" />
        <ImportCandidates rows={rows} onChange={setRows} />
        <BigButton label={`${n} 件を足す`} disabled={!toCreate} busy={busy} onPress={create} testID="import-create" />
        <View style={styles.center}>
          <TextLink label="貼り直す" onPress={() => setRows(null)} testID="import-back" />
        </View>
        <ErrorLine text={error} />
      </>,
    );
  }

  const google = showGoogleButton(Platform.OS, googleClientId);
  return shell(
    <>
      <AgentSays
        {...(reading ? AGENT_LINES.importReading : importIntro({ google, ics: Platform.OS === 'web' }))}
        chat
        waiting={reading}
        testID="import-agent"
      />
      <Card style={styles.card}>
        <Field
          label="課題の一覧"
          value={text}
          onChangeText={(t) => setText(t.slice(0, MAX_IMPORT_TEXT))}
          placeholder="例: 課題の一覧、お知らせ、メールの文"
          multiline
          maxLength={MAX_IMPORT_TEXT}
          voice
          testID="import-text"
        />
        {/* 取り込んだ予定・課題は、本人が見直してから送る（個人の予定が混ざるため。文は短く 1 行） */}
        {text.trim() ? <Text style={styles.note}>送る前に、入った文を見直してください</Text> : null}
        {photos.length > 0 ? (
          <View style={styles.photoLine}>
            <Text style={styles.lead}>{`写真 ${photos.length} 枚（${MAX_PHOTOS} 枚まで）`}</Text>
            <TextLink label="写真を外す" onPress={() => setPhotos([])} testID="import-clear" />
          </View>
        ) : null}
        {reading ? <ThinkingDots label="課題を探しています" /> : null}
      </Card>
      {body && !reading ? <BigButton label="課題を拾う" busy={reading} onPress={extract} testID="import-extract" /> : null}
      {/* ほかの読み込み方は小さなリンクに（ボタンは 1 画面に 1 つ） */}
      <View style={styles.links}>
        {canUseCamera ? (
          <TextLink label="撮る" onPress={() => void addPhotos('camera')} testID="import-camera" />
        ) : null}
        {Platform.OS === 'web' ? <TextLink label="カレンダーのファイルを選ぶ" onPress={pickIcs} testID="import-ics" /> : null}
        {google ? (
          <TextLink label={calendarBusy ? '読み込んでいます…' : 'Google カレンダーから読み込む'} onPress={() => void readGoogleCalendar()} testID="import-google-calendar" />
        ) : null}
        {google ? (
          <TextLink label={classroomBusy ? '読み込んでいます…' : 'Google Classroom から読み込む'} onPress={() => void readGoogleClassroom()} testID="import-google-classroom" />
        ) : null}
      </View>
      {google ? <Text style={styles.small}>Google からの読み込みは、読み取りだけです</Text> : null}
      <ErrorLine text={error} />
    </>,
    canRecord() ? (
      <View style={styles.dock}>
      <MicRow
        mic={<VoiceButton big disabled={reading} onDone={(v) => void onVoice(v)} onError={setError} testID="import-voice" />}
        onShow={photos.length < MAX_PHOTOS ? () => void addPhotos('library') : undefined}
        showLabel="写真を足す"
        testID="import-dock"
      />
      </View>
    ) : undefined,
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg, width: '100%', overflow: 'hidden' },
  top: { paddingHorizontal: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  hero: { gap: space.lg, paddingTop: space.sm },
  card: { gap: space.sm },
  dock: { alignItems: 'center' },
  center: { flexDirection: 'row', justifyContent: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space.lg },
  photoLine: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  lead: { fontSize: font.body, color: color.text },
  note: { fontSize: font.small, color: color.muted },
  small: { fontSize: font.small, color: color.muted, textAlign: 'center' },
});
