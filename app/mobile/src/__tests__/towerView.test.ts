import { achievementWords, colorTally, helpWords, ownScoreWords, tallyText } from '../lib/towerView';

describe('colorTally', () => {
  it('色ごとに階を足す', () => {
    const t = colorTally([
      { color: 'gold', floors: 2 },
      { color: 'bronze', floors: 1 },
      { color: 'gold', floors: 1 },
    ]);
    expect(t).toEqual({ gold: 3, silver: 0, bronze: 1, total: 4 });
    expect(tallyText(t)).toBe('金 3・銀 0・銅 1・合計 4');
  });
});

describe('achievementWords', () => {
  it('判定が無ければ null', () => {
    expect(achievementWords(null, null)).toBeNull();
  });
  it('同じなら言葉ひとつ', () => {
    expect(achievementWords(2, 2)).toBe('だいたい');
    expect(achievementWords(3, null)).toBe('できた');
  });
  it('違えば AI と自分を並べる', () => {
    expect(achievementWords(1, 3)).toBe('モルティ 少し・自分 できた');
  });
  it('自分だけ', () => {
    expect(achievementWords(null, 0)).toBe('自分 まだ');
  });
});

describe('helpWords', () => {
  it('借りていなければ なし', () => {
    expect(helpWords({ small: 0, medium: 0 })).toBe('なし');
  });
  it('0 の方は省く', () => {
    expect(helpWords({ small: 2, medium: 0 })).toBe('ヒント 2');
    expect(helpWords({ small: 1, medium: 3 })).toBe('ヒント 1・やり方 3');
  });
});

describe('ownScoreWords', () => {
  it('丸めて /100 を付ける', () => {
    expect(ownScoreWords(69.6)).toBe('70/100');
    expect(ownScoreWords(NaN)).toBe('0/100');
    expect(ownScoreWords(150)).toBe('100/100');
  });
});
