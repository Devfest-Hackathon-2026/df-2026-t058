// #315 集中を対話の形に: 場面の帯・上に小さく時計と今日の一歩・真ん中は会話・下に大きなマイク・地は少し深い紙色
import { SCENE_NAME, SCENES, PREP_SCENES, sceneBars } from '../components/SceneTop';
import { color } from '../theme';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('場面の帯', () => {
  it('一周は今日 → 集中 → 振り返りの 3 場面', () => {
    expect(SCENES).toEqual(['home', 'focus', 'reflect']);
    expect(SCENE_NAME).toEqual({ home: '今日', focus: '集中', reflect: '振り返り', add: '足す', plan: '道を決める' });
  });
  it('準備のフローは足す → 道を決めるの 2 場面（線は 2 本・決定 11/9）', () => {
    expect(PREP_SCENES).toEqual(['add', 'plan']);
    expect(sceneBars('plan')).toEqual({ list: ['add', 'plan'], at: 1 });
    expect(sceneBars('focus')).toEqual({ list: ['home', 'focus', 'reflect'], at: 1 });
  });
});

describe('集中の画面', () => {
  const s = read('app', 'focus', '[sessionId].tsx');
  it('場面の帯と、時計と今日の一歩の小さな帯。目安の分と進み具合の帯は出さない', () => {
    expect(s).toContain('<SceneTop');
    expect(s).toContain('testID="clock-band"');
    expect(s).not.toContain('plan-bar');
    expect(s).not.toContain('estimateMin');
  });
  it('地は少し深い紙色（文字が読める濃さ）', () => {
    expect(s).toContain('backgroundColor: color.bgFocus');
    expect(color.bgFocus).toBe('#f1e7e1');
  });
});

describe('集中の中の相談', () => {
  const c = read('components', 'TutorChat.tsx');
  it('大きなマイクで話すと、聞き取った文をそのまま送る。打ち込みは押した時だけ', () => {
    expect(c).toContain('testID="tutor-voice-big"');
    expect(c).toContain('if (said) await sendWith(said);');
    expect(c).toContain('{compact && !typing ? null : (');
  });
  it('手助けの棒・札・例は集中の中に常には出さない', () => {
    expect(c).toContain('!compact ? (');
    expect(c).toContain('{compact && typing ? (');
  });
});
