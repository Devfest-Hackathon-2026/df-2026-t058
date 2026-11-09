import { tabTitleFor } from '../lib/tabTitle';
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('アプリの顔', () => {
  it('+html.tsx に title・theme-color・icon があり、説明は無い', () => {
    const s = read('src/app/+html.tsx');
    expect(s).toContain('<title>');
    expect(s).toContain('name="theme-color"');
    expect(s).toContain('color.primary');
    expect(s).toContain('rel="icon"');
    expect(s).toContain('href="/favicon.svg"');
    expect(s).not.toContain('name="description"');
  });

  it('favicon.svg は viewBox 64 の SVG で、3 枚の板', () => {
    const s = read('public/favicon.svg').trim();
    expect(s.startsWith('<svg')).toBe(true);
    expect(s).toContain('viewBox="0 0 64 64"');
    expect((s.match(/<rect /g) ?? []).length).toBe(3);
    expect(s).not.toContain('<text');
  });

  it('ログイン画面の名前欄に例があり、コード欄には付けない', () => {
    const s = read('src/app/login.tsx');
    expect(s).toContain('placeholder="例: ゆうき"');
    expect((s.match(/placeholder=/g) ?? []).length).toBe(1);
  });

  it('タブの文字は「建物 – モル塔」の形、ホームはアプリ名だけ', () => {
    expect(tabTitleFor('建物')).toBe('建物 – モル塔');
    expect(tabTitleFor(null)).toBe('モル塔');
  });
});
