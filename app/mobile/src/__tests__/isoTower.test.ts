// 見下ろした建物（等角）の計算（#269）
import {
  BODY_W,
  canvasHeight,
  CANVAS_W,
  floorHitRect,
  floorOrigin,
  FLOOR_H,
  isoBlock,
  type Pt,
  roof,
  TOP_H,
  towerSize,
} from '../lib/isoTower';

const C = Math.cos(Math.PI / 6);
const area = (ps: Pt[]) =>
  Math.abs(ps.reduce((s, p, i) => {
    const q = ps[(i + 1) % ps.length] ?? p;
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
const xs = (ps: Pt[]) => ps.map((p) => p[0]);
const ys = (ps: Pt[]) => ps.map((p) => p[1]);

describe('isoBlock', () => {
  const f = isoBlock({ x: 100, y: 200, w: 40, d: 20, h: 10 });
  it('既知の入力で頂点が一致する（仰角 30°: 横 cos30・縦 sin30）', () => {
    expect(f.left[0]).toEqual([100, 200]);
    expect(f.left[1]?.[0]).toBeCloseTo(100 - 40 * C);
    expect(f.left[1]?.[1]).toBeCloseTo(180);
    expect(f.left[2]?.[1]).toBeCloseTo(170);
    expect(f.right[1]?.[0]).toBeCloseTo(100 + 20 * C);
    expect(f.right[1]?.[1]).toBeCloseTo(190);
    expect(f.top[0]).toEqual([100, 190]);
    // 奥の角: 左へ w、右へ d 進んだ所
    expect(f.top[2]?.[0]).toBeCloseTo(100 - 40 * C + 20 * C);
    expect(f.top[2]?.[1]).toBeCloseTo(200 - 30 - 10);
  });
  it('3 面は重ならない: 左の面は手前の辺より左、右の面は右。上面は側面より上', () => {
    expect(Math.max(...xs(f.left))).toBeLessThanOrEqual(100);
    expect(Math.min(...xs(f.right))).toBeGreaterThanOrEqual(100);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(ys(f.top))).toBeLessThan(mean(ys(f.left)));
    expect(mean(ys(f.top))).toBeLessThan(mean(ys(f.right)));
    // 3 面の面積の和 = 外形の六角形の面積（重なりがあれば和の方が大きくなる）
    const hex: Pt[] = [f.left[0]!, f.left[1]!, f.left[2]!, f.top[2]!, f.right[2]!, f.right[1]!];
    expect(area(f.left) + area(f.right) + area(f.top)).toBeCloseTo(area(hex));
  });
});

describe('towerSize / floorOrigin', () => {
  it('階が 1 つ増えると、高さは FLOOR_H ずつ線形に増える。幅は一定', () => {
    for (const n of [1, 10, 50, 120]) {
      expect(towerSize(n + 1).h - towerSize(n).h).toBe(FLOOR_H);
      expect(towerSize(n).w).toBe(CANVAS_W);
    }
  });
  it('0 階は輪郭（3 階ぶん）の高さ。数でない値でも壊れない', () => {
    expect(towerSize(0).h).toBe(canvasHeight(3));
    expect(towerSize(Number.NaN).h).toBe(canvasHeight(3));
    expect(towerSize(2, false).h).toBe(canvasHeight(2));
  });
  it('建物は絵の幅に収まる', () => {
    expect(BODY_W).toBeLessThan(CANVAS_W);
  });
  it('下から順に描くと上の階ほど上（後に描く階が前の階の上面を覆う）', () => {
    const H = towerSize(10).h;
    for (let i = 0; i < 10; i++) {
      expect(floorOrigin(i + 1, H).y).toBe(floorOrigin(i, H).y - FLOOR_H);
    }
    // 最上階の上の旗の先も、絵の中に入る
    const top = roof(floorOrigin(10, H));
    expect(top.flagTop[1]).toBeGreaterThanOrEqual(0);
    expect(floorOrigin(0, H).y).toBeLessThan(H);
    expect(floorOrigin(10, H).y - FLOOR_H - TOP_H).toBeGreaterThanOrEqual(0);
  });
  it('押す範囲は階ごとに重ならず、すき間もない', () => {
    const H = towerSize(5).h;
    for (let i = 0; i < 4; i++) {
      const a = floorHitRect(floorOrigin(i, H));
      const b = floorHitRect(floorOrigin(i + 1, H));
      expect(b.top + b.height).toBe(a.top);
    }
  });
});
