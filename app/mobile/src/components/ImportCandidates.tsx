// 課題の取り込みの候補の一覧（契約 §3.3 POST /api/goals/extract の応答）。
// 本人が選んで、名前と期限を直してから目標にする。AI は目標の中身を作らない（P1）。
// 画面から切り出した純粋な関数（行の作り方・検査・送る中身）もここに置き、試験する。

import { StyleSheet, Text, View } from 'react-native';
import type { ExtractCandidate, ISODate, ReflectImage } from '../api/types';
import { deadlineFromDays, parseDateInput } from '../lib/goalForm';
import { color, font, space } from '../theme';
import { Card, Chip, ErrorLine, Field } from './ui';

export const MAX_IMPORT_TEXT = 6000; // 貼る文の上限（契約）
export const MAX_IMPORT_PICK = 10; // 候補は最大 10 件
export const DEFAULT_DAYS = 7; // 期限が読めなかった候補は、仮に 1 週間後にする

export interface ImportRow {
  key: string;
  picked: boolean;
  text: string;
  date: string; // 「2026/11/20」の形。本人が直せる
  guessed: boolean; // 期限が読めず、仮の日付を入れた
  note?: string;
}

const pad = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;

// 送る中身。文が空白だけで写真も無ければ null（送らない）
export function extractBody(text: string, images: ReflectImage[]): { text?: string; images?: ReflectImage[] } | null {
  const t = text.trim();
  if (!t && images.length === 0) return null;
  return { ...(t ? { text: t.slice(0, MAX_IMPORT_TEXT) } : {}), ...(images.length > 0 ? { images } : {}) };
}

// 候補を一覧の行にする。はじめは全部選んだ状態（多すぎる分は外す）
export function toRows(candidates: ExtractCandidate[], now: Date = new Date()): ImportRow[] {
  return candidates.slice(0, MAX_IMPORT_PICK).map((c, i) => {
    const d = c.deadline ? new Date(c.deadline) : null;
    const ok = d !== null && !Number.isNaN(d.getTime());
    return {
      key: `c${i}`,
      picked: true,
      text: c.text,
      date: pad(ok ? d : deadlineFromDays(DEFAULT_DAYS, now)),
      guessed: !ok,
      ...(c.note ? { note: c.note } : {}),
    };
  });
}

// 1 行の問題（選んだ行だけ見る）。無ければ null
export function rowProblem(row: ImportRow, now: Date = new Date()): string | null {
  if (!row.picked) return null;
  const t = row.text.trim();
  if (t.length === 0) return '名前を入れてください';
  if (t.length > 500) return '名前は 500 文字まで';
  if (!parseDateInput(row.date, now)) return '期限は明日より後の日付にしてください';
  return null;
}

// 「目標にする」で送る中身。1 つでも問題があれば null。minutesPerDay は null（おまかせ）
export function goalsToCreate(
  rows: ImportRow[],
  now: Date = new Date(),
): { key: string; body: { text: string; deadline: ISODate; minutesPerDay: null } }[] | null {
  const picked = rows.filter((r) => r.picked);
  if (picked.length === 0 || picked.length > MAX_IMPORT_PICK) return null;
  if (picked.some((r) => rowProblem(r, now) !== null)) return null;
  return picked.map((r) => ({
    key: r.key,
    body: { text: r.text.trim(), deadline: parseDateInput(r.date, now)!.toISOString(), minutesPerDay: null },
  }));
}

export function ImportCandidates(props: { rows: ImportRow[]; onChange: (rows: ImportRow[]) => void }) {
  const { rows, onChange } = props;
  const set = (key: string, patch: Partial<ImportRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <View style={styles.list}>
      {rows.map((r) => (
        <Card key={r.key} style={[styles.card, !r.picked && styles.off]}>
          <Chip
            label={r.picked ? '✓ 選んだ' : '選ぶ'}
            selected={r.picked}
            onPress={() => set(r.key, { picked: !r.picked })}
            style={styles.pick}
            testID={`import-pick-${r.key}`}
          />
          <Field label="名前" value={r.text} onChangeText={(t) => set(r.key, { text: t })} maxLength={500} testID={`import-text-${r.key}`} />
          <Field
            label={r.guessed ? '仮の期限' : '期限'}
            value={r.date}
            onChangeText={(t) => set(r.key, { date: t, guessed: false })}
            placeholder="2026/11/20"
            maxLength={10}
            testID={`import-date-${r.key}`}
          />
          {r.note ? <Text style={styles.note}>{r.note}</Text> : null}
          <ErrorLine text={rowProblem(r)} />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  card: { gap: space.sm },
  off: { opacity: 0.6 },
  pick: { alignSelf: 'flex-start' },
  note: { fontSize: font.body, color: color.muted },
});
