// 目標の資料の板（11/9 本人「一度共有された資料は、そのタスクの間ずっと残し、見返し・直せるように」）。
// 下から出る板で、資料の一覧（見返す・直す・外す）と、足す欄（写真・ファイルは文字にして捨てる＝文字だけ残す・P10）。
// 足した資料は、案づくり・道の相談・集中中の相談・振り返りの判定でモルティが使う（サーバーが目標の資料として渡す）。

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, errorText } from '../api';
import type { Goal, GoalDoc } from '../api/types';
import { COPY_CLOSE, COPY_DOCS_ADD, COPY_DOCS_EDIT, COPY_DOCS_EMPTY, COPY_DOCS_KEEP, COPY_DOCS_NOTE, COPY_DOCS_REMOVE, COPY_DOCS_REMOVE_ASK, COPY_DOCS_TITLE } from '../lib/copy';
import { color, font, radius, space, touch } from '../theme';
import { MaterialsField } from './MaterialsField';
import { BigButton, ErrorLine, Field, TextLink } from './ui';

const FROM_LABEL: Record<GoalDoc['from'], string> = { goal: '足す時', plan: '道を決める時', focus: '集中の時', reflect: '振り返りの時' };

export { docsCount } from '../lib/goalDocs';

function DocItem(props: { goalId: string; doc: GoalDoc; onSaved: (d: GoalDoc) => void; onRemoved: (id: string) => void }) {
  const { goalId, doc } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(doc.text);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      props.onSaved(await api.updateGoalDoc(goalId, doc.id, { text: text.trim() }));
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteGoalDoc(goalId, doc.id);
      props.onRemoved(doc.id);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <View style={styles.item} testID={`goal-doc-${doc.id}`}>
      <Text style={styles.title}>{doc.title}</Text>
      <Text style={styles.from}>{FROM_LABEL[doc.from]}</Text>
      {editing ? (
        <Field value={text} onChangeText={setText} multiline maxLength={2000} accessibilityLabel={doc.title} testID={`goal-doc-input-${doc.id}`} />
      ) : (
        <Text style={styles.body}>{doc.text}</Text>
      )}
      <ErrorLine text={error} />
      <View style={styles.acts}>
        {editing ? (
          <>
            <TextLink label={COPY_DOCS_KEEP} onPress={() => void save()} testID={`goal-doc-save-${doc.id}`} />
            <TextLink label="やめる" onPress={() => (setEditing(false), setText(doc.text))} />
          </>
        ) : asking ? (
          <>
            <Text style={styles.ask}>{COPY_DOCS_REMOVE_ASK}</Text>
            <TextLink label={COPY_DOCS_REMOVE} onPress={() => void remove()} testID={`goal-doc-remove-ok-${doc.id}`} />
            <TextLink label="やめる" onPress={() => setAsking(false)} />
          </>
        ) : (
          <>
            <TextLink label={COPY_DOCS_EDIT} onPress={() => setEditing(true)} testID={`goal-doc-edit-${doc.id}`} />
            <TextLink label={COPY_DOCS_REMOVE} onPress={() => setAsking(true)} testID={`goal-doc-remove-${doc.id}`} />
          </>
        )}
        {busy ? <Text style={styles.from}>…</Text> : null}
      </View>
    </View>
  );
}

export function GoalDocsSheet(props: {
  goal: Pick<Goal, 'id' | 'text' | 'docs' | 'materials'>;
  from: GoalDoc['from'];
  visible: boolean;
  onClose: () => void;
  onChange?: (docs: GoalDoc[]) => void;
}) {
  const { goal, from, visible, onClose } = props;
  const [docs, setDocs] = useState<GoalDoc[]>(goal.docs ?? []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (next: GoalDoc[]) => {
    setDocs(next);
    props.onChange?.(next);
  };

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.addGoalDoc(goal.id, { text: draft.trim(), from });
      update([...docs, d]);
      setDraft('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.veil} onPress={onClose} accessibilityLabel={COPY_CLOSE} />
      <View style={styles.sheet} testID="goal-docs-sheet">
        <Text style={styles.head}>{COPY_DOCS_TITLE}</Text>
        <Text style={styles.goal} numberOfLines={2}>
          {goal.text}
        </Text>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          {goal.materials?.trim() ? (
            <View style={styles.item}>
              <Text style={styles.title}>{goal.materials.trim().split('\n')[0]}</Text>
              <Text style={styles.from}>{FROM_LABEL.goal}</Text>
              <Text style={styles.body}>{goal.materials.trim()}</Text>
            </View>
          ) : null}
          {docs.map((d) => (
            <DocItem
              key={d.id}
              goalId={goal.id}
              doc={d}
              onSaved={(x) => update(docs.map((y) => (y.id === x.id ? x : y)))}
              onRemoved={(id) => update(docs.filter((y) => y.id !== id))}
            />
          ))}
          {docs.length === 0 && !goal.materials?.trim() ? <Text style={styles.empty}>{COPY_DOCS_EMPTY}</Text> : null}
          <View style={styles.add}>
            <MaterialsField label={COPY_DOCS_ADD} value={draft} onChange={setDraft} testID="goal-docs-new" />
            {draft.trim() ? <BigButton label={COPY_DOCS_KEEP} busy={busy} onPress={() => void add()} testID="goal-docs-add" /> : null}
            <ErrorLine text={error} />
            <Text style={styles.note}>{COPY_DOCS_NOTE}</Text>
          </View>
        </ScrollView>
        <View style={styles.center}>
          <TextLink label={COPY_CLOSE} onPress={onClose} testID="goal-docs-close" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  veil: { flex: 1 },
  sheet: {
    backgroundColor: color.bg,
    borderTopWidth: 2,
    borderColor: color.line,
    borderTopLeftRadius: radius.box,
    borderTopRightRadius: radius.box,
    padding: space.lg,
    paddingBottom: space.xl,
    gap: space.sm,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '85%',
  },
  scroll: { flexGrow: 0 },
  head: { fontSize: font.small, fontWeight: '700', color: color.muted },
  goal: { fontSize: font.body, fontWeight: '800', color: color.text },
  item: { gap: space.xs, padding: space.md, borderWidth: 1.5, borderColor: color.line, borderRadius: radius.box, backgroundColor: color.surface, marginTop: space.sm },
  title: { fontSize: font.body, fontWeight: '800', color: color.text },
  from: { fontSize: font.small, fontWeight: '700', color: color.muted },
  body: { fontSize: font.small, color: color.text, lineHeight: 22 },
  acts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.lg, minHeight: touch.min },
  ask: { fontSize: font.small, fontWeight: '700', color: color.text },
  empty: { fontSize: font.body, color: color.muted, marginTop: space.sm },
  add: { gap: space.sm, marginTop: space.md },
  note: { fontSize: font.small, color: color.muted },
  center: { flexDirection: 'row', justifyContent: 'center' },
});
