// 動き（#150）: 押した時の沈み・数字の増える動き・カードの順に出る動き・道の丸が埋まる瞬間・返事が浮かぶ
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { newlyDone } from '../components/CheckpointPath';
import { BigButton, Card, Chip, PRESS_SCALE, SinkPressable, STAGGER_MS, staggerDelay } from '../components/ui';
import { COUNT_UP_MS, countUpShown } from '../lib/useCountUp';
import { NATIVE_DRIVER } from '../lib/useReduceMotion';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const noop = () => {};

describe('動きを減らす設定', () => {
  test('useReduceMotion は lib に 1 つだけあり、State.tsx はそれを使う', () => {
    expect(read('lib/useReduceMotion.ts')).toContain('export function useReduceMotion');
    expect(read('components/State.tsx')).not.toContain('function useReduceMotion');
  });
  test('Web では native の動きを使わない', () => {
    expect(read('lib/useReduceMotion.ts')).toContain("Platform.OS !== 'web'");
    expect(typeof NATIVE_DRIVER).toBe('boolean');
  });
});

describe('数字の増える動き', () => {
  test('動きを減らす時は、すぐ最終の値を返す', () => {
    expect(countUpShown(true, 42, 0)).toBe(42);
    expect(countUpShown(true, 7, 3)).toBe(7);
  });
  test('ふだんは動きの途中の値を返す', () => {
    expect(countUpShown(false, 42, 10)).toBe(10);
  });
  test('0.6 秒・イージングつき・読み込み中は動かさない・フックは countUpShown を通す', () => {
    expect(COUNT_UP_MS).toBe(600);
    const src = read('lib/useCountUp.ts');
    expect(src).toContain('Easing.out');
    expect(src).toContain('if (target == null) return;');
    expect(src).toContain('return countUpShown(reduce, target ?? 0, shown);');
  });
  test('ホームの階数・連続記録、建物の画面の階数・連続・集中した分に使う（色別の行は外した・#355）', () => {
    const tower = read('app/(tabs)/tower.tsx');
    for (const k of ['data?.totalFloors', 'data?.streak', 'rec?.floor.focusMin']) {
      expect(tower).toContain(`useCountUp(${k})`);
    }
  });
});

describe('押した時の沈み', () => {
  test('縮尺は 0.97、ばね（spring）で transform の scale を動かす', () => {
    expect(PRESS_SCALE).toBe(0.97);
    const ui = read('components/ui.tsx');
    expect(ui).toContain('Animated.spring(sink');
    expect(ui).toContain('transform: [{ scale: sink }]');
  });
  test('BigButton・Chip・押せる Card は沈む部品を使う。BigButton の下の厚みの沈みは残す', () => {
    expect(BigButton({ label: '次へ', onPress: noop }).type).toBe(SinkPressable);
    expect(Chip({ label: 'x', onPress: noop }).type).toBe(SinkPressable);
    expect(Card({ children: null, onPress: noop }).type).toBe(SinkPressable);
    expect(Card({ children: null }).type).not.toBe(SinkPressable);
    expect(read('components/ui.tsx')).toContain('translateY: pressed && !off ? LIP : 0');
  });
});

describe('カードの順に出る動き', () => {
  test('60ms ずつずれる', () => {
    expect(STAGGER_MS).toBe(60);
    expect([0, 1, 2, 3].map(staggerDelay)).toEqual([0, 60, 120, 180]);
    expect(staggerDelay(-1)).toBe(0);
  });
  test('ホームの「今日やること」のカードに使う', () => {
    expect(read('app/(tabs)/index.tsx')).toContain('<RiseIn key={g.goal.id} delay={staggerDelay(i)}>');
  });
});

describe('道の丸が埋まる瞬間', () => {
  test('前は未完了で今は完了の丸だけが動く。初めて見る丸・前から完了の丸は動かさない', () => {
    const prev = new Map<string, boolean>([
      ['a', false],
      ['b', true],
    ]);
    expect(newlyDone(prev, { id: 'a', state: 'done' })).toBe(true);
    expect(newlyDone(prev, { id: 'b', state: 'done' })).toBe(false);
    expect(newlyDone(prev, { id: 'c', state: 'done' })).toBe(false);
    expect(newlyDone(prev, { id: 'a', state: 'todo' } as any)).toBe(false);
  });
  test('既存の光る輪は残る', () => {
    expect(read('components/CheckpointPath.tsx')).toContain('{isToday ? <Glow />');
  });
});

describe('相談の返事', () => {
  test('新しく届いた返事だけ 0.2 秒で浮かぶ', () => {
    const chat = read('components/TutorChat.tsx');
    expect(chat).toContain('<RiseIn key={m.id} duration={200}>');
    expect(chat).toContain("if (m.role !== 'user') fresh.current.add(m.id)");
  });
});
