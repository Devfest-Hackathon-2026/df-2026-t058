// 画面の主役のモルティ（UI 刷新・11/9）。吹き出し＋次に押すボタン（1〜3 個）＋話しかける欄。
// 話しかけると POST /api/agent/chat（集中の外・進め方だけ・契約 §3.12）。中身の質問には、モルティが集中へ誘導する。
// ボタンは押した時だけ移る（モルティは自分で移らない・P1）。会話の履歴は画面の中だけ（端末にも残さない）。

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, errorText } from '../api';
import type { AgentAction, AgentScreen, AgentTurn, HomeData } from '../api/types';
import type { AgentLine } from '../lib/agentLines';
import { COPY_MOLTY_INPUT, COPY_MOLTY_INPUT_HINT, COPY_MOLTY_SEND } from '../lib/copy';
import { actionKey, actionLabel, actionPath } from '../lib/moltyActions';
import { color, font, radius, space } from '../theme';
import { AgentSays } from './AgentSays';
import { BigButton, Field } from './ui';

type GoalEntry = HomeData['goals'][number];

export const MOLTY_HISTORY_MAX = 6;
export const MOLTY_MESSAGE_MAX = 300;
// 画面に残す前のやり取りの数（2 往復）
export const EARLIER_MAX = 4;

// 履歴は直近 6 件・1 件 300 字まで（契約 §3.12）
export function pushTurns(history: AgentTurn[], ...turns: AgentTurn[]): AgentTurn[] {
  const cut = turns.map((t) => ({ from: t.from, text: Array.from(t.text).slice(0, MOLTY_MESSAGE_MAX).join('') })).filter((t) => t.text.trim());
  return [...history, ...cut].slice(-MOLTY_HISTORY_MAX);
}

// モルティとの会話の状態（話しかける前の発言・最新の返事・少し前のやり取り）。
// MoltyPanel と、配置を自分で組むホーム（#315）の両方が使う
export function useMoltyChat(props: { screen: AgentScreen; goalId?: string; line: AgentLine; actions: AgentAction[] }) {
  const { screen, goalId } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [reply, setReply] = useState<{ line: AgentLine; actions: AgentAction[]; asked: string } | null>(null);
  const history = useRef<AgentTurn[]>([]);
  // 画面に残す前のやり取り（会話の場所を広く・11/9 本人）。最新の 1 往復は下の吹き出しで出すので、それより前だけ
  const [earlier, setEarlier] = useState<AgentTurn[]>([]);

  // 画面の状況（話しかける前の発言）が変わったら、会話を閉じて元に戻す
  useEffect(() => {
    setReply(null);
    history.current = [];
    setEarlier([]);
  }, [props.line.text]);

  // said を渡すと、その文を送る（声で話した時）。渡さなければ打ち込んだ文を送る
  const send = async (said?: string) => {
    const message = (said ?? text).trim();
    if (!message || busy) return;
    setBusy(true);
    setPending(message);
    try {
      const r = await api.agentChat({ screen, ...(goalId ? { goalId } : {}), message, history: history.current });
      setEarlier(history.current.slice(-EARLIER_MAX));
      history.current = pushTurns(history.current, { from: 'me', text: message }, { from: 'agent', text: r.reply });
      setReply({ line: { text: r.reply, short: r.reply }, actions: r.actions, asked: message });
      if (said === undefined) setText('');
    } catch (e) {
      // 失敗もモルティの言葉で（責めない・次の手を言う）。入力は残す
      setReply({ line: { text: errorText(e), short: errorText(e) }, actions: [], asked: message });
    } finally {
      setBusy(false);
    }
  };

  const shown = reply ?? { line: props.line, actions: props.actions };
  return { text, setText, busy, pending, reply, earlier, shown, send };
}

export function MoltyPanel(props: {
  screen: AgentScreen;
  goalId?: string;
  line: AgentLine; // 話しかける前の発言
  actions: AgentAction[]; // 話しかける前のボタン
  goals?: GoalEntry[]; // ボタンのラベル（分・一歩の名前）に使う
  done?: boolean;
  chat?: boolean; // 話しかける欄を出すか（既定は出す）
  testID?: string;
}) {
  const { goals = [], chat = true, testID = 'molty' } = props;
  const { text, setText, busy, reply, earlier, shown, send } = useMoltyChat(props);
  const go = (a: AgentAction) => router.push(actionPath(a) as never);

  return (
    <View style={styles.root} testID={testID}>
      {/* 少し前のやり取り（最大 2 往復）。薄く小さく出し、最新の 1 往復を主役にする */}
      {earlier.map((t, i) => (
        <Text key={i} style={[styles.past, t.from === 'me' ? styles.pastMine : styles.pastAgent]} numberOfLines={3} testID={`${testID}-past-${i}`}>
          {t.text}
        </Text>
      ))}
      {/* 直前の自分の言葉 */}
      {reply || busy ? (
        <Text style={styles.mine} numberOfLines={2} testID={`${testID}-mine`}>
          {reply?.asked ?? text}
        </Text>
      ) : null}
      <AgentSays text={shown.line.text} short={shown.line.short} waiting={busy} done={!reply && props.done} testID={`${testID}-says`} />
      {shown.actions.length > 0 ? (
        <View style={styles.actions}>
          {shown.actions.map((a, i) => (
            <BigButton
              key={actionKey(a)}
              label={actionLabel(a, goals, i === 0)}
              variant={i === 0 ? 'primary' : 'plain'}
              size={i === 0 ? 'big' : 'small'}
              onPress={() => go(a)}
              testID={`${testID}-action-${i}`}
            />
          ))}
        </View>
      ) : null}
      {chat ? (
        <View style={styles.inputRow}>
          <View style={styles.grow}>
            <Field
              value={text}
              onChangeText={setText}
              placeholder={COPY_MOLTY_INPUT_HINT}
              accessibilityLabel={COPY_MOLTY_INPUT}
              maxLength={MOLTY_MESSAGE_MAX}
              returnKeyType="send"
              onSubmitEditing={() => void send()}
              voice
              testID={`${testID}-input`}
            />
          </View>
          {text.trim() ? (
            <BigButton label={COPY_MOLTY_SEND} size="small" variant="plain" busy={busy} onPress={() => void send()} testID={`${testID}-send`} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 会話の場所は広めに（11/9 本人「モルティとの会話のスペースを広く」）
  root: { gap: space.lg, paddingVertical: space.md },
  actions: { gap: space.md },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  grow: { flex: 1 },
  past: {
    maxWidth: '85%',
    fontSize: font.small,
    color: color.muted,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  pastMine: { alignSelf: 'flex-end', backgroundColor: color.surfaceSunk },
  pastAgent: { alignSelf: 'flex-start', backgroundColor: color.surface },
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
});
