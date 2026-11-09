// 各画面のエビの発言（#257）: 発言の一覧・口調の規則・部品 AgentSays・置いた画面
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { bubbleText, POP_FROM_SCALE, WAITING_DOTS } from '../components/AgentSays';
import {
  afterGoalText,
  AGENT_LINES,
  allAgentLines,
  deadlineAsk,
  goalIntro,
  importFound,
  importIntro,
  materialsAsk,
  minutesAsk,
  quote,
  QUOTE_MAX,
  sentences,
} from '../lib/agentLines';
import { AGENT_ICON_SIZE, AGENT_SMALL_ICON_SIZE, isSmallScreen, MASCOT_POSES, poseFor } from '../lib/mascot';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const BANNED = ['サポート', 'ことができます', '！！', '!!', '！', '私', 'わたし', '僕', 'ぼく', 'ようこそ', 'はじめる', '今日やること', 'ー。', 'ー？'];
const EMOJI = /\p{Extended_Pictographic}/u;

describe('発言の一覧（lib/agentLines）', () => {
  const all = allAgentLines();

  test('全部の発言: ふだんは 2 文まで、短い版は 1 文、空ではない', () => {
    expect(all.length).toBeGreaterThan(10);
    for (const l of all) {
      expect([l.text, sentences(l.text).length <= 2 && sentences(l.text).length >= 1]).toEqual([l.text, true]);
      expect([l.short, sentences(l.short).length]).toEqual([l.short, 1]);
    }
  });

  test('全部の発言: 禁止の語と絵文字を含まない', () => {
    for (const l of all) {
      for (const s of [l.text, l.short]) {
        for (const w of BANNED) expect([s, w, s.includes(w)]).toEqual([s, w, false]);
        expect([s, EMOJI.test(s)]).toEqual([s, false]);
      }
    }
  });

  test('本人の文は先頭 20 字で切り、区切りと改行を落とす（全角の空白は 1 つの空白にまとめる）', () => {
    expect(quote('')).toBe('');
    expect(quote(null)).toBe('');
    expect(quote('  英検　2 級  ')).toBe('英検 2 級');
    expect(quote('a。b？c\nd')).toBe('a b c d');
    const long = 'あ'.repeat(50);
    expect(quote(long)).toBe(`${'あ'.repeat(QUOTE_MAX)}…`);
  });

  test('動的な発言は空文字・長い文で壊れない', () => {
    expect(afterGoalText('')).toEqual(goalIntro());
    expect(afterGoalText('   ')).toEqual(goalIntro());
    expect(afterGoalText('数学の期末').text).toContain('「数学の期末」');
    const long = afterGoalText('い'.repeat(300) + '。う。え。');
    expect(sentences(long.text).length).toBeLessThanOrEqual(2);
    expect(long.text).toContain('…');
    expect(deadlineAsk('').text.startsWith('いつまで')).toBe(true);
    expect(deadlineAsk('期末').text).toContain('「期末」は');
    expect(minutesAsk(null).text.startsWith('1 日に使える時間')).toBe(true);
    expect(minutesAsk('11/30').text).toContain('期限は 11/30 ですね');
    expect(materialsAsk(null).text).toContain('おまかせ');
    expect(materialsAsk(45).text).toContain('1 日 45 分');
    expect(materialsAsk(NaN).text).toContain('おまかせ');
    expect(goalIntro('').text.startsWith('何を')).toBe(true);
    expect(importFound(-1)).toEqual(importFound(0));
    expect(importFound(2).text).toContain('2 件');
    expect(importIntro({ google: true, ics: true }).text).toContain('Google');
    expect(importIntro({ google: false, ics: false }).text).not.toContain('カレンダー');
  });

  test('決まった発言はここにある（ログイン・ホームの空・読み込み中）', () => {
    expect(Object.keys(AGENT_LINES).sort()).toEqual(['homeEmpty', 'importReading', 'login']);
  });
});

describe('部品 AgentSays', () => {
  const src = read('components/AgentSays.tsx');

  test('返事待ちは点、小さい時は 1 文、ふだんは 2 文まで', () => {
    const line = { text: '一つ目。二つ目。三つ目。', short: '短い。' };
    expect(bubbleText({ ...line, waiting: true }, false)).toBe(WAITING_DOTS);
    expect(bubbleText({ ...line, waiting: true }, true)).toBe(WAITING_DOTS);
    expect(bubbleText(line, false)).toBe('一つ目。二つ目。');
    expect(bubbleText(line, true)).toBe('短い。');
    expect(bubbleText({ text: line.text }, true)).toBe('一つ目。');
  });

  test('姿の選び方: 返事待ち＝thinking・できた＝happy・それ以外＝idle', () => {
    expect(poseFor({ waiting: true })).toBe('thinking');
    expect(poseFor({ waiting: true, done: true })).toBe('thinking');
    expect(poseFor({ done: true })).toBe('happy');
    expect(poseFor({})).toBe('idle');
    expect(Object.keys(MASCOT_POSES)).toHaveLength(12);
    expect(src).toContain('props.pose ?? poseFor({ waiting, done: props.done })');
  });

  test('小画面とキーボードの間も、小さなエビが残る', () => {
    expect(AGENT_ICON_SIZE).toBe(88);
    expect(AGENT_SMALL_ICON_SIZE).toBe(64);
    expect(isSmallScreen(699)).toBe(true);
    expect(isSmallScreen(700)).toBe(false);
    expect(src).toContain('keyboardDidShow');
    expect(src).not.toContain('{keyboard ? null : (');
    expect(src).toContain('motionKey={popKey}');
  });

  test('浮かぶ動き: 透明度と縮尺、動きを減らす設定では動かさない、読み上げは文', () => {
    expect(POP_FROM_SCALE).toBeLessThan(1);
    expect(src).toContain("from '../lib/useReduceMotion'");
    expect(src).toContain('if (reduce) return v.setValue(1);');
    expect(src).toContain('opacity: v, transform: [{ scale }]');
    expect(src).toContain("accessibilityLabel={waiting ? '考え中' : shown}");
    expect(src).toContain('waiting={waiting} pose={pose}');
  });
});

describe('置いた画面', () => {
  test('ログイン: 見出しの下', () => {
    const s = read('app/login.tsx');
    expect(s).toContain('<AgentSays {...AGENT_LINES.login}');
    expect(s.indexOf('<AgentSays')).toBeGreaterThan(s.indexOf('<Title>ログイン</Title>'));
    expect(s.indexOf('<AgentSays')).toBeLessThan(s.indexOf('testID="login-name"'));
  });

  // 足す（#315 準備のフロー）: 最初の一言 → 話した目標を受ける（期限が無ければ聞く）→ 決めた
  test('足す: 入口・受け・期限・資料・決めた の一言を agentLines から読む', () => {
    const s = read('app/goal/new.tsx');
    for (const k of ['addIntro()', 'addHeard(', 'addDeadlineSet(', 'addMaterialsIn()', 'addDecided()']) {
      expect([k, s.includes(k)]).toEqual([k, true]);
    }
    expect(s).toContain('<AgentSays {...line} chat');
    expect(s).not.toContain('minutesAsk(');
  });

  test('課題の取り込み: 入口の案内（読み込み中は待ち）と、取れた候補の一言', () => {
    const s = read('app/goal/import.tsx');
    expect(s).toContain('importIntro(');
    expect(s).toContain('AGENT_LINES.importReading');
    expect(s).toContain('waiting={reading}');
    expect(s).toContain('importFound(rows.length)');
    expect(s.indexOf('import-agent-found')).toBeLessThan(s.indexOf('<ImportCandidates'));
  });

  test('発言の文は画面に直接書かず、lib/agentLines から読む', () => {
    for (const f of ['app/login.tsx', 'app/goal/new.tsx', 'app/goal/import.tsx', 'app/(tabs)/index.tsx']) {
      const s = read(f);
      expect([f, /<AgentSays\s+text=/.test(s)]).toEqual([f, false]);
    }
  });
});

describe('口調（UI 刷新・11/9 に砕けた敬語へ統一）', () => {
  it('決まった発言は「だね」「してみて」「かな」で終えない', () => {
    for (const l of allAgentLines()) {
      expect(l.text).not.toMatch(/だね|てみて[。]|かな。/);
      expect(l.short).not.toMatch(/だね|てみて[。]|かな。/);
    }
  });
});
