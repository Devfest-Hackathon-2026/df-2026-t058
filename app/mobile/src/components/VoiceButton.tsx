// 声で話すボタン（Web だけ）。押すと録音が始まり、もう一度押すと止まる・最大 60 秒で自動で止まる。
// 音声はメモリだけ（保存しない）。VoiceFill は、録音を文字にして入力欄の末尾に足す（自動では送らない）。

import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReflectAudio } from '../api/types';
import {
  audioTooBig,
  canRecordVoice,
  MAX_VOICE_SEC,
  pickAudioMime,
  recNext,
  secText,
  type RecEvent,
  type RecPhase,
} from '../lib/voice';
import { appendTranscript, transcribeErrorText } from '../lib/voiceFill';
import { COPY_VOICE_PRESS } from '../lib/copy';
import { color, font, radius, space, touch } from '../theme';
import { MicIcon } from './Icons';

// 押す前は薄い地＋主色のマイク、押している間は主色の塗り＋白いマイク。
// big（画面の下の主役のマイク・#315）は、押す前から主色の塗り＋白いマイク、押している間は一段濃く
export function voiceLook(recording: boolean, big = false) {
  if (big) {
    return recording
      ? { circle: { backgroundColor: color.primaryLip, borderColor: color.primaryLip }, iconColor: color.onPrimary }
      : { circle: { backgroundColor: color.primary }, iconColor: color.onPrimary };
  }
  return recording
    ? { circle: { backgroundColor: color.primary }, iconColor: color.onPrimary }
    : { circle: { backgroundColor: color.primarySoft }, iconColor: color.primary };
}

export interface Voice {
  audio: ReflectAudio;
  sec: number;
}

type Recorder = { stop(): void };

function webEnv() {
  const g = globalThis as { navigator?: Navigator; MediaRecorder?: typeof MediaRecorder };
  return {
    os: Platform.OS,
    hasGetUserMedia: typeof g.navigator?.mediaDevices?.getUserMedia === 'function',
    recorder: g.MediaRecorder,
  };
}

export const canRecord = () => canRecordVoice(webEnv());

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function Pulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 500, useNativeDriver: false }),
        Animated.timing(v, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }],
        },
      ]}
    />
  );
}

// 録音のボタン。押すと録音が始まり、もう一度押すと止まる（maxSec で自動で止まる）。
// できた録音は onDone に渡す（大きすぎたら onError）。small＝入力欄の右に置く小さな形（「話す」の文字なし）
export function VoiceButton(props: {
  onDone: (v: Voice) => void;
  onError: (text: string) => void;
  maxSec?: number;
  small?: boolean;
  big?: boolean; // 画面の下の主役のマイク（大きな丸・「押して話す」）
  label?: string; // big の下の言葉（既定は「押して話す」）
  disabled?: boolean;
  testID?: string;
}) {
  const { maxSec = MAX_VOICE_SEC, small = false, big = false } = props;
  const [phase, setPhase] = useState<RecPhase>('idle');
  const [sec, setSec] = useState(0);
  const phaseRef = useRef<RecPhase>('idle');
  const rec = useRef<Recorder | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      rec.current?.stop();
    };
  }, []);

  const recording = phase === 'recording';

  // 録音中の秒
  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    setSec(0);
    const id = setInterval(() => setSec((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [recording]);

  function go(ev: RecEvent) {
    const next = recNext(phaseRef.current, ev);
    phaseRef.current = next.phase;
    if (alive.current) setPhase(next.phase);
    return next.action;
  }

  async function ask() {
    const env = webEnv();
    const mime = pickAudioMime((m) => env.recorder?.isTypeSupported(m) ?? false);
    if (!env.recorder || !mime) {
      go('denied');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      go('denied');
      if (alive.current) props.onError('マイクが使えません');
      return;
    }
    const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
    // 許可を待つ間に押し直した・画面を離れた時は、録音を始めずにマイクを放す
    if (!alive.current || go('granted') !== 'start') {
      stopTracks();
      return;
    }
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const mr = new env.recorder(stream, { mimeType: mime });
    const timer = setTimeout(() => {
      if (go('timeout') === 'stop' && mr.state !== 'inactive') mr.stop();
    }, maxSec * 1000);
    mr.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    mr.onstop = async () => {
      clearTimeout(timer);
      stopTracks();
      rec.current = null;
      if (phaseRef.current === 'recording') go('press'); // 外から止まった時も idle に戻す
      if (!alive.current) return; // 画面を離れた（音声は捨てる）
      try {
        if (chunks.length === 0) return;
        const dataBase64 = await toBase64(new Blob(chunks, { type: mime }));
        const audio: ReflectAudio = { mimeType: mime, dataBase64 };
        if (audioTooBig(audio)) props.onError('音声が大きすぎます。短く話し直してください');
        else props.onDone({ audio, sec: Math.min(maxSec, (Date.now() - startedAt) / 1000) });
      } catch {
        props.onError('録音を読めませんでした');
      }
    };
    rec.current = mr;
    mr.start();
  }

  function press() {
    const action = go('press');
    if (action === 'ask') void ask();
    else if (action === 'stop') rec.current?.stop();
  }

  const look = voiceLook(recording, big);
  const size = big ? styles.btnBig : small ? styles.btnSmall : styles.btn;
  return (
    <View style={small ? styles.wrapSmall : styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={recording ? '録音を止める' : '声で話す'}
        accessibilityState={{ disabled: !!props.disabled, busy: phase === 'asking' }}
        disabled={props.disabled && !recording}
        onPress={press}
        testID={props.testID ?? 'voice'}
        style={[size, look.circle, props.disabled && !recording && styles.off]}
      >
        {recording ? <Pulse /> : null}
        <MicIcon size={big ? 34 : small ? 20 : 28} color={look.iconColor} />
      </Pressable>
      {recording ? (
        <Text style={styles.label} testID="voice-sec">{secText(sec)}</Text>
      ) : small ? null : (
        <Text style={big ? styles.labelBig : styles.label}>{big ? (props.label ?? COPY_VOICE_PRESS) : '話す'}</Text>
      )}
    </View>
  );
}

// 声で入力欄を埋める。録音を止めたら文字にして、今の値の末尾に（空白 1 つを挟んで）足す。自動では送らない。
// busy の間は小さな点、失敗は error（欄の下に 1 行）。書き起こしの文はログに出さない・保存しない
export function useVoiceFill(value: string, onChangeText: ((t: string) => void) | undefined, max?: number) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ value, onChangeText });
  latest.current = { value, onChangeText };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function onDone(v: Voice) {
    setError(null);
    setBusy(true);
    try {
      // 窓口は使う時に読む（共通の部品 ui.tsx から端末の保存の仕組みを読み込まないように）
      const { api } = await import('../api');
      const r = await api.transcribe(v.audio);
      if (!alive.current) return;
      const { value: cur, onChangeText: set } = latest.current;
      const next = appendTranscript(cur, r.text ?? '', max);
      if (next !== cur) set?.(next);
    } catch (e) {
      if (alive.current) setError(transcribeErrorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return { busy, error, onDone, onError: (t: string) => setError(t) };
}

// 録音できた物を見せる小さなつまみ（再生・長さ・消す）
export function VoiceChip(props: { voice: Voice; onRemove: () => void }) {
  const [playing, setPlaying] = useState(false);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => el.current?.pause(), []);

  function play() {
    if (playing) {
      el.current?.pause();
      setPlaying(false);
      return;
    }
    const { mimeType, dataBase64 } = props.voice.audio;
    const a = new Audio(`data:${mimeType};base64,${dataBase64}`);
    a.onended = () => setPlaying(false);
    el.current = a;
    setPlaying(true);
    a.play().catch(() => setPlaying(false));
  }

  return (
    <View style={styles.chip} testID="voice-chip">
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? '止める' : '再生'} onPress={play} style={styles.play}>
        <Text style={styles.playText}>{playing ? '■' : '▶'}</Text>
      </Pressable>
      <Text style={styles.sec}>{secText(props.voice.sec)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="消す" onPress={props.onRemove} style={styles.x}>
        <Text style={styles.xText}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.xs },
  btn: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 主役のマイク: 大きな塗りの丸に、薄い地の輪（押せる物だと分かる太さ）
  btnBig: {
    width: 84,
    height: 84,
    borderRadius: radius.full,
    borderWidth: 9,
    borderColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelBig: { color: color.muted, fontSize: font.small, fontWeight: '700' },
  wrapSmall: { alignItems: 'center' },
  btnSmall: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  off: { opacity: 0.4 },
  label: { color: color.text, fontSize: font.small, fontWeight: '800' },
  ring: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: color.danger,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    minHeight: touch.min,
    paddingHorizontal: space.sm,
    borderRadius: radius.full,
    backgroundColor: color.primarySoft,
  },
  play: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  playText: { color: color.onPrimary, fontWeight: '900' },
  sec: { color: color.text, fontWeight: '800' },
  x: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  xText: { color: color.text, fontWeight: '900' },
});
