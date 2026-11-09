import { candidateName, candidateSummary } from '../lib/candidateLabel';

describe('案の札の表示', () => {
  test('名前があればそれを出す（前後の空白は除く）', () => {
    expect(candidateName({ label: ' 小さく刻む ' }, 0)).toBe('小さく刻む');
  });
  test('空なら A・B・C に戻る', () => {
    expect(candidateName({ label: '' }, 0)).toBe('A');
    expect(candidateName({ label: '   ' }, 1)).toBe('B');
    expect(candidateName({ label: undefined }, 2)).toBe('C');
  });
  test('4 つ目以降は番号', () => {
    expect(candidateName({ label: '' }, 3)).toBe('4');
  });
  test('一言は空でも壊れない', () => {
    expect(candidateSummary({ summary: ' まとめて進める ' })).toBe('まとめて進める');
    expect(candidateSummary({ summary: '' })).toBe('');
    expect(candidateSummary({ summary: null })).toBe('');
  });
});
