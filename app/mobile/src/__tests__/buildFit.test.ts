import {
  buildFit,
  CARD_H,
  cardTop,
  CROWN_H,
  crownColor,
  DROP_PX,
  emptyTowerHeight,
  isWideTower,
  OUTLINE_ROWS,
  showOutline,
  WIDE_CARD_W,
  WIDE_GAP,
  WIDE_MAX_SCALE,
  WIDE_MIN_SCALE,
  WIDE_PAD,
  wideTowerColumn,
  wideTowerScale,
  MAX_BLOCKS,
  MIN_BLOCKS,
  MIN_SCALE,
  ROW_H,
  seamBelow,
  towerHeight,
  towerScale,
  WINDOWS,
  windowsLit,
  windowsByColor,
  litByColor,
} from '../lib/buildFit';
import { CANVAS_W, FLOOR_H, TOP_H } from '../lib/isoTower';

describe('見下ろした建物の寸法（#269）', () => {
  it('1 階で FLOOR_H だけ高くなり、屋根の分は上面の菱形を含む', () => {
    expect(ROW_H).toBe(FLOOR_H);
    expect(CROWN_H).toBeGreaterThanOrEqual(TOP_H);
    expect(towerHeight(10) - towerHeight(9)).toBe(ROW_H);
  });
});

describe('towerScale / cardTop', () => {
  it.each([1, 4, 34])('階 %i: 高さ 800 に収まる縮尺', (n) => {
    const r = towerScale(800, n);
    expect(r.scale).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(r.scale).toBeLessThanOrEqual(1);
    expect(r.height).toBeLessThanOrEqual(800);
    expect(r.maxBlocks).toBeGreaterThanOrEqual(1);
  });
  it('階が少ない時は等倍、多い時は小さい', () => {
    expect(towerScale(800, 1).scale).toBe(1);
    expect(towerScale(800, 34).scale).toBeLessThan(towerScale(800, 4).scale);
  });
  it('札の位置は建物の中に入る', () => {
    const h = towerHeight(34) * 0.5;
    for (const i of [0, 10, 33]) {
      const t = cardTop(i, 34, 0.5, h);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(Math.max(0, h - CARD_H));
    }
  });
});

describe('PC 幅の建物（wideTowerScale）', () => {
  it('900px から PC 幅', () => {
    expect(isWideTower(375)).toBe(false);
    expect(isWideTower(768)).toBe(false);
    expect(isWideTower(900)).toBe(true);
    expect(isWideTower(1366)).toBe(true);
    expect(isWideTower(Number.NaN)).toBe(false);
  });
  it('1366×768: スマホの縮尺より大きく、高さに収まる', () => {
    for (const n of [3, 12, 20]) {
      const wide = wideTowerScale(1366, 768, n);
      expect(wide.scale).toBeGreaterThan(towerScale(768, n).scale);
      expect(wide.scale).toBeGreaterThanOrEqual(WIDE_MIN_SCALE);
      expect(wide.scale).toBeLessThanOrEqual(WIDE_MAX_SCALE);
      expect(wide.height).toBeLessThanOrEqual(768);
    }
  });
  it('階が少なければ等倍を超えて大きくする（建物が細い柱にならない）', () => {
    expect(wideTowerScale(1366, 768, 3).scale).toBeGreaterThan(1);
  });
  it('建物の列と札の列は横に並び、画面の幅に収まる', () => {
    const col = wideTowerColumn(1366);
    expect(col).toBeGreaterThan(0);
    expect(88 + 2 * WIDE_PAD + col + WIDE_GAP + WIDE_CARD_W).toBeLessThanOrEqual(1366);
    // 絵の幅（見下ろした建物と日付の文字）× 縮尺が列に入る
    expect(CANVAS_W * wideTowerScale(1366, 2000, 2).scale).toBeLessThanOrEqual(col);
  });
  it('階が多くて入らない時は直近の階だけ出す', () => {
    const r = wideTowerScale(1366, 768, 200);
    expect(r.maxBlocks).toBeLessThan(200);
    expect(r.height).toBeLessThanOrEqual(768);
  });
});

describe('0 階の輪郭', () => {
  it('0 階で枠を出す画面なら輪郭、塗りがある・階がある・枠を出さない時は出さない', () => {
    expect(showOutline(true, 0, 0)).toBe(true);
    expect(showOutline(true, 0, 0.5)).toBe(false);
    expect(showOutline(true, 1, 0)).toBe(false);
    expect(showOutline(undefined, 0, 0)).toBe(false);
  });
  it('輪郭の建物の縦は、胴の分だけ 0 階の枠より高い', () => {
    expect(emptyTowerHeight()).toBe(towerHeight(0) + (OUTLINE_ROWS - 1) * ROW_H);
    expect(towerScale(800, 0).height).toBe(emptyTowerHeight());
  });
});

describe('buildFit', () => {
  it.each([667, 760, 900])('高さ %i: 文字と次の階の枠が重ならない', (h) => {
    const fit = buildFit(h);
    expect(fit.textBottom).toBeLessThanOrEqual(fit.slotTop);
  });

  it.each([667, 760, 900])('高さ %i: 落ちてくる途中の板とも文字が重ならない', (h) => {
    const fit = buildFit(h);
    expect(fit.textBottom).toBeLessThanOrEqual(fit.topBlockTop - DROP_PX);
  });

  it.each([667, 760, 900])('高さ %i: 階数は 4〜12', (h) => {
    const { maxBlocks } = buildFit(h);
    expect(maxBlocks).toBeGreaterThanOrEqual(MIN_BLOCKS);
    expect(maxBlocks).toBeLessThanOrEqual(MAX_BLOCKS);
  });

  it('背の低い画面ほど階数が少ない', () => {
    expect(buildFit(667).maxBlocks).toBeLessThan(buildFit(760).maxBlocks);
    expect(buildFit(760).maxBlocks).toBeLessThanOrEqual(buildFit(900).maxBlocks);
  });

  it('とても低い画面でも 4 階、とても高い画面でも 12 階まで', () => {
    expect(buildFit(300).maxBlocks).toBe(MIN_BLOCKS);
    expect(buildFit(3000).maxBlocks).toBe(MAX_BLOCKS);
  });

  it('階が少なければ建物は低く、枠は地面に近い', () => {
    const few = buildFit(760, 2);
    const full = buildFit(760);
    expect(few.topBlockTop - full.topBlockTop).toBe((full.maxBlocks - 2) * ROW_H);
  });

  it('高さが数でない時も壊れない', () => {
    expect(buildFit(Number.NaN).maxBlocks).toBe(MIN_BLOCKS);
  });

  it.each([667, 760, 900])('高さ %i: 屋根と旗も文字と重ならず、枠の真上に乗る', (h) => {
    const fit = buildFit(h);
    expect(fit.crownTop).toBe(fit.slotTop - CROWN_H);
    expect(fit.textBottom).toBeLessThanOrEqual(fit.crownTop);
  });
});

describe('windowsLit', () => {
  it('4 つの窓のうち 1〜4 つが点く', () => {
    for (let n = 1; n <= 200; n++) {
      const lit = windowsLit(n);
      expect(lit).toHaveLength(WINDOWS);
      const on = lit.filter(Boolean).length;
      expect(on).toBeGreaterThanOrEqual(1);
      expect(on).toBeLessThanOrEqual(4);
    }
  });

  it('同じ階は何度描いても同じ（乱数でない）', () => {
    for (let n = 1; n <= 30; n++) expect(windowsLit(n)).toEqual(windowsLit(n));
  });

  it('階の番号の式で決まる（例: 1 階・2 階）', () => {
    // (n*7+3)%15+1 の 4 ビット。1 階 = 11 = 0b1011、2 階 = 3 = 0b0011
    expect(windowsLit(1)).toEqual([true, true, false, true]);
    expect(windowsLit(2)).toEqual([true, true, false, false]);
  });

  it('階ごとに不揃い（全部の階が同じ模様ではない）', () => {
    const patterns = new Set(Array.from({ length: 12 }, (_, i) => windowsLit(i + 1).join()));
    expect(patterns.size).toBeGreaterThan(3);
  });

  it('数でない番号でも壊れない', () => {
    expect(windowsLit(Number.NaN).filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });
});

describe('seamBelow', () => {
  const colors = ['gold', 'gold', 'silver', 'bronze', 'bronze'];
  it('下の階が同じ色なら継ぎ目を入れる', () => {
    expect(seamBelow(colors, 1)).toBe(true);
    expect(seamBelow(colors, 4)).toBe(true);
  });
  it('色が変わる所・いちばん下・範囲外には入れない', () => {
    expect(seamBelow(colors, 0)).toBe(false);
    expect(seamBelow(colors, 2)).toBe(false);
    expect(seamBelow(colors, 3)).toBe(false);
    expect(seamBelow(colors, 5)).toBe(false);
  });
});

describe('crownColor', () => {
  it('屋根と旗は最上階の色', () => {
    expect(crownColor(['gold', 'silver', 'bronze'])).toBe('bronze');
    expect(crownColor(['silver'])).toBe('silver');
  });
  it('階が無ければ屋根なし', () => {
    expect(crownColor([])).toBeNull();
  });
});

describe('窓の明かり＝階の色（決定 11/9）', () => {
  it('銅 1・銀 2・金 4（全部）・色が無い時は灯らない', () => {
    expect(['bronze', 'silver', 'gold', undefined, 'x'].map(litByColor)).toEqual([1, 2, 4, 0, 0]);
  });
  it('同じ seed なら同じ・違う seed で少なくとも 1 つはばらける', () => {
    expect(windowsByColor('a:1', 'silver')).toEqual(windowsByColor('a:1', 'silver'));
    expect(windowsByColor('a:1', 'gold')).toEqual([true, true, true, true]);
    const seen = new Set<string>();
    for (let n = 1; n <= 20; n++) {
      const w = windowsByColor(`f1:${n}`, 'silver');
      expect(w.filter(Boolean)).toHaveLength(2);
      seen.add(w.join());
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
