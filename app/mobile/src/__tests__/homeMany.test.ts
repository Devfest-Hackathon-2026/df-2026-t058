// #177 複数の課題を抱えた人向けのホーム: 今日の合計・急ぎ・畳んだカード・ほか N 件・終わった目標・＋目標の選択
import type { Checkpoint, HomeData } from '../api/types';
import { COPY_ADD_IMPORT, COPY_ADD_WRITE } from '../lib/copy';
import { daysLeft, isFinished, isUrgent, LIST_HEAD, splitGoals, todayTotal, todayTotalText } from '../lib/homeView';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

type Entry = HomeData['goals'][number];
const cp = (id: string, order: number, estimateMin: number, state: Checkpoint['state'] = 'todo') =>
  ({ id, order, title: id, doneMark: '', estimateMin, state, achievement: null }) as Checkpoint;
const entry = (id: string, deadline: string, cps: Checkpoint[] | null): Entry =>
  ({
    goal: { id, userId: 'u', text: id, deadline, minutesPerDay: null, status: 'active' },
    roadmap: cps ? { id: `r${id}`, goalId: id, userId: 'u', adopted: 'own', why: '', checkpoints: cps, createdAt: '' } : null,
  }) as Entry;
const done = (id: string) => entry(id, '2026-11-09', [cp('x', 1, 25, 'done'), cp('y', 2, 25, 'done')]);
const many = (n: number) => Array.from({ length: n }, (_, i) => entry(`g${i}`, `2026-11-${String(10 + i)}`, [cp('c', 1, 10)]));

describe('今日の合計', () => {
  it('今日の一歩を持つ目標の件数と分の合計（終わった分は数えず、まだの最初の分）', () => {
    const goals = [
      entry('a', '2026-11-10', [cp('a1', 1, 25, 'done'), cp('a2', 2, 30)]),
      entry('b', '2026-11-11', [cp('b2', 2, 50), cp('b1', 1, 40)]),
      entry('c', '2026-11-12', [cp('c1', 1, 25)]),
      entry('d', '2026-11-13', null),
      done('e'),
    ];
    expect(todayTotal(goals)).toEqual({ count: 3, minutes: 95 });
    expect(todayTotalText({ count: 3, minutes: 95 })).toBe('今日 3 件・合計 95 分');
  });
  it('0 件なら出さない', () => {
    expect(todayTotal([])).toBeNull();
    expect(todayTotal([entry('d', '2026-11-13', null), done('e')])).toBeNull();
  });
});

describe('急ぎ（3 日以内）', () => {
  const now = new Date(2026, 10, 7, 9, 0);
  it('3 日以内・期限の日・過ぎた物は急ぎ、4 日以上は急ぎでない', () => {
    expect(isUrgent(daysLeft('2026-11-10', now))).toBe(true);
    expect(isUrgent(daysLeft('2026-11-07', now))).toBe(true);
    expect(isUrgent(daysLeft('2026-11-01', now))).toBe(true);
    expect(isUrgent(daysLeft('2026-11-11', now))).toBe(false);
  });
});

describe('一覧の分け方', () => {
  it('6 件までは全部出す', () => {
    const r = splitGoals(many(6), { expanded: false });
    expect(r.shown).toHaveLength(6);
    expect(r.hiddenCount).toBe(0);
  });
  it('6 件を超えたら先頭 5 件と「ほか N 件」。順は変えない', () => {
    const r = splitGoals(many(8), { expanded: false });
    expect(r.shown.map((g) => g.goal.id)).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
    expect(LIST_HEAD).toBe(5);
    expect(r.hiddenCount).toBe(3);
  });
  it('広げた時・開いた目標が隠れる位置の時は全部出す', () => {
    expect(splitGoals(many(8), { expanded: true }).shown).toHaveLength(8);
    expect(splitGoals(many(8), { expanded: false, openId: 'g6' }).hiddenCount).toBe(0);
    expect(splitGoals(many(8), { expanded: false, openId: 'g2' }).hiddenCount).toBe(3);
  });
  it('終わった目標（道がすべて完了）は下に分ける。道が無い目標は終わっていない', () => {
    const goals = [done('z'), ...many(6)];
    const r = splitGoals(goals, { expanded: false });
    expect(r.finished.map((g) => g.goal.id)).toEqual(['z']);
    expect(r.shown).toHaveLength(6);
    expect(r.hiddenCount).toBe(0);
    expect(isFinished(entry('n', '2026-11-20', null))).toBe(false);
    expect(isFinished(entry('m', '2026-11-20', []))).toBe(false);
  });
});

describe('ホームの画面（#177）', () => {
  const s: string = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
  it('今日の合計・急ぎの印・ほか N 件・終わった目標を出す', () => {
    // 今日の合計の行はやめた（UI 刷新・11/9。集計を並べない）
    expect(s).not.toContain('todayTotalText(total)');
    expect(s).toContain('styles.urgentEdge');
    expect(s).toContain('styles.urgentText');
    // ほか N 件と終わった目標は、畳んだ 1 行「ほかの目標」の中にまとめる（#315）
    expect(s).toContain('testID="other-goals"');
    expect(s).toContain('COPY_FINISHED_GOALS');
  });
  it('開いていないカードは 1 行に畳む（押すと開く）', () => {
    expect(s).toContain('styles.slim');
    expect(s).toMatch(/numberOfLines=\{1\}>\{`\$\{mark\}\$\{g\.goal\.text\}`\}/);
  });
  it('「＋ 目標」はホームに置かない（話しかけて足す・#315。homeAddByTalk.test.ts）', () => {
    expect(COPY_ADD_WRITE).toBe('書く');
    expect(COPY_ADD_IMPORT).toBe('課題を取り込む');
    expect(s).not.toContain('setAddOpen(true)');
  });
});
