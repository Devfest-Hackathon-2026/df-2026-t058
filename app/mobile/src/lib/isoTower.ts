// 建物を斜め上から見下ろす（等角・仰角 30°）ための計算。純粋な関数だけ（#269）。
// 画面の座標は左上が原点・下が +y。直方体の原点 (x, y) は「手前の縦の辺の下端」。
// 幅 w は左奥へ、奥行 d は右奥へ伸びる。上面の菱形の縦は (w + d) × sin30°。

export const ISO_COS = Math.cos(Math.PI / 6); // 約 0.866
export const ISO_SIN = Math.sin(Math.PI / 6); // 0.5

export const FLOOR_W = 120; // 1 階の幅（左の側面）
export const FLOOR_D = 120; // 1 階の奥行（右の側面）
export const FLOOR_H = 32; // 1 階の高さ。階が 1 つ増えると、絵はこの分だけ高くなる
export const BODY_W = (FLOOR_W + FLOOR_D) * ISO_COS; // 画面上の建物の幅（約 208）
export const TOP_H = (FLOOR_W + FLOOR_D) * ISO_SIN; // 上面の菱形の縦（120）
export const ROOF_RISE = 56; // 屋根（四角すい）の頂点の、上面の中心からの高さ
export const FLAG_RISE = 22; // 屋根の頂点から立つ旗竿
export const GROUND_PAD = 16; // いちばん下の角より下の余白（地面の影）
export const TOP_PAD = 12; // 旗の先より上の余白
export const CANVAS_W = 300; // 絵の幅（建物 + 横に出す日付の文字）
export const OUTLINE_ROWS = 3; // 0 階の時の輪郭の高さ（階の数ぶん）

export type Pt = [number, number];
export type IsoFaces = { top: Pt[]; left: Pt[]; right: Pt[] };

// 直方体の 3 面の頂点。描く順は left → right → top（3 面は辺を共有するだけで重ならない）
export function isoBlock(b: { x: number; y: number; w: number; d: number; h: number }): IsoFaces {
  const { x, y, w, d, h } = b;
  const lx = x - w * ISO_COS;
  const ly = y - w * ISO_SIN;
  const rx = x + d * ISO_COS;
  const ry = y - d * ISO_SIN;
  const bx = lx + d * ISO_COS;
  const by = ly - d * ISO_SIN;
  return {
    left: [[x, y], [lx, ly], [lx, ly - h], [x, y - h]],
    right: [[x, y], [rx, ry], [rx, ry - h], [x, y - h]],
    top: [[x, y - h], [lx, ly - h], [bx, by - h], [rx, ry - h]],
  };
}

// 面の上の点。u は面の横（0〜1、手前の辺から外へ）、v は縦（0〜1、下から上）
export function facePoint(face: Pt[], u: number, v: number): Pt {
  const [p0, p1, , p3] = face as [Pt, Pt, Pt, Pt];
  return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u - (p0[1] - p3[1]) * v];
}

// 面の中の四角（窓など）を、面の斜めに合わせた四角形にする
export function faceQuad(face: Pt[], u0: number, u1: number, v0: number, v1: number): Pt[] {
  return [facePoint(face, u0, v0), facePoint(face, u1, v0), facePoint(face, u1, v1), facePoint(face, u0, v1)];
}

export const points = (ps: Pt[]): string => ps.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
const round = (n: number) => Math.round(n * 10) / 10;

// 積んだ箱 levels 個（階 + 次の階の枠、または輪郭）の絵の高さ。屋根と旗を含む
export function canvasHeight(levels: number): number {
  const n = Math.max(0, Math.floor(Number.isFinite(levels) ? levels : 0));
  const crown = Math.max(TOP_H, TOP_H / 2 + ROOF_RISE + FLAG_RISE);
  return Math.ceil(TOP_PAD + crown + n * FLOOR_H + GROUND_PAD);
}

// 建物の絵の全体の幅・高さ。floors 階、次の階の枠つき（0 階は輪郭の高さ）
export function towerSize(floors: number, slot = true): { w: number; h: number } {
  const n = Math.max(0, Math.floor(Number.isFinite(floors) ? floors : 0));
  const levels = n === 0 && slot ? OUTLINE_ROWS : n + (slot ? 1 : 0);
  return { w: CANVAS_W, h: canvasHeight(levels) };
}

// 下から i 番目（0 から）の箱の原点（手前の縦の辺の下端）。canvasH は絵の高さ
export function floorOrigin(i: number, canvasH: number): { x: number; y: number } {
  return { x: CANVAS_W / 2, y: canvasH - GROUND_PAD - i * FLOOR_H };
}

// 1 階の箱（原点つき）
export const floorBlock = (o: { x: number; y: number }, h = FLOOR_H) =>
  isoBlock({ x: o.x, y: o.y, w: FLOOR_W, d: FLOOR_D, h });

// 屋根（四角すいの手前の 2 面）と旗竿の根元・先。base は屋根を載せる箱の原点
export function roof(base: { x: number; y: number }) {
  const t = floorBlock(base).top as [Pt, Pt, Pt, Pt];
  const cx = (t[1][0] + t[3][0]) / 2;
  const cy = (t[0][1] + t[2][1]) / 2;
  const apex: Pt = [cx, cy - ROOF_RISE];
  return { left: [t[0], t[1], apex], right: [t[0], t[3], apex], apex, flagTop: [cx, apex[1] - FLAG_RISE] as Pt };
}

// 階を押す範囲（四角で近似）。側面の帯の中ほどを、階ごとに重ならない高さ FLOOR_H で取る
export function floorHitRect(o: { x: number; y: number }) {
  return { left: o.x - BODY_W / 2, top: o.y - FLOOR_H - TOP_H / 4, width: BODY_W, height: FLOOR_H };
}
