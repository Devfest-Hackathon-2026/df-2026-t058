import { editRatio, percent } from '../lib/editRatio';

const cp = (title: string, doneMark = '目印', estimateMin = 30) => ({ title, doneMark, estimateMin });
const base = [cp('例題 3 問'), cp('練習 5 問'), cp('小テスト'), cp('解き直し'), cp('まとめ')];

describe('直した割合', () => {
  test('そのままは 0', () => {
    expect(editRatio(base, base.map((c) => ({ ...c })))).toBe(0);
  });

  test('前後の空白は同じとみなす', () => {
    expect(editRatio(base, base.map((c) => ({ ...c, title: ` ${c.title} ` })))).toBe(0);
  });

  test('5 個中 1 個だけ直すと 0.2', () => {
    const e = base.map((c, i) => (i === 0 ? cp('過去の小テスト 2 問') : c));
    expect(editRatio(base, e)).toBe(0.2);
  });

  test('見積りを変えても直したことになる', () => {
    const e = base.map((c, i) => (i === 2 ? { ...c, estimateMin: 45 } : c));
    expect(editRatio(base, e)).toBe(0.2);
  });

  test('全部書き換えは 1', () => {
    expect(editRatio(base, base.map((c) => cp(`${c.title}!`)))).toBe(1);
  });

  test('1 個足すと 1/6', () => {
    expect(editRatio(base, [...base, cp('追加')])).toBeCloseTo(0.167, 3);
  });

  test('1 個消すと 1/5', () => {
    expect(editRatio(base, base.slice(1))).toBe(0.2);
  });

  test('両方空は 0', () => {
    expect(editRatio([], [])).toBe(0);
  });

  test('% の表示', () => {
    expect(percent(0.3)).toBe('30%');
    expect(percent(0.167)).toBe('17%');
  });
});
