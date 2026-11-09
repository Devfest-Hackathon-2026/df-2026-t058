import { showNextSlot, slotFill, slotFillHeight, slotLabel } from '../lib/towerSlot';

describe('showNextSlot', () => {
  it('nextSlot が true なら 0 階でも出す', () => {
    expect(showNextSlot(true, 0)).toBe(true);
  });
  it('階があっても出す', () => {
    expect(showNextSlot(true, 3)).toBe(true);
  });
  it('オプションが無ければ出さない', () => {
    expect(showNextSlot(undefined, 0)).toBe(false);
    expect(showNextSlot(false, 5)).toBe(false);
  });
});

describe('slotFill', () => {
  it('0 分・不正な値は 0', () => {
    expect(slotFill(0)).toBe(0);
    expect(slotFill(-3)).toBe(0);
    expect(slotFill(NaN)).toBe(0);
    expect(slotFill(5, 0)).toBe(0);
  });
  it('階にならない分は、15 分に対する割合', () => {
    expect(slotFill(7.5)).toBeCloseTo(0.5);
    expect(slotFill(3)).toBeCloseTo(0.2);
  });
  it('階になった分は引いた端数', () => {
    expect(slotFill(20)).toBeCloseTo(5 / 15);
    expect(slotFill(15)).toBe(0);
  });
  it('階の分数を変えられる', () => {
    expect(slotFill(1, 2)).toBeCloseTo(0.5);
  });
});

describe('slotFillHeight', () => {
  it('0 なら 0', () => {
    expect(slotFillHeight(0, 32)).toBe(0);
  });
  it('少しでも塗れば最低 4px', () => {
    expect(slotFillHeight(0.01, 32)).toBe(4);
  });
  it('枠の高さを超えない', () => {
    expect(slotFillHeight(0.5, 32)).toBe(16);
    expect(slotFillHeight(2, 32)).toBe(32);
  });
});

describe('slotLabel', () => {
  it('塗りがあれば割合を言う', () => {
    expect(slotLabel(0.5)).toContain('50');
  });
  it('無ければ名前だけ', () => {
    expect(slotLabel(0)).toBe('次の階の空き');
  });
});
