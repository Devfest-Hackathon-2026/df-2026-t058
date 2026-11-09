import type { Checkpoint } from '../api/types';
import { achievementText, cardInFooter, chipScrollX, friendName } from '../lib/homeView';

const cp = (id: string) => ({ id }) as Checkpoint;

describe('homeView', () => {
  it('どこまでできたかは言葉と棒', () => {
    expect(achievementText(null)).toBe('-');
    expect(achievementText(0)).toBe('まだ ○○○');
    expect(achievementText(2)).toBe('だいたい ●●○');
    expect(achievementText(3)).toBe('できた ●●●');
  });

  it('今日でない丸を選んだ時だけ札を下に出す', () => {
    expect(cardInFooter(cp('a'), cp('a'))).toBe(false);
    expect(cardInFooter(cp('b'), cp('a'))).toBe(true);
    expect(cardInFooter(cp('b'), null)).toBe(true);
    expect(cardInFooter(null, cp('a'))).toBe(false);
  });

  it('名前が無い友達は ID の頭 2 文字', () => {
    expect(friendName({ displayName: '', userId: 'xy123' })).toBe('xy');
    expect(friendName({ displayName: '  ', userId: 'xy123' })).toBe('xy');
    expect(friendName({ displayName: 'ひな', userId: 'xy123' })).toBe('ひな');
  });

  it('札の送り量は端を越えない', () => {
    const base = { count: 4, itemWidth: 160, gap: 8, viewportWidth: 343 };
    expect(chipScrollX({ ...base, index: 0 })).toBe(0);
    expect(chipScrollX({ ...base, index: 1 })).toBe(76.5);
    expect(chipScrollX({ ...base, index: 2 })).toBe(168 * 2 - 91.5);
    expect(chipScrollX({ ...base, index: 3 })).toBe(4 * 160 + 3 * 8 - 343);
  });
});
