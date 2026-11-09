// 目標の資料（11/9・文字だけ・タスクの間ずっと残る）
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
import { createMockApi } from '../api/mock';
import { docsCount } from '../lib/goalDocs';

const fs = require('fs');
const path = require('path');
const read = (f: string): string => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('足す・直す・外す（モックもサーバーと同じ）', async () => {
  const api = createMockApi({ aiDelayMs: 0 });
  const g = await api.createGoal({ text: '線形代数', deadline: new Date(Date.now() + 7 * 864e5).toISOString() });
  const d = await api.addGoalDoc(g.id, { text: '試験範囲\n第 1〜4 章', from: 'goal' });
  expect(d.title).toBe('試験範囲');
  expect((await api.updateGoalDoc(g.id, d.id, { text: '第 1〜5 章' })).text).toBe('第 1〜5 章');
  expect(docsCount((await api.getGoal(g.id)).goal)).toBe(1);
  await api.deleteGoalDoc(g.id, d.id);
  expect(docsCount((await api.getGoal(g.id)).goal)).toBe(0);
});

test('ホームのカードと道を決める画面から資料の板を開ける・足す画面の資料は目標の資料になる', () => {
  expect(read('app/(tabs)/index.tsx')).toContain('<GoalDocsSheet');
  expect(read('app/plan/[goalId].tsx')).toContain('<GoalDocsSheet');
  expect(read('app/goal/new.tsx')).toContain("api.addGoalDoc(g.id, { text: materials.trim(), from: 'goal' })");
  expect(docsCount({ materials: '範囲', docs: [] })).toBe(1);
});
