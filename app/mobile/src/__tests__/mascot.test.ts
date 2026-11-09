import {
  MASCOT_COMPACT_HERO_HEIGHT,
  MASCOT_COMPACT_ICON_SIZE,
  MASCOT_HERO_HEIGHT,
  MASCOT_ICON_SIZE,
  MASCOT_NAME,
  canAnimate,
  MASCOT_ANIMATIONS,
  MASCOT_POSES,
} from '../lib/mascot';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(SRC, ...p), 'utf8');

// src の下の .ts/.tsx を全部（試験は除く）
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir) as string[]) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...walk(full));
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('キャラクターの名前と絵（lib/mascot）', () => {
  test('名前は「モルティ」', () => {
    expect(MASCOT_NAME).toBe('モルティ');
  });

  test('大きさ: アイコンは直径 36〜40、空の時は高さ 120 前後', () => {
    expect(MASCOT_ICON_SIZE).toBeGreaterThanOrEqual(36);
    expect(MASCOT_ICON_SIZE).toBeLessThanOrEqual(40);
    expect(MASCOT_HERO_HEIGHT).toBeGreaterThanOrEqual(100);
    expect(MASCOT_HERO_HEIGHT).toBeLessThanOrEqual(140);
  });

  test('動きを減らす・画面離脱・バックグラウンドのどれかなら再生しない', () => {
    for (const reduce of [true, false]) for (const focused of [true, false]) for (const active of [true, false]) {
      expect(canAnimate(reduce, focused, active)).toBe(!reduce && focused && active);
    }
  });

  test('12場面すべてに静止画と実WebPがあり、素材ファイルも揃う', () => {
    expect(Object.keys(MASCOT_POSES).sort()).toEqual(Object.keys(MASCOT_ANIMATIONS).sort());
    const folder = path.join(SRC, '../assets/mascot/molty/animations');
    const files = fs.readdirSync(folder) as string[];
    expect(files).toHaveLength(12);
    for (const file of files) {
      const data = fs.readFileSync(path.join(folder, file));
      expect(data.toString('ascii', 0, 4)).toBe('RIFF');
      expect(data.toString('ascii', 8, 12)).toBe('WEBP');
    }
  });

  test('絵のパスは lib/mascot.ts、名前の文字は lib/appName.ts の 1 か所だけ', () => {
    const files = walk(SRC);
    const withPath = files.filter((f) => read(path.relative(SRC, f)).includes('assets/mascot/molty/'));
    expect(withPath.map((f) => path.relative(SRC, f))).toEqual([path.join('lib', 'mascot.ts')]);
    const withName = files.filter((f) => /['"`]モルティ['"`]/.test(read(path.relative(SRC, f))));
    expect(withName.map((f) => path.relative(SRC, f))).toEqual([path.join('lib', 'appName.ts')]);
  });
});

describe('絵の部品 Mascot', () => {
  const s = read('components', 'Mascot.tsx');

  test('読み上げの名前は MASCOT_NAME', () => {
    expect(s).toContain('accessibilityLabel={MASCOT_NAME}');
  });

  test('共通の動きを減らす設定を使い、画面とアプリの状態で再生を止める', () => {
    expect(s).toContain('canAnimate(reduce, focused, active)');
    expect(s).toContain('useFocusEffect');
    expect(s).toContain("AppState.addEventListener('change'");
    expect(s).toContain('clearTimeout(timer)');
    expect(s).toContain('MASCOT_ANIMATIONS[pose] : MASCOT_POSES[pose]');
    expect(read('lib', 'useReduceMotion.ts')).toContain("addEventListener('reduceMotionChanged'");
  });
});

describe('キャラを出す画面・出さない画面', () => {
  test('相談の画面（TutorChat 越し）: 返事の横・待ちの揺れ・名前・空の時の大きな絵', () => {
    const tutor = read('app', 'tutor', '[sessionId].tsx');
    expect(tutor).toContain('<TutorChat sessionId={sessionId} />');
    const chat = read('components', 'TutorChat.tsx');
    // 集中の中は、ほかの画面と同じ丸の中のモルティ（#315）
    expect(chat).toContain('size={compact ? CHAT_AVATAR_SIZE - 8 : MASCOT_ICON_SIZE}');
    expect(chat).toContain('waiting={waiting}');
    expect(chat).toContain('aiIcon(true)');
    expect(chat).toContain('aiIcon(false)');
    expect(chat).toContain('{MASCOT_NAME}');
    expect(chat).toContain('<Mascot height={MASCOT_HERO_HEIGHT}');
    // 絵の分だけ吹き出しを狭くする
    expect(chat).toContain('bubbleWithIcon');
    // 手助けの棒は今のまま
    expect(chat).toContain('<HelpBars small={help.small} medium={help.medium} />');
  });

  test('集中の画面は compact で呼び、compact でもアイコンと名前が出る。大きな絵は会話が無い時だけ', () => {
    expect(read('app', 'focus', '[sessionId].tsx')).toContain('<TutorChat sessionId={sessionId} compact');
    const chat = read('components', 'TutorChat.tsx');
    expect(MASCOT_COMPACT_ICON_SIZE).toBe(32);
    expect(MASCOT_COMPACT_HERO_HEIGHT).toBe(72);
    expect(chat).toContain('{compact && showExamples ? (');
    // UI 刷新（11/9）: 集中中の最初の呼びかけは、ほかの画面と同じ吹き出し（AgentSays・名前は吹き出しの中）
    expect(chat).toContain('<AgentSays text={MASCOT_COMPACT_HINT}');
    expect(chat).not.toMatch(/\{compact \? \(\s*<Text style=\{styles\.mascotName\}/);
  });

  // #257 から各画面にエビが出るが、画面は AgentSays 越しに出し、Mascot と名前を直接使わない
  test('相談以外の画面は Mascot も名前も直接使わない', () => {
    const screens = walk(path.join(SRC, 'app')).filter((f) => !f.includes(`${path.sep}tutor${path.sep}`));
    expect(screens.length).toBeGreaterThan(5);
    for (const f of screens) {
      const t = read(path.relative(SRC, f));
      expect([f, t.includes('Mascot') || t.includes('MASCOT_')]).toEqual([f, false]);
    }
  });
});
