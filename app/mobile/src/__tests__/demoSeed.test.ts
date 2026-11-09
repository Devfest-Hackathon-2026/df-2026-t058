import { showDemoSeed } from '../api/demoSeed';

describe('showDemoSeed', () => {
  it('目標 0 件で demoSeed: true の時だけ出す', () => {
    expect(showDemoSeed({ demoSeed: true }, 0)).toBe(true);
  });
  it('目標がある時は出さない', () => {
    expect(showDemoSeed({ demoSeed: true }, 1)).toBe(false);
  });
  it('demoSeed が無い・false・health が取れていない時は出さない', () => {
    expect(showDemoSeed({}, 0)).toBe(false);
    expect(showDemoSeed({ demoSeed: false }, 0)).toBe(false);
    expect(showDemoSeed(null, 0)).toBe(false);
    expect(showDemoSeed(undefined, 0)).toBe(false);
  });
});
