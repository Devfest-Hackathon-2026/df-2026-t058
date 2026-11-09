import * as hintModule from '../lib/voiceHint';
import { errorPlace, showLater } from '../lib/voiceHint';

describe('errorPlace（エラーを出す位置の分岐）', () => {
  it('マイクのエラーはマイクの近くに出し、下には出さない', () => {
    expect(errorPlace('マイクが使えません', null)).toEqual({ near: 'マイクが使えません', bottom: null });
  });
  it('それ以外のエラーは今までどおり下に出す', () => {
    expect(errorPlace(null, '写真が大きすぎます')).toEqual({ near: null, bottom: '写真が大きすぎます' });
  });
  it('消した後（画面を移る時に null）は、どちらにも出ない', () => {
    expect(errorPlace(null, null)).toEqual({ near: null, bottom: null });
  });
});

describe('showLater（あとで振り返る）', () => {
  it('送れなかった時（入力の段）は出す', () => {
    expect(showLater({ error: '失敗', micError: null, phase: 'input' })).toBe(true);
  });
  it('マイクのエラーの時は出さない', () => {
    expect(showLater({ error: null, micError: 'マイクが使えません', phase: 'input' })).toBe(false);
    expect(showLater({ error: '失敗', micError: 'マイクが使えません', phase: 'input' })).toBe(false);
  });
  it('エラーが無い時・入力の段でない時は出さない', () => {
    expect(showLater({ error: null, micError: null, phase: 'input' })).toBe(false);
    expect(showLater({ error: '失敗', micError: null, phase: 'choose' })).toBe(false);
  });
});

describe('長押しの案内をやめた（#255）', () => {
  it('長押しの案内・短押しの判定は、もう無い', () => {
    const keys = Object.keys(hintModule);
    for (const k of ['HOLD_HINT', 'isShortPress', 'MIN_HOLD_MS', 'HINT_SHOW_MS']) expect(keys).not.toContain(k);
  });
});
