declare const require: (name: string) => any;
declare const __dirname: string;

import { barFill, HELP_BAR_FULL_MEDIUM, HELP_BAR_FULL_SMALL, miniLit } from '../lib/helpBar';
import { helpBarLabel } from '../components/HelpBars';

describe('借りた分の棒', () => {
  test('一杯になる回数: ヒント（small）は 20・やり方（medium）は 8（#196）', () => {
    expect(HELP_BAR_FULL_SMALL).toBe(20);
    expect(HELP_BAR_FULL_MEDIUM).toBe(8);
  });

  test('0 回は空、1 回以上は見える長さ', () => {
    expect(barFill(0, HELP_BAR_FULL_SMALL)).toBe(0);
    expect(barFill(1, HELP_BAR_FULL_SMALL)).toBeGreaterThan(0);
    expect(barFill(1, HELP_BAR_FULL_MEDIUM)).toBeGreaterThan(0);
  });

  test('回数に比例し、それぞれの上限で一杯になる', () => {
    expect(barFill(2, HELP_BAR_FULL_SMALL)).toBeGreaterThan(barFill(1, HELP_BAR_FULL_SMALL));
    expect(barFill(3, HELP_BAR_FULL_SMALL)).toBeCloseTo(0.15);
    expect(barFill(19, HELP_BAR_FULL_SMALL)).toBeLessThan(1);
    expect(barFill(20, HELP_BAR_FULL_SMALL)).toBe(1);
    expect(barFill(30, HELP_BAR_FULL_SMALL)).toBe(1);
    expect(barFill(4, HELP_BAR_FULL_MEDIUM)).toBe(0.5);
    expect(barFill(7, HELP_BAR_FULL_MEDIUM)).toBeLessThan(1);
    expect(barFill(8, HELP_BAR_FULL_MEDIUM)).toBe(1);
    expect(barFill(18, HELP_BAR_FULL_MEDIUM)).toBe(1);
  });

  test('おかしな値でも落ちない', () => {
    expect(barFill(-3, HELP_BAR_FULL_SMALL)).toBe(0);
    expect(barFill(NaN, HELP_BAR_FULL_SMALL)).toBe(0);
    expect(barFill(3, 0)).toBe(1);
  });

  test('返事の横の棒は、小・中の点き方が違う。none（問い返しだけ）は何も灯さない', () => {
    expect(miniLit('none')).toEqual({ small: false, medium: false });
    expect(miniLit('small')).toEqual({ small: true, medium: false });
    expect(miniLit('medium')).toEqual({ small: true, medium: true });
  });

  test('棒は 2 つの定数を使う。一杯でも警告・ロックは出さない（長さだけ）', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(`${__dirname}/../components/HelpBars.tsx`, 'utf8');
    expect(src).toContain('barFill(props.small, HELP_BAR_FULL_SMALL)');
    expect(src).toContain('barFill(props.medium, HELP_BAR_FULL_MEDIUM)');
    expect(src.indexOf('disabled', 0)).toBe(-1);
    expect(src.indexOf('danger', 0)).toBe(-1);
  });

  test('読み上げの名前は今のまま', () => {
    expect(helpBarLabel(2, 1)).toBe('モルティの手助け ヒント 2 やり方 1');
  });
});
