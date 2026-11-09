// 言い回しの表どおりに置き換わり、古い言葉が画面の文字列に残っていないことを、原稿を読んで確かめる
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import * as copy from '../lib/copy';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ディレクトリ内の .ts/.tsx を全部読む（試験は除く）
const walk = (dir: string): string[] => {
  const abs = path.join(__dirname, dir);
  const out: string[] = [];
  for (const name of fs.readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (fs.statSync(path.join(abs, name)).isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
};

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('言い回し', () => {
  it('表のとおりの言葉', () => {
    expect(copy.COPY_START).toBe('始める');
    expect(copy.COPY_CONTINUE).toBe('続ける');
    expect(copy.COPY_GOALS_HEADING).toBe('進めている目標');
    expect(copy.COPY_TODAY_STEP).toBe('今日の一歩');
    expect(copy.COPY_NO_ROAD).toBe('進め方がまだ決まっていません');
    expect(copy.COPY_FRIEND_FEED).toBe('友達の動き');
    expect(copy.COPY_DISPLAY_NAME).toBe('表示名');
    expect(copy.COPY_ADD_CALENDAR).toBe('カレンダーに入れる');
    expect(copy.COPY_ASK_AI).toBe('モルティに聞く');
    expect('COPY_KIND_ASK' in copy).toBe(false);
    expect('COPY_KIND_RESEARCH' in copy).toBe(false);
    expect(copy.COPY_PICK_PHOTO).toBe('写真を選ぶ');
    expect(copy.COPY_JUDGE).toBe('モルティに見てもらう');
    expect(copy.COPY_ADD_SOURCE).toBe('資料を足す');
    expect(copy.COPY_TO_TODAY).toBe('今日の画面へ');
    expect(copy.COPY_INVITE_CODE).toBe('招待コード');
    expect(copy.COPY_LOGIN).toBe('ログイン');
    expect(copy.COPY_AI_HELP).toBe('モルティの手助け');
    expect(copy.COPY_HELP_SMALL).toBe('ヒント');
    expect(copy.COPY_HELP_MEDIUM).toBe('やり方');
    expect(copy.COPY_FRIEND_ACTIVE).toBe('取り組み中');
  });

  it('画面は定数を使う', () => {
    expect(read('../lib/moltyActions.ts')).toContain('return COPY_START;');
    expect(read('../app/(tabs)/friends.tsx')).toContain('COPY_FRIEND_ACTIVE');
    expect(read('../app/(tabs)/tower.tsx')).toContain('COPY_AI_HELP');
    expect(read('../components/TutorChat.tsx')).toContain('COPY_AI_HELP');
    expect(read('../components/HelpBars.tsx')).toContain('COPY_HELP_SMALL');
    expect(read('../lib/towerView.ts')).toContain('COPY_HELP_MEDIUM');
    expect(read('../lib/homeView.ts')).toContain('COPY_CONTINUE');
  });

  it('古い言葉が画面の文字列に残っていない', () => {
    for (const f of [...walk('../app'), ...walk('../components'), ...walk('../lib')]) {
      const src = stripComments(read(f));
      expect(src).not.toContain('集中を始める');
      expect(src).not.toContain('集中に戻る');
      expect(src).not.toContain('借りた');
      expect(src).not.toContain('AI の助け');
      expect(src).not.toContain('はじめる');
      expect(src).not.toContain('つづける');
      expect(src).not.toContain('材料を足す');
      expect(src).not.toContain('判定する');
      expect(src).not.toContain('自分の名前');
      expect(src).not.toContain('今日やること');
      expect(src).not.toContain('予定に入れる');
    }
  });

  it('段の番号は 目標1・案2・始める3・集中4・振り返る5、階の場面と相談は番号なし', () => {
    const layout = read('../app/_layout.tsx');
    // 足す・道を決めるは見出しを出さず、準備の帯（SceneTop・2 本の線）で見せる（#315・決定 11/9）
    expect(layout).toContain("title: '足す', animation: 'fade', headerShown: false");
    expect(layout).toContain("title: '道を決める', animation: 'fade', headerShown: false");
    expect(read('../app/plan/[goalId].tsx')).toContain('<SceneTop scene="plan"');
    // 始めるは聞かずに集中へ入る場面転換だけ（見出しなし・#315）
    expect(layout).toContain("title: '始める', animation: 'fade', headerShown: false");
    // 集中は見出しを出さず、場面の帯（SceneTop）で見せる（#315）
    expect(layout).toContain("title: '集中', animation: 'fade', headerShown: false");
    expect(read('../app/focus/[sessionId].tsx')).toContain('<SceneTop');
    expect(layout).toContain("'5/5　振り返る'");
    expect(layout).not.toContain("'3/5　集中'");
    expect(read('../app/reflect/[sessionId].tsx')).not.toContain('5/5　階');
    const steps = read('../components/FlowSteps.tsx');
    expect(steps).toContain("['目標を書く', '案から選ぶ', '始める', '集中する', '振り返る']");
  });
});
