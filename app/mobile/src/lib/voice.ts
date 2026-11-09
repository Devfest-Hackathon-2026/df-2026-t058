// 声のふりかえり（Web だけ）。録音は MediaRecorder（標準 API）。音声は端末に保存せず、メモリだけで持つ。
// ここは画面に依存しない関数だけ（試験できるように）。

import type { ReflectAudio, ReflectRequest } from '../api/types';

export const MAX_VOICE_SEC = 60; // 文字起こし（契約 §3.7c: 約 60 秒で画面が止める）
export const MAX_REFLECT_VOICE_SEC = 20; // 振り返りの声（契約 §3.8: 最大 20 秒）
export const MAX_AUDIO_BYTES = 1_500_000; // 契約 §3.8: base64 を戻した後で 1,500,000 バイトまで
export const AUDIO_MIME_ORDER: ReflectAudio['mimeType'][] = ['audio/webm', 'audio/mp4'];

// webm → mp4 の順で、録音できる形式を選ぶ。どちらも無ければ null。
export function pickAudioMime(isSupported: (m: string) => boolean): ReflectAudio['mimeType'] | null {
  return AUDIO_MIME_ORDER.find((m) => isSupported(m)) ?? null;
}

// base64 の文字列が表すバイト数。
export function audioBytes(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

export function audioTooBig(audio: ReflectAudio): boolean {
  return audioBytes(audio.dataBase64) > MAX_AUDIO_BYTES;
}

// 送る本文に audio を載せる。無ければ audio のキーごと付けない。
export function withAudio<T extends Omit<ReflectRequest, 'audio'>>(
  body: T,
  audio: ReflectAudio | null,
): T & { audio?: ReflectAudio } {
  return audio ? { ...body, audio } : body;
}

// この端末で録音できるか（Web で、マイクと MediaRecorder があり、形式を選べる時だけ）
export function canRecordVoice(env: {
  os: string;
  hasGetUserMedia: boolean;
  recorder?: { isTypeSupported(m: string): boolean };
}): boolean {
  const rec = env.recorder;
  if (env.os !== 'web' || !env.hasGetUserMedia || !rec) return false;
  return pickAudioMime((m) => rec.isTypeSupported(m)) !== null;
}

// 録音のボタンの状態。押して始め、もう一度押して止める。
// asking＝マイクの許可を待つ間。その間に押し直したら idle に戻り、後で許可が来てもマイクを放すだけ（録音は始めない）。
export type RecPhase = 'idle' | 'asking' | 'recording';
export type RecEvent = 'press' | 'granted' | 'denied' | 'timeout';
export type RecAction = 'ask' | 'start' | 'stop' | 'release' | 'none';

export function recNext(phase: RecPhase, ev: RecEvent): { phase: RecPhase; action: RecAction } {
  if (ev === 'press') {
    if (phase === 'idle') return { phase: 'asking', action: 'ask' };
    if (phase === 'asking') return { phase: 'idle', action: 'none' };
    return { phase: 'idle', action: 'stop' };
  }
  if (ev === 'granted') return phase === 'asking' ? { phase: 'recording', action: 'start' } : { phase, action: 'release' };
  if (ev === 'denied') return phase === 'asking' ? { phase: 'idle', action: 'none' } : { phase, action: 'none' };
  // timeout: 最大の秒で自動で止める
  return phase === 'recording' ? { phase: 'idle', action: 'stop' } : { phase, action: 'none' };
}

// 長さの表示（例: 7 秒 → "0:07"）
export function secText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
