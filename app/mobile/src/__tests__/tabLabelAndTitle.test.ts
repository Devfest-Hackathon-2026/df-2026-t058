/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('下タブの文字', () => {
  const src = read('app', '(tabs)', '_layout.tsx');
  it('fontSize 12 と lineHeight（文字より高い）を付けて欠けない', () => {
    const m = /tabBarLabelStyle:\s*\{[^}]*\}/.exec(src)?.[0] ?? '';
    const size = Number(/fontSize:\s*(\d+)/.exec(m)?.[1] ?? 0);
    const line = Number(/lineHeight:\s*(\d+)/.exec(m)?.[1] ?? 0);
    expect(size).toBe(12);
    expect(line).toBeGreaterThan(size);
  });
});

describe('ブラウザのタブの文字', () => {
  const src = read('lib', 'tabTitle.ts');
  it('画面に戻った時にも付け直す（useFocusEffect。useEffect だけだと戻っても古い）', () => {
    expect(src).toContain('useFocusEffect');
    expect(src).not.toMatch(/useEffect\(/);
  });
});
