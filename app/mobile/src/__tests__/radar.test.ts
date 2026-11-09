import { axisAngle, labelFor, pointFor, polygonPoints, ringPoints } from '../lib/radar';

const g = { cx: 100, cy: 100, radius: 50, max: 5 };

describe('レーダーの座標', () => {
  test('0 本目は真上', () => {
    expect(axisAngle(0, 5)).toBeCloseTo(-Math.PI / 2);
    expect(pointFor(0, 5, 5, g)).toEqual({ x: 100, y: 50 });
  });

  test('4 軸なら 1 本目は右・2 本目は下', () => {
    expect(pointFor(1, 4, 5, g)).toEqual({ x: 150, y: 100 });
    expect(pointFor(2, 4, 5, g)).toEqual({ x: 100, y: 150 });
  });

  test('値の半分は半径の半分', () => {
    const p = pointFor(1, 4, 2.5, g);
    expect(p).toEqual({ x: 125, y: 100 });
  });

  test('範囲外と数でない値は端に寄せる', () => {
    expect(pointFor(0, 5, 9, g)).toEqual({ x: 100, y: 50 });
    expect(pointFor(0, 5, -3, g)).toEqual({ x: 100, y: 100 });
    expect(pointFor(0, 5, Number.NaN, g)).toEqual({ x: 100, y: 100 });
  });

  test('多角形は軸の順に並び、無い軸は 0', () => {
    const s = polygonPoints(['a', 'b', 'c', 'd'], { a: 5, b: 5, d: 5 }, g);
    expect(s).toBe('100,50 150,100 100,100 50,100');
  });

  test('目盛りの輪は軸の数だけ点がある', () => {
    expect(ringPoints(5, 5, g).split(' ')).toHaveLength(5);
  });

  test('軸の名前の寄せ方', () => {
    expect(labelFor(0, 4, g, 10).anchor).toBe('middle');
    expect(labelFor(1, 4, g, 10).anchor).toBe('start');
    expect(labelFor(3, 4, g, 10).anchor).toBe('end');
  });
});

import { splitLabel } from '../lib/radar';

describe('軸の名前の折り返し', () => {
  test('短い名前はそのまま', () => {
    expect(splitLabel('確実さ')).toEqual(['確実さ']);
    expect(splitLabel('負担の軽さ')).toEqual(['負担の軽さ']);
  });
  test('「の」「で」の後ろで切る', () => {
    expect(splitLabel('見通しの立てやすさ')).toEqual(['見通しの', '立てやすさ']);
    expect(splitLabel('途中での直しやすさ')).toEqual(['途中での', '直しやすさ']);
    expect(splitLabel('自力で決める余地')).toEqual(['自力で', '決める余地']);
  });
  test('切れ目が無ければ真ん中', () => {
    expect(splitLabel('あいうえおかき')).toEqual(['あいうえ', 'おかき']);
  });
});
