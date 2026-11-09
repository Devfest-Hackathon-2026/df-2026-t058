// #315 始めるは聞かずに集中へ（場面転換だけ）
import { startTalkGo } from '../lib/agentLines';
import { goLine } from '../lib/startGo';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

describe('今日の一行', () => {
  it('次の一歩があればそれ、無ければチェックポイントの名前。200 字まで', () => {
    expect(goLine('3 問目の続きから', '第 3 章の演習')).toBe('3 問目の続きから');
    expect(goLine('  ', '第 3 章の演習')).toBe('第 3 章の演習');
    expect(goLine(null, null)).toBe('');
    expect(Array.from(goLine('あ'.repeat(300), null))).toHaveLength(200);
  });
  it('モルティの一言は時間に触れない', () => {
    expect(startTalkGo('第 3 章の演習').text).toBe('「第 3 章の演習」、始めましょう。');
  });
});

describe('始めるの画面', () => {
  const s: string = fs.readFileSync(path.join(__dirname, '..', 'app', 'start', '[goalId]', '[checkpointId].tsx'), 'utf8');
  it('入力を求めず、一言 → カードが縮む → 地が集中の色 → 集中へ', () => {
    expect(s).not.toContain('MoltyDock');
    expect(s).not.toContain('BigButton');
    expect(s).toContain('outputRange: [color.bg, color.bgFocus]');
    expect(s).toContain('router.replace(');
    expect(s).toContain("short === '1' ? `/focus/${s.id}?shortStart=1`");
  });
});
