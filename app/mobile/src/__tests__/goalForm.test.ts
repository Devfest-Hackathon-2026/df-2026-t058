import {
  EXAMPLES,
  checkDateParts,
  sanitizeDigits,
  deadlineFromDays,
  formatDeadline,
  parseDateInput,
  parseMinutes,
  pickExample,
  sanitizeMinutesInput,
  minutesToSend,
} from '../lib/goalForm';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const src: string = require('fs').readFileSync(require('path').join(__dirname, '../app/goal/new.tsx'), 'utf8');

const now = new Date(2026, 10, 6, 12, 0);

describe('goalForm', () => {
  test('期限の札から日付を出す', () => {
    const d = deadlineFromDays(60, now);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2027, 0, 5, 23, 59]);
  });
  test('日付の入力', () => {
    expect(parseDateInput('2027-01-31', now)?.getDate()).toBe(31);
    expect(parseDateInput('2027/1/5', now)?.getMonth()).toBe(0);
    expect(parseDateInput('2027-02-30', now)).toBeNull();
    expect(parseDateInput('あした', now)).toBeNull();
    expect(parseDateInput('2026-11-06', now)).toBeNull();
    expect(parseDateInput('2026-11-07', now)).not.toBeNull();
  });
  test('年月日の 3 欄の検査', () => {
    expect(checkDateParts('2027', '1', '31', now).date?.getDate()).toBe(31);
    expect(checkDateParts('', '', '', now)).toMatchObject({ date: null, reason: null });
    expect(checkDateParts('2027', '1', '', now).reason).toBeNull();
    expect(checkDateParts('27', '1', '5', now).bad.y).toBe(true);
    expect(checkDateParts('2027', '13', '5', now).bad.m).toBe(true);
    expect(checkDateParts('2027', '2', '30', now)).toMatchObject({ reason: '2 月は 1〜28 日', bad: { d: true } });
    expect(checkDateParts('2026', '11', '6', now).reason).toBe('明日以降の日付にしてください');
    expect(checkDateParts('2026', '11', '7', now).date).not.toBeNull();
    expect(sanitizeDigits('1a2b345', 2)).toBe('12');
  });
  test('年をまたぐ時だけ年を出す', () => {
    expect(formatDeadline(new Date(2026, 11, 6), now)).toBe('12/6');
    expect(formatDeadline(new Date(2027, 0, 5), now)).toBe('2027/1/5');
  });
  test('時間の範囲検査', () => {
    expect(parseMinutes('5')).toBe(5);
    expect(parseMinutes('600')).toBe(600);
    expect(parseMinutes('4')).toBeNull();
    expect(parseMinutes('601')).toBeNull();
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('1.5')).toBeNull();
    expect(sanitizeMinutesInput('12a3456')).toBe('123');
  });
  test('1 日の時間の札: おまかせは null、自分で決めるは札か入力の分、不正な入力は undefined', () => {
    expect(minutesToSend('auto', 30, '')).toBeNull();
    expect(minutesToSend('auto', null, 'abc')).toBeNull(); // おまかせの時は入力を見ない
    expect(minutesToSend('own', 30, '')).toBe(30);
    expect(minutesToSend('own', null, '45')).toBe(45);
    expect(minutesToSend('own', null, '4')).toBeUndefined();
    expect(minutesToSend('own', null, '')).toBeUndefined();
  });
  // #265: 1 日に使える時間は画面で聞かない（minutesPerDay は送らない＝省略）
  test('目標を書く画面に時間の欄は無く、minutesPerDay を送らない', () => {
    expect(src).not.toContain('1 日に使える時間');
    expect(src).not.toContain('label="自分で決める"');
    expect(src).not.toContain('testID="goal-minutes');
    expect(src).not.toMatch(/minutesPerDay:/);
  });
  test('例文は 3 つのどれか', () => {
    expect(EXAMPLES).toHaveLength(3);
    expect(pickExample(() => 0)).toBe(EXAMPLES[0]);
    expect(pickExample(() => 0.999)).toBe(EXAMPLES[2]);
  });
});
