// 画面の下に置く、モルティに話しかける所（#315・声が主役）。
// 大きなマイクを押して話す → 文字にしてそのまま送る。打ち込みたい時だけ左のキーボードの丸で小さな欄を開く。
// onShow を渡すと、右にクリップの丸（見せる＝写真・ファイル・貼る）を置く。丸は絵だけで、読み上げの名前を持つ（本人 11/9）。
// 声を録れない端末（ネイティブ版など）では、はじめから小さな欄を出す。

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY_MOLTY_INPUT, COPY_MOLTY_INPUT_HINT, COPY_MOLTY_SEND, COPY_SHOW_OPEN, COPY_TYPE_OPEN } from '../lib/copy';
import { ClipIcon, KeyboardIcon } from './Icons';
import { transcribeErrorText } from '../lib/voiceFill';
import { tap } from '../lib/haptics';
import { color, font, radius, space, touch } from '../theme';
import { BigButton, ErrorLine, Field } from './ui';
import { canRecord, VoiceButton, type Voice } from './VoiceButton';
import { MOLTY_MESSAGE_MAX } from './MoltyPanel';

export function MoltyDock(props: {
  text: string;
  setText: (t: string) => void;
  busy: boolean;
  send: (said?: string) => void | Promise<void>;
  hint?: string; // 打ち込む欄の例（既定はモルティへの相談の例）
  onShow?: () => void; // 見せる（写真・ファイル・貼る）。渡した時だけ右に丸を置く
  testID?: string;
}) {
  const { text, setText, busy, send, hint = COPY_MOLTY_INPUT_HINT, onShow, testID = 'dock' } = props;
  const voice = canRecord();
  const [typing, setTyping] = useState(!voice);
  const [hearing, setHearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 録音を文字にして、そのまま送る（会話なので、聞き取った文は自分の吹き出しに出る）
  async function onVoice(v: Voice) {
    setError(null);
    setHearing(true);
    try {
      const { api } = await import('../api');
      const r = await api.transcribe(v.audio);
      const said = (r.text ?? '').trim();
      if (said) await send(Array.from(said).slice(0, MOLTY_MESSAGE_MAX).join(''));
    } catch (e) {
      setError(transcribeErrorText(e));
    } finally {
      setHearing(false);
    }
  }

  const typeOpen = (
    <RoundIcon label={COPY_TYPE_OPEN} onPress={() => setTyping(true)} testID={`${testID}-type`}>
      <KeyboardIcon color={color.muted} />
    </RoundIcon>
  );
  const show = onShow ? (
    <RoundIcon label={COPY_SHOW_OPEN} onPress={onShow} testID={`${testID}-show`}>
      <ClipIcon color={color.muted} />
    </RoundIcon>
  ) : (
    <View style={styles.round} />
  );

  return (
    <View style={styles.root} testID={testID}>
      {/* 真ん中に大きなマイク。左に打ち込む（キーボード）、右に見せる（クリップ）の小さな丸 */}
      {voice ? (
        <View style={styles.micRow}>
          {typing ? <View style={styles.round} /> : typeOpen}
          <VoiceButton big onDone={(v) => void onVoice(v)} onError={setError} disabled={busy || hearing} testID={`${testID}-mic`} />
          {show}
        </View>
      ) : null}
      <ErrorLine text={error} />
      {typing ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Field
              value={text}
              onChangeText={setText}
              placeholder={hint}
              accessibilityLabel={COPY_MOLTY_INPUT}
              maxLength={MOLTY_MESSAGE_MAX}
              returnKeyType="send"
              onSubmitEditing={() => void send()}
              autoFocus={voice}
              style={styles.input}
              testID={`${testID}-input`}
            />
          </View>
          {text.trim() ? <BigButton label={COPY_MOLTY_SEND} size="small" variant="plain" busy={busy} onPress={() => void send()} testID={`${testID}-send`} /> : null}
          {!voice && onShow ? show : null}
        </View>
      ) : null}
    </View>
  );
}

// 大きなマイクの左右に、打ち込む（キーボード）と見せる（クリップ）の丸を置く行。集中・振り返りの dock でも同じ形にする（#315）
export function MicRow(props: {
  mic: ReactNode;
  onType?: () => void; // 無い時（打ち込む欄を開いている時）は左を空ける
  onShow?: () => void;
  showLabel?: string;
  showDisabled?: boolean;
  testID: string;
}) {
  return (
    <View style={styles.micRow}>
      {props.onType ? (
        <RoundIcon label={COPY_TYPE_OPEN} onPress={props.onType} testID={`${props.testID}-type`}>
          <KeyboardIcon color={color.muted} />
        </RoundIcon>
      ) : (
        <View style={styles.round} />
      )}
      {props.mic}
      {props.onShow ? (
        <RoundIcon label={props.showLabel ?? COPY_SHOW_OPEN} onPress={props.onShow} disabled={props.showDisabled} testID={`${props.testID}-show`}>
          <ClipIcon color={color.muted} />
        </RoundIcon>
      ) : (
        <View style={styles.round} />
      )}
    </View>
  );
}

// 絵だけの小さな丸いボタン（押せる大きさは 48 を保つ・読み上げの名前は label）
export function RoundIcon(props: { label: string; onPress: () => void; children: ReactNode; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      {...({ title: props.label } as object)}
      onPress={() => {
        tap();
        props.onPress();
      }}
      style={({ pressed }) => [styles.round, styles.roundOn, props.disabled && { opacity: 0.4 }, pressed && { opacity: 0.6, transform: [{ scale: 0.95 }] }]}
      testID={props.testID}
    >
      {props.children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, width: '100%' },
  grow: { flex: 1 },
  input: { minHeight: 40, paddingVertical: space.xs },
  micRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  round: { width: 52, height: 52, minWidth: touch.min, minHeight: touch.min },
  roundOn: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: color.edge,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
