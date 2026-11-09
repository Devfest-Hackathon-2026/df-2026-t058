// #315 振り返りを対話の形に: 場面の帯・モルティが聞く・カード・下に大きなマイク・最後はモルティが建物の横で評価を伝える
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const s: string = fs.readFileSync(path.join(__dirname, '..', 'app', 'reflect', '[sessionId].tsx'), 'utf8');

describe('振り返りの画面', () => {
  it('場面の帯（振り返り）と、下の大きなマイク', () => {
    expect(s).toContain('<SceneTop scene="reflect" />');
    expect(s).toContain('testID="reflect-voice"');
  });
  it('決めるのは本人: モルティの見立てと別に、自分の判定（4 段階）を押す', () => {
    expect(s).toContain('COPY_MOLTY_VIEW');
    expect(s).toContain('COPY_MY_VIEW');
    expect(s).toContain('testID={`level-${a}`}');
    expect(s).toContain('void confirm(a)');
  });
  it('最後: モルティが建物の横に立ち、見立ての札と窓の一言を出す', () => {
    expect(s).toContain('<MoltyStand />');
    expect(s).toContain('testID="build-verdict"');
    // モルティは建物の横の 1 人だけ（吹き出しには絵を出さない）
    expect(s).toContain('<AgentSays {...builtLine(builtPt, lit, builtColor, f?.floors ?? null)} chat noIcon done');
  });
  it('使った資料・行き詰まった所の欄は出さない', () => {
    expect(s).not.toContain('もっと書く');
    expect(s).not.toContain('label="使った資料"');
  });
});
