import { NAME_PLACEHOLDER, NUDGE_OPTIONS, backAction, canSaveName, nudgeHint, nudgeLabel, validName } from '../lib/settingsForm';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

describe('設定の入力', () => {
  test('表示名は前後の空白を除いて 1〜30 字', () => {
    expect(validName('')).toBeNull();
    expect(validName('   ')).toBeNull();
    expect(validName(' はると ')).toBe('はると');
    expect(validName('あ'.repeat(30))).toBe('あ'.repeat(30));
    expect(validName('あ'.repeat(31))).toBeNull();
  });

  test('保存できるのは、検査を通り、いまの値と違う時だけ', () => {
    expect(canSaveName('はると', 'はると')).toBe(false);
    expect(canSaveName(' はると ', 'はると')).toBe(false);
    expect(canSaveName('', 'はると')).toBe(false);
    expect(canSaveName('ゆうき', 'はると')).toBe(true);
    expect(canSaveName('ゆうき', '')).toBe(true);
  });

  test('通知の強さ 3 つが、契約の値と文言に対応する', () => {
    expect(NUDGE_OPTIONS.map((o) => o.key)).toEqual(['off', 'friend_start', 'strong']);
    expect(nudgeLabel('off')).toBe('なし');
    expect(nudgeLabel('friend_start')).toBe('始めた時');
    expect(nudgeLabel('strong')).toBe('強め');
  });

  test('通知の 3 段は、それぞれ違う 1 行の説明を持つ', () => {
    const hints = NUDGE_OPTIONS.map((o) => nudgeHint(o.key));
    expect(hints.every((h) => h.length > 0)).toBe(true);
    expect(new Set(hints).size).toBe(3);
  });

  test('名前の欄は友達タブだけ。通知の札は設定だけ', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'app', f), 'utf8');
    const settings = read('settings.tsx');
    const friends = read('(tabs)/friends.tsx');
    for (const src of [settings, friends]) {
      expect(src).not.toContain("label: '始めた時'");
    }
    expect(friends).toContain('NAME_PLACEHOLDER');
    expect(settings).not.toContain('NAME_PLACEHOLDER');
    // 焦りの強さは全員「強め」固定（11/9）。選ぶ札は設定にも置かない
    expect(settings).not.toContain('NUDGE_OPTIONS');
    // 通知の強さは設定にあるので、友達タブからは外した（#132）
    expect(friends).not.toContain('NUDGE_OPTIONS');
    expect(NAME_PLACEHOLDER).toBe('例: ゆうき');
  });

  test('戻る矢印: 履歴があれば戻る、無ければホーム', () => {
    expect(backAction(true)).toBe('back');
    expect(backAction(false)).toBe('home');
  });
});
