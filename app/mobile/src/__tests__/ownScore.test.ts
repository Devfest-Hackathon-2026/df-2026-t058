import { ownScore } from '../lib/score';

describe('ownScore（サーバーと同じ式・11/9）', () => {
  it('small が何件でも自分で決めた度は変わらない', () => {
    for (const n of [0, 1, 5, 100]) expect(ownScore('own', undefined, n, 0)).toBe(70);
  });

  it('medium 1 件で 10 下がる。引き算は 40 まで', () => {
    expect(ownScore('own', undefined, 0, 1)).toBe(60);
    expect(ownScore('own', undefined, 9, 4)).toBe(30);
    expect(ownScore('own', undefined, 0, 50)).toBe(30);
  });
});
