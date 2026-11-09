declare const require: (name: string) => any;
declare const __dirname: string;

import { shortStartDue } from '../lib/shortStart';

const fs = require('fs');
const read = (p: string): string => fs.readFileSync(`${__dirname}/${p}`, 'utf8');

describe('shortStartDue', () => {
  test('299 秒ではまだ出さない', () => {
    expect(shortStartDue(1000, 1000 + 299_000, false)).toBe(false);
  });
  test('300 秒で出す', () => {
    expect(shortStartDue(1000, 1000 + 300_000, false)).toBe(true);
  });
  test('既に出した後・終えた後（dismissed）は出さない', () => {
    expect(shortStartDue(0, 600_000, true)).toBe(false);
  });
});

describe('5 分だけやる（画面の部品）', () => {
  const start = read('../app/start/[goalId]/[checkpointId].tsx');
  const focus = read('../app/focus/[sessionId].tsx');

  test('ホームの始めるの下に小さなリンクがあり、押すと shortStart 付きで集中へ（#315）', () => {
    const home = read('../app/(tabs)/index.tsx');
    expect(home).toContain('label={COPY_SHORT_START}');
    expect(home).toContain('?short=1');
    expect(start).toContain('?shortStart=1');
  });
  test('集中の画面は、5 分後の帯と「続ける」「ここまでにする」を持つ', () => {
    expect(focus).toContain('shortStartDue(0, ms, shortStartDismissed)');
    expect(focus).toContain('COPY_SHORT_START_PASSED');
    const keep = focus.indexOf('short-start-keep');
    expect(focus.indexOf('setShortStartDismissed(true)', keep - 200)).toBeGreaterThan(-1);
    expect(focus).toContain('void end();');
  });
  test('文言は copy.ts にあり、責める語を含まない', () => {
    const copy = read('../lib/copy.ts');
    expect(copy).toContain("COPY_SHORT_START_PASSED = '5 分たちました。続ける？'");
    expect(copy).toContain("COPY_SHORT_START_STOP = 'ここまでにする'");
    const line = (name: string): string => copy.slice(copy.indexOf(name), copy.indexOf('\n', copy.indexOf(name)));
    expect(line('COPY_SHORT_START ')).not.toMatch(/ダメ|だめ|まだ|なのに/);
    expect(line('COPY_SHORT_START_PASSED')).not.toMatch(/ダメ|だめ|まだ|なのに/);
    expect(line('COPY_SHORT_START_STOP')).not.toMatch(/ダメ|だめ|まだ|なのに/);
  });
});
