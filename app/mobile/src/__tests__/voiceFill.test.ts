/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { ApiError } from '../api/errors';
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import { MAX_AUDIO_BYTES, MAX_REFLECT_VOICE_SEC, MAX_VOICE_SEC, recNext, type RecEvent, type RecPhase } from '../lib/voice';
import { appendTranscript, fieldMicShown, TRANSCRIBE_FAIL, TRANSCRIBE_TOO_LONG, transcribeErrorText } from '../lib/voiceFill';

const fs = require('fs');
const path = require('path');
const src = (rel: string): string => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const ZS = String.fromCharCode(0x3000); // 全角の空白（実行時に組み立てる）

describe('appendTranscript（書き起こしを末尾に足す）', () => {
  it('空の欄には、そのまま入る', () => {
    expect(appendTranscript('', '例題 3 が分からない')).toBe('例題 3 が分からない');
  });
  it('既に文がある時は、空白 1 つを挟んで末尾に足す', () => {
    expect(appendTranscript('数学', '例題 3')).toBe('数学 例題 3');
    expect(appendTranscript('数学  \n', '例題 3')).toBe('数学 例題 3');
  });
  it('書き起こしの前後の空白・全角の空白を切る', () => {
    expect(appendTranscript('', `  ${ZS}例題${ZS} `)).toBe('例題');
    expect(appendTranscript(`数学${ZS}`, `${ZS}例題`)).toBe('数学 例題');
    expect(appendTranscript(`${ZS} `, '例題')).toBe('例題');
  });
  it('書き起こしが空なら、今の値のまま', () => {
    expect(appendTranscript('数学', '')).toBe('数学');
    expect(appendTranscript('数学 ', `${ZS} `)).toBe('数学 ');
  });
  it('最大の字数で切る', () => {
    expect(appendTranscript('abc', 'defgh', 6)).toBe('abc de');
    expect(appendTranscript('', 'abcdef', 3)).toBe('abc');
    expect(appendTranscript('abc', 'de')).toBe('abc de');
  });
});

describe('transcribeErrorText（失敗の 1 行）', () => {
  it('413 は「短く話し直して」', () => {
    expect(transcribeErrorText(new ApiError(413, 'too_large', ''))).toBe(TRANSCRIBE_TOO_LONG);
    expect(TRANSCRIBE_TOO_LONG).toContain('短く話し直してください');
  });
  it('それ以外は「文字にできませんでした。もう一度」', () => {
    expect(transcribeErrorText(new ApiError(502, 'upstream_invalid', ''))).toBe(TRANSCRIBE_FAIL);
    expect(transcribeErrorText(new Error('x'))).toBe(TRANSCRIBE_FAIL);
    expect(transcribeErrorText(null)).toBe(TRANSCRIBE_FAIL);
    expect(TRANSCRIBE_FAIL).toBe('文字にできませんでした。もう一度');
  });
});

describe('fieldMicShown（入力欄のマイク）', () => {
  it('既定（voice なし）では出ない', () => {
    expect(fieldMicShown(undefined, true)).toBe(false);
    expect(fieldMicShown(false, true)).toBe(false);
  });
  it('voice を付けて、録音できる端末なら出る', () => expect(fieldMicShown(true, true)).toBe(true));
  it('録音できない端末（権限なし・非対応のブラウザ）では出ない', () => expect(fieldMicShown(true, false)).toBe(false));
});

describe('recNext（押して始め、もう一度押して止める）', () => {
  const run = (events: RecEvent[]) => {
    let phase: RecPhase = 'idle';
    const actions: string[] = [];
    for (const e of events) {
      const n = recNext(phase, e);
      phase = n.phase;
      actions.push(n.action);
    }
    return { phase, actions };
  };
  it('押す → 許可 → 録音 → 押す → 止まる', () => {
    expect(run(['press'])).toEqual({ phase: 'asking', actions: ['ask'] });
    expect(run(['press', 'granted'])).toEqual({ phase: 'recording', actions: ['ask', 'start'] });
    expect(run(['press', 'granted', 'press'])).toEqual({ phase: 'idle', actions: ['ask', 'start', 'stop'] });
  });
  it('許可を待つ間に押し直したら、録音を始めずにマイクを放す', () => {
    expect(run(['press', 'press', 'granted'])).toEqual({ phase: 'idle', actions: ['ask', 'none', 'release'] });
  });
  it('許可されなければ idle に戻る', () => {
    expect(run(['press', 'denied'])).toEqual({ phase: 'idle', actions: ['ask', 'none'] });
  });
  it('最大の秒で自動で止まる（録音中だけ）', () => {
    expect(run(['press', 'granted', 'timeout'])).toEqual({ phase: 'idle', actions: ['ask', 'start', 'stop'] });
    expect(run(['timeout'])).toEqual({ phase: 'idle', actions: ['none'] });
  });
  it('最大は 60 秒（振り返りに渡す声は契約どおり 20 秒）', () => {
    expect(MAX_VOICE_SEC).toBe(60);
    expect(MAX_REFLECT_VOICE_SEC).toBe(20);
  });
});

describe('api.transcribe', () => {
  const audio = { mimeType: 'audio/webm', dataBase64: 'GkXfow==' };
  it('mock は固定の 1 文を返す', async () => {
    const r = await createMockApi({ aiDelayMs: 0 }).transcribe(audio);
    expect(typeof r.text).toBe('string');
    expect(r.text.length).toBeGreaterThan(0);
  });
  it('mock: 上限（1,500,000 バイト）を超えたら 413・空は 400', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    const big = { mimeType: 'audio/webm', dataBase64: 'A'.repeat(Math.ceil((MAX_AUDIO_BYTES + 3) / 3) * 4) };
    await expect(api.transcribe(big)).rejects.toMatchObject({ status: 413, code: 'too_large' });
    await expect(api.transcribe({ mimeType: 'audio/webm', dataBase64: '' })).rejects.toMatchObject({ status: 400 });
  });
  it('http は契約 §3.7c の形 { audio, mimeType } で送る', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, text: async () => JSON.stringify({ text: 'x' }) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test', getUserId: async () => 'u', fetchImpl: f });
    expect(await api.transcribe(audio)).toEqual({ text: 'x' });
    expect(calls[0]).toEqual({ url: 'http://api.test/api/voice/transcribe', body: { audio: 'GkXfow==', mimeType: 'audio/webm' } });
  });
});

describe('原稿の検査', () => {
  it('VoiceButton は「押して始め・もう一度押して止める」（長押しをやめた）', () => {
    const s = src('components/VoiceButton.tsx');
    expect(s).toContain('onPress={press}');
    expect(s.includes('onPressIn')).toBe(false);
    expect(s.includes('onPressOut')).toBe(false);
    for (const k of ['HOLD_HINT', 'isShortPress', 'onHint']) expect(s.includes(k)).toBe(false);
  });
  it('Field の voice は既定で false・マイクは録音できる時だけ', () => {
    const s = src('components/ui.tsx');
    expect(s).toContain('voice = false');
    expect(s).toContain('fieldMicShown(voice, canRecord())');
  });
  it('振り返りの声は文字にして「できたこと」か「次の一歩」に入れる。長押しの案内は無い（#315）', () => {
    const s = src('app/reflect/[sessionId].tsx');
    expect(s).toContain('const r = await api.transcribe(v.audio);');
    expect(s).toContain("if (phase === 'input') setNote(");
    expect(s.includes('onHint')).toBe(false);
  });
  it('相談の入力欄（ふつう・集中中）にマイクがある', () => {
    const s = src('components/TutorChat.tsx');
    expect(s).toContain('useVoiceFill(text, setText, 2000)');
    expect(s).toContain('testID="tutor-voice"');
  });

  // [ファイル, 欄の testID]。文章を打つ欄だけ（名前・コード・数字・日付は対象外）
  const TARGETS: [string, string][] = [
    ['app/goal/new.tsx', 'add-goal-input'],
    ['app/goal/import.tsx', 'import-text'],
    ['app/plan/[goalId].tsx', 'roadmap-ask-input'],
    ['components/TodayProposal.tsx', 'today-note'],
    // 振り返りは下の大きなマイクで話す（#315）ので、欄には付けない
  ];
  it.each(TARGETS)('%s の %s に voice が付いている', (file, id) => {
    const s = src(file);
    const at = s.indexOf(`testID="${id}"`);
    expect(at).toBeGreaterThan(-1);
    const start = s.lastIndexOf('<Field', at);
    expect(start).toBeGreaterThan(-1);
    const end = s.indexOf('/>', at);
    const tag = s.slice(start, end === -1 ? at : end);
    expect(/\n\s*voice\n/.test(tag) || /\svoice[\s/]/.test(tag)).toBe(true);
  });
  it('名前・コード・数字・日付の欄には付けない', () => {
    expect(/\svoice[\s/]/.test(src('app/(tabs)/friends.tsx'))).toBe(false);
    expect(/\svoice[\s/]/.test(src('app/login.tsx'))).toBe(false);
  });
});
