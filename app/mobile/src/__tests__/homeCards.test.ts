import type { Checkpoint, HomeData, Session } from '../api/types';
import {
  daysLeft,
  daysLeftText,
  EMPTY_LEAD,
  EMPTY_STEPS,
  footerGoalName,
  newGoalId,
  primaryAction,
  primaryLabel,
  sortByDeadline,
} from '../lib/homeView';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

type Entry = HomeData['goals'][number];
const cp = (id: string, state: Checkpoint['state'] = 'todo') =>
  ({ id, order: 1, title: id, doneMark: '', estimateMin: 25, state, achievement: null }) as Checkpoint;
const entry = (id: string, deadline: string, withRoad = true): Entry =>
  ({
    goal: { id, userId: 'u', text: id, deadline, minutesPerDay: null, status: 'active' },
    roadmap: withRoad ? { id: `r${id}`, goalId: id, userId: 'u', adopted: 'own', why: '', checkpoints: [cp('c')], createdAt: '' } : null,
  }) as Entry;
const session = (id: string) => ({ id }) as Session;

describe('今日やることのカード', () => {
  it('0・1・3 件のカード数と、期限の近い順（同じ期限は元の順）', () => {
    expect(sortByDeadline([])).toHaveLength(0);
    expect(sortByDeadline([entry('a', '2026-11-20')]).map((g) => g.goal.id)).toEqual(['a']);
    const three = [entry('a', '2026-11-20'), entry('b', '2026-11-10'), entry('c', '2026-11-20')];
    expect(sortByDeadline(three).map((g) => g.goal.id)).toEqual(['b', 'a', 'c']);
  });

  it('期限までの日数', () => {
    const now = new Date(2026, 10, 7, 23, 0);
    expect(daysLeft('2026-11-13', now)).toBe(6);
    expect(daysLeftText(daysLeft('2026-11-13', now))).toBe('あと 6 日');
    expect(daysLeftText(daysLeft('2026-11-07', now))).toBe('今日まで');
    expect(daysLeftText(daysLeft('2026-11-01', now))).toBe('期限を過ぎた');
  });
});

describe('主ボタンは常に 1 つ', () => {
  const open = entry('a', '2026-11-20');
  const today = cp('c');
  it('集中中は「続ける」', () => {
    const a = primaryAction({ active: session('s1'), toReflect: [session('s2')] }, open, today);
    expect(a).toEqual({ kind: 'resume', sessionId: 's1' });
    expect(primaryLabel(a)).toBe('続ける');
  });
  it('振り返り待ちは「振り返る」で、始めるは出さない', () => {
    const a = primaryAction({ active: null, toReflect: [session('s2')] }, open, today);
    expect(a.kind).toBe('reflect');
    expect(primaryLabel(a)).toBe('振り返る');
  });
  it('通常は開いたカードの「始める　◯分」', () => {
    const a = primaryAction({ active: null, toReflect: [] }, open, today);
    expect(a.kind).toBe('start');
    expect(primaryLabel(a)).toBe('始める　25 分');
  });
  it('道が無ければ案から選ぶ・目標が無ければ出さない', () => {
    expect(primaryAction({ active: null, toReflect: [] }, entry('b', '2026-11-20', false), null).kind).toBe('plan');
    expect(primaryLabel(primaryAction({ active: null, toReflect: [] }, null, null))).toBeNull();
  });
});

describe('ホームの画面', () => {
  const s: string = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
  it('札の横の列が無い', () => {
    expect(s).not.toMatch(/CHIP_|chipScrollX|goal-chip|horizontal/);
  });
  it('主ボタンはモルティの言葉とカードの下に 1 つだけ（#315）。下の固定欄はマイクで、「始める」を出さない', () => {
    expect(s).toContain('useMoltyChat(');
    expect(s).not.toContain('COPY_START');
    expect(s.match(/<BigButton/g)).toHaveLength(1);
    expect(s).toContain('testID="home-molty-action-0"');
    expect(s).toMatch(/footer=\{data && !intro \? <MoltyDock /);
    expect(s).not.toMatch(/router\.push\(`\/start\/\$\{g\.goal\.id\}/);
    // ほかの目標を押すと、モルティがその目標の次の一歩を言う
    expect(s).toContain('setPickedId(g.goal.id)');
  });
  it('会話は積み上げない（最新の 1 往復だけ・#315）', () => {
    expect(s).not.toContain('chat.earlier');
    expect(s).toContain('chat.reply?.asked ?? chat.pending');
  });
  it('開いた直後は大きなモルティ（起動して 1 回だけ）', () => {
    expect(s).toContain('<MoltyBig />');
    expect(s).toContain('let introPlayed = false;');
    expect(s).toContain('useState(!introPlayed)');
  });
  it('空の初回: モルティが話し、ボタンは「課題を取り込む」→「目標を書く」の順（moltyHome）、見本は小さなリンク（#187）', () => {
    expect(s).not.toContain('EmptyLot');
    expect(s).not.toContain('strokeDasharray');
    expect(s).toMatch(/<TextLink\s+label="デモ用の見本を入れる"/);
    expect(s).not.toContain('<Tower floors={[]}');
  });
  it('通信の失敗は ErrorBox（もう一度つき）', () => {
    expect(s).toContain('<ErrorBox text={error} onRetry={reload} />');
    expect(s).not.toContain('ErrorLine');
  });
});

describe('空の初回の文', () => {
  it('1 文と 3 つの短い手順（書く→案を選ぶ→集中して振り返る）', () => {
    expect(EMPTY_LEAD.split('。').filter(Boolean)).toHaveLength(1);
    expect(EMPTY_STEPS).toHaveLength(3);
    for (const st of EMPTY_STEPS) expect(st.length).toBeLessThanOrEqual(12);
    expect(EMPTY_LEAD).not.toContain('ようこそ');
  });
});

describe('固定ボタンが指す目標の名前', () => {
  const goals = [entry('a', '2026-11-10'), entry('b', '2026-11-20', false), entry('c', '2026-11-30')];
  it('目標が 2 件以上で、はじめる・案から選ぶの時だけ名前を出す', () => {
    expect(footerGoalName({ kind: 'start', goalId: 'c', checkpoint: cp('c') }, goals)).toBe('c');
    expect(footerGoalName({ kind: 'plan', goalId: 'b' }, goals)).toBe('b');
    expect(footerGoalName({ kind: 'start', goalId: 'a', checkpoint: cp('c') }, [entry('a', '2026-11-10')])).toBeNull();
    expect(footerGoalName({ kind: 'resume', sessionId: 's' }, goals)).toBeNull();
    expect(footerGoalName({ kind: 'none' }, goals)).toBeNull();
  });
});

describe('新しく作った目標', () => {
  it('1 件だけ増えた時はその ID、初回・増えない・2 件以上増えた時は null', () => {
    expect(newGoalId(null, ['a', 'b'])).toBeNull();
    expect(newGoalId(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(newGoalId(['a', 'b'], ['c', 'a', 'b'])).toBe('c');
    expect(newGoalId([], ['x', 'y', 'z'])).toBeNull();
    expect(newGoalId([], ['x'])).toBe('x');
    expect(newGoalId(['a', 'b'], ['b', 'n'])).toBe('n');
  });
});
