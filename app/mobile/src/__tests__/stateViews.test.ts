// 読み込み中・エラー・空の見え方（部品の原稿と、3 画面の使い方を読んで確かめる）
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { avatarColorOf, initialOf } from '../components/State';
import { avatarColors } from '../theme';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, p), 'utf8');

const state = read('../components/State.tsx');
const friends = read('../app/(tabs)/friends.tsx');
const settings = read('../app/settings.tsx');
const start = read('../app/start/[goalId]/[checkpointId].tsx');

describe('Skeleton / ErrorBox', () => {
  test('Skeleton は幅・高さ・角を引数に取り、動きを減らす設定では脈打たない', () => {
    expect(state).toMatch(/export function Skeleton\(props: \{ width\?.*height\?.*radius\?/);
    // 設定の読み方は lib/useReduceMotion.ts に取り出して共有する（#150）
    expect(state).toContain("import { useReduceMotion } from '../lib/useReduceMotion'");
    expect(read('../lib/useReduceMotion.ts')).toContain('isReduceMotionEnabled');
    expect(state).toMatch(/if \(reduce\) \{/);
  });
  test('ErrorBox は role=alert で「もう一度」ボタンを持つ', () => {
    expect(state).toMatch(/accessibilityRole="alert"/);
    expect(state).toContain('label="もう一度"');
  });
});

describe('イニシャルの丸', () => {
  test('同じ名前は同じ色、色は theme の色から選ぶ', () => {
    expect(avatarColorOf('たろう')).toBe(avatarColorOf('たろう'));
    for (const n of ['a', 'bb', 'たろう', 'はなこ', '名前なし']) {
      expect((avatarColors as readonly string[]).includes(avatarColorOf(n))).toBe(true);
    }
    const used = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(avatarColorOf));
    expect(used.size).toBeGreaterThan(1);
  });
  test('イニシャルは最初の 1 字、空は「?」', () => {
    expect(initialOf(' たろう')).toBe('た');
    expect(initialOf('')).toBe('?');
  });
});

describe('友達', () => {
  test('モルティの吹き出しは無い（11/9）。点線の丸もやめる', () => {
    expect(friends).not.toContain('AgentSays');
    expect(friends).not.toContain('dashed');
  });
  test('読み込み中は Skeleton、行には丸、取り組み中の文字は残る', () => {
    expect(friends).toContain('<Skeleton');
    expect(friends).toContain('<Avatar name=');
    expect(friends).toContain('COPY_FRIEND_ACTIVE');
    expect(friends).toContain('<ErrorBox');
  });
});

describe('友達の通信失敗', () => {
  test('通信失敗の間は「申請する」を押せない', () => {
    expect(friends).toMatch(/disabled=\{code\.trim\(\)\.length < 6 \|\| !!error\}/);
  });
  test('名前の保存ボタンは変更がある時だけ出す', () => {
    expect(friends).toMatch(/canSaveName\(name, savedName\) \? \(/);
  });
});

describe('設定', () => {
  test('名前の欄は無く、通知とアカウント（ログアウト）だけ', () => {
    expect(settings).not.toContain('<Field');
    expect(settings).not.toContain('表示名');
    expect(settings).toContain('<Label>通知</Label>');
    expect(settings).toContain('<Label>アカウント</Label>');
    expect(settings).toContain('testID="logout"');
    expect(settings).toContain('<ErrorBox');
  });
  test('通知を使えない端末は 1 行だけ出す。読み込み中は Skeleton', () => {
    expect(settings).toContain('COPY_PUSH_UNAVAILABLE');
    expect(settings).not.toContain('COPY_NUDGE_FIXED');
    expect(settings).not.toContain('nudgeHint(me.nudgeLevel)');
    expect(settings).toContain('<Skeleton');
    expect(settings).toContain('settings-loading');
  });
});

describe('始める', () => {
  test('読み込みの失敗は ErrorBox（もう一度）とホームに戻る（#315: 読み込み中はモルティの一言が出る前の一瞬だけ）', () => {
    expect(start).toContain('<ErrorBox text={error} onRetry=');
    expect(start).toContain('testID="start-back"');
  });
});
