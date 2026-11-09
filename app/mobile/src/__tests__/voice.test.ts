import { reflectBodyBytes } from '../lib/bodySize';
import { audioBytes, audioTooBig, canRecordVoice, MAX_AUDIO_BYTES, pickAudioMime, secText, withAudio } from '../lib/voice';

const base = { note: 'n', done: false, images: [], materials: '' };
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3 / 4) * 4);

describe('pickAudioMime', () => {
  it('webm を先に選ぶ', () => expect(pickAudioMime(() => true)).toBe('audio/webm'));
  it('webm が無ければ mp4', () => expect(pickAudioMime((m) => m === 'audio/mp4')).toBe('audio/mp4'));
  it('どちらも無ければ null', () => expect(pickAudioMime(() => false)).toBeNull());
});

describe('上限', () => {
  it('ちょうど上限は通り、超えると止める', () => {
    expect(audioTooBig({ mimeType: 'audio/webm', dataBase64: b64(MAX_AUDIO_BYTES) })).toBe(false);
    expect(audioTooBig({ mimeType: 'audio/webm', dataBase64: b64(MAX_AUDIO_BYTES + 3) })).toBe(true);
  });
  it('base64 のパディングを引く', () => expect(audioBytes('QUI=')).toBe(2));
});

describe('送信本文', () => {
  it('音声があれば audio が載る', () => {
    const a = { mimeType: 'audio/webm' as const, dataBase64: 'QUJD' };
    expect(withAudio(base, a)).toEqual({ ...base, audio: a });
  });
  it('音声が無ければ audio のキーが無い', () => expect('audio' in withAudio(base, null)).toBe(false));
  it('本文の大きさに音声が入る', () => {
    const a = { mimeType: 'audio/webm' as const, dataBase64: 'A'.repeat(1000) };
    expect(reflectBodyBytes({ ...base, audio: a })).toBeGreaterThan(reflectBodyBytes(base) + 1000);
  });
});

describe('canRecordVoice / secText', () => {
  const rec = { isTypeSupported: () => true };
  it('Web で全部ある時だけ true', () => {
    expect(canRecordVoice({ os: 'web', hasGetUserMedia: true, recorder: rec })).toBe(true);
    expect(canRecordVoice({ os: 'ios', hasGetUserMedia: true, recorder: rec })).toBe(false);
    expect(canRecordVoice({ os: 'web', hasGetUserMedia: false, recorder: rec })).toBe(false);
    expect(canRecordVoice({ os: 'web', hasGetUserMedia: true })).toBe(false);
    expect(canRecordVoice({ os: 'web', hasGetUserMedia: true, recorder: { isTypeSupported: () => false } })).toBe(false);
  });
  it('長さの表示', () => expect(secText(7.2)).toBe('0:07'));
});
