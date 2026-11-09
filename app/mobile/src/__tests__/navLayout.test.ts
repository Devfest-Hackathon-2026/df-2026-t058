import { RAIL_MIN_WIDTH, RAIL_WIDTH, TABS, isRail, showBackFor, tabBarLookFor } from '../lib/navLayout';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const read = (f: string): string => fs.readFileSync(path.join(appDir, f), 'utf8');
const exists = (f: string): boolean => fs.existsSync(path.join(appDir, f));

describe('下タブ 3 つ', () => {
  it('今日・建物・友達の順で、名前とファイルと URL が対応する', () => {
    expect(TABS.map((t) => t.title)).toEqual(['今日', '建物', '友達']);
    expect(TABS.map((t) => t.name)).toEqual(['index', 'tower', 'friends']);
    expect(TABS.map((t) => t.path)).toEqual(['/', '/tower', '/friends']);
  });

  it('3 画面は (tabs)/ の中にある（括弧のフォルダは URL に出ないので / ・ /tower ・ /friends のまま）', () => {
    for (const t of TABS) expect(exists(`(tabs)/${t.name}.tsx`)).toBe(true);
  });

  it('移す前の場所に同じ画面が残っていない（残ると同じ URL が 2 つになる）', () => {
    for (const t of TABS) expect(exists(`${t.name}.tsx`)).toBe(false);
  });

  it('タブの並びは TABS から作り、アイコン・色・下地・線を指定する', () => {
    const s = read('(tabs)/_layout.tsx');
    expect(s).toContain('TABS.map');
    expect(s).toContain('HomeIcon');
    expect(s).toContain('BuildingIcon');
    expect(s).toContain('FriendsIcon');
    expect(s).toContain('tabBarActiveTintColor: color.primary');
    expect(s).toContain('tabBarInactiveTintColor: color.muted');
    expect(s).toContain('backgroundColor: color.surface');
    expect(s).toContain('borderColor: color.line');
    expect(s).toContain('tabBarAccessibilityLabel: t.title');
  });

  it('ルートの Stack は (tabs) を持ち、3 画面を直接は持たない。流れの画面は残る', () => {
    const s = read('_layout.tsx');
    expect(s).toContain('name="(tabs)" options={{ headerShown: false }}');
    for (const t of TABS) expect(s).not.toContain(`name="${t.name}"`);
    for (const n of ['login', 'goal/new', 'plan/[goalId]', 'start/[goalId]/[checkpointId]', 'focus/[sessionId]', 'tutor/[sessionId]', 'reflect/[sessionId]', 'settings']) {
      expect(s).toContain(`name="${n}"`);
    }
    // 集中・振り返りは戻れないまま
    expect((s.match(/gestureEnabled: false/g) ?? []).length).toBe(3);
    expect(s).not.toContain('BackToHome');
  });
});

describe('ホームと友達タブ', () => {
  it('ホームの上の帯に、友達と歯車のボタンが無い。建物の階数は建物タブへ', () => {
    const s = read('(tabs)/index.tsx');
    expect(s).not.toContain("router.push('/settings')");
    expect(s).not.toContain('accessibilityLabel="友達"');
    expect(s).not.toContain('open-settings');
    // 数字の帯（連続記録・階）はホームに置かない（UI 刷新・11/9。建物タブで見る）
    expect(s).not.toContain('label="連続記録"');
  });

  it('友達タブの右上に歯車があり、押すと /settings', () => {
    const s = read('(tabs)/_layout.tsx');
    expect(s).toContain('GearIcon');
    expect(s).toContain("router.push('/settings')");
    expect(s).toContain("headerRight: t.name === 'friends'");
    expect(s).toContain('accessibilityLabel="設定"');
  });

  it('友達タブに通知の札が無く、名前の欄は常に出る（名前の場所は 1 か所）', () => {
    const s = read('(tabs)/friends.tsx');
    expect(s).not.toContain('NUDGE_OPTIONS');
    expect(s).not.toContain('<Label>通知</Label>');
    expect(s).toContain('const nameBlock =\n    me ? (');
    expect(s).not.toContain("savedName === ''");
    expect(s).toContain('canSaveName(name, savedName)');
  });
});

describe('PC 幅の左のレール', () => {
  it('幅 900 以上の Web だけ左のレール（幅 88・アイコンの下に文字）', () => {
    expect(RAIL_MIN_WIDTH).toBe(900);
    expect(isRail(899, 'web')).toBe(false);
    expect(isRail(900, 'web')).toBe(true);
    expect(isRail(1366, 'ios')).toBe(false);
    expect(tabBarLookFor(1366, 'web')).toEqual({
      tabBarPosition: 'left',
      tabBarVariant: 'material',
      tabBarLabelPosition: 'below-icon',
      railWidth: RAIL_WIDTH,
    });
    expect(RAIL_WIDTH).toBe(88);
  });

  it('スマホ幅・タブレット幅は下タブ', () => {
    for (const w of [375, 768]) {
      expect(tabBarLookFor(w, 'web').tabBarPosition).toBe('bottom');
      expect(tabBarLookFor(w, 'web').railWidth).toBeNull();
    }
    // uikit で左に置き below-icon にすると React Navigation が落ちるので、下タブの時だけ uikit
    expect(tabBarLookFor(375, 'android').tabBarVariant).toBe('uikit');
  });
});

describe('共通の上の帯', () => {
  it('戻る矢印は、画面が隠すと決めた時（集中・振り返り）は出さない', () => {
    expect(showBackFor({})).toBe(true);
    expect(showBackFor({ hideBack: true })).toBe(false);
    expect(showBackFor({ hasHeaderLeft: true })).toBe(false);
  });

  it('Stack とタブの両方の帯が ColumnHeader を使い、列の幅は 560', () => {
    expect(read('_layout.tsx')).toContain('<ColumnHeader');
    expect(read('(tabs)/_layout.tsx')).toContain('<ColumnHeader');
    const h = fs.readFileSync(path.join(__dirname, '..', 'components', 'ColumnHeader.tsx'), 'utf8');
    expect(h).toContain('maxWidth: COLUMN_WIDTH');
  });
});
