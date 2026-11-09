// #315 ホームに「＋ 目標」を置かず、モルティに話しかけて目標を足す（11/9 本人「A で」）
import { createMockApi } from '../api/mock';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

describe('話しかけて目標を足す', () => {
  const api = createMockApi({ aiDelayMs: 0 });
  it.each(['目標を足したい', '新しい課題を追加して', 'タスクを取り込みたい'])('「%s」→ 取り込む・書くのボタン', async (message) => {
    const r = await api.agentChat({ screen: 'home', message, history: [] });
    expect(r.actions).toEqual([{ kind: 'import' }, { kind: 'write' }]);
  });
  it('ホームのモルティは目安の時間を言わない（11/9 本人）', () => {
    const s: string = fs.readFileSync(path.join(__dirname, '..', 'lib', 'moltyHome.ts'), 'utf8');
    expect(s).not.toMatch(/estimateMin|分くらい/);
  });
  it('ホームの画面には「＋ 目標」も、その一覧も無い', () => {
    const s: string = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
    expect(s).not.toContain('COPY_ADD_GOAL');
    expect(s).not.toContain('add-goal');
    expect(s).not.toContain('<Modal');
  });
});
