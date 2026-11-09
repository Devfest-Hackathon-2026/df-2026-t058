// 「階が積み上がる」画面の縦の割り付け。画面の高さから、建物に出す階数と、
// 「+1 階」の文字・次の階の枠・いちばん上の板の位置（上からの px）を出す。
// 文字は建物の上に置き、落ちてくる途中の板（上へ DROP_PX ずれる）とも重ならないように階数を決める。

import { canvasHeight, CANVAS_W, FLAG_RISE, FLOOR_H, GROUND_PAD, OUTLINE_ROWS, TOP_PAD } from './isoTower';

// 建物は斜め上から見下ろす絵（lib/isoTower）。階 1 つで FLOOR_H だけ高くなる（#269）
export const BLOCK_H = FLOOR_H; // 1 階の高さ（側面の縦）
export const ROW_H = FLOOR_H; // 階が 1 つ増えた時に絵が高くなる分
export const DROP_PX = 60; // 新しい階が落ち始める高さ（Tower の translateY と同じ）
export const TEXT_H = 48; // 「+1 階」の文字の行の高さ（font.hero 40 の 1.2 倍）
export const MIN_BLOCKS = 4;
export const MAX_BLOCKS = 12;
// いちばん上の箱の手前の角より上: 上面の菱形・屋根（四角すい）・旗の分
export const CROWN_H = canvasHeight(0) - TOP_PAD - GROUND_PAD;
export const FLAG_H = FLAG_RISE; // 屋根の頂上から立つ旗竿の高さ
export const ROOF_H = CROWN_H - FLAG_H; // 上面と屋根の分
export const GROUND_H = GROUND_PAD; // いちばん下の角より下の地面の影

// 文字より上: 画面の見出し（端末の上の帯を含む。多めに見る）+ 本文の上の余白
const TOP_PX = 96 + 16;
// 文字と建物の間: 本文の要素の間のすき間
const GAP_PX = 16;
// 建物より下: 地面（線と影）+ 地面の下の余白 24 + 下のボタンの帯（約 88）+ 端末の下の帯（多めに 20）
const BOTTOM_PX = GROUND_H + 24 + 88 + 20;
// 建物の上の余白（旗の先より上）
const TOWER_PAD_PX = TOP_PAD;

export type BuildFit = {
  maxBlocks: number;
  textTop: number;
  textBottom: number;
  crownTop: number; // 屋根と旗の上端（次の階の枠を出す時は、枠の上に乗る）
  slotTop: number; // 次の階の破線の枠の上端
  topBlockTop: number; // いちばん上の板の上端（落ち終わった位置）
};

export function buildFit(screenHeight: number, blockCount: number = MAX_BLOCKS): BuildFit {
  const h = Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 0;
  const room = h - TOP_PX - TEXT_H - GAP_PX - DROP_PX - TOWER_PAD_PX - CROWN_H - ROW_H - BOTTOM_PX;
  const fit = Math.floor(room / ROW_H);
  const maxBlocks = Math.min(MAX_BLOCKS, Math.max(MIN_BLOCKS, fit));
  const n = Math.min(maxBlocks, Math.max(0, Math.floor(blockCount)));
  const textTop = TOP_PX;
  const textBottom = TOP_PX + TEXT_H;
  // 建物は地面に立てる（下から積む）
  const topBlockTop = h - BOTTOM_PX - n * ROW_H;
  const slotTop = topBlockTop - ROW_H;
  const crownTop = slotTop - CROWN_H;
  return { maxBlocks, textTop, textBottom, crownTop, slotTop, topBlockTop };
}

// ---- 建物の絵の決まり（Tower が使う。乱数を使わず、同じ階は何度描いても同じ）----

export const WINDOWS = 4; // 1 階の窓の数

// 窓の灯り。floorNo は建物の下から数えた階の番号（1 から）。
// 1〜15 の 4 ビットの模様にするので、4 つのうち必ず 1〜4 つが点く。
export function windowsLit(floorNo: number): boolean[] {
  const n = Number.isFinite(floorNo) ? Math.abs(Math.floor(floorNo)) : 0;
  const mask = ((n * 7 + 3) % 15) + 1;
  return Array.from({ length: WINDOWS }, (_, w) => ((mask >> w) & 1) === 1);
}

// 窓の明かり＝階の色（決定 11/9）。銅 1・銀 2・金 4（金は全部灯る）。順位も減点も作らない（P4・P7）。
// どの窓が灯るかは seed（階の id と、同じ集中の何個目の階か）から決まる。同じ seed なら毎回同じ。
export function litByColor(color: string | undefined | null): number {
  if (color === 'gold') return WINDOWS;
  if (color === 'silver') return 2;
  if (color === 'bronze') return 1;
  return 0;
}
function seedToInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function windowsByColor(seed: string, color: string | undefined | null): boolean[] {
  const count = litByColor(color);
  // 決まった乱数（mulberry32）で 4 つの窓の順を並べ替え、先頭から count 個を灯す
  let a = seedToInt(seed);
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: WINDOWS }, (_, w) => w);
  for (let k = WINDOWS - 1; k > 0; k--) {
    const r = Math.floor(rand() * (k + 1));
    const tmp = order[k] as number;
    order[k] = order[r] as number;
    order[r] = tmp;
  }
  const lit = Array.from({ length: WINDOWS }, () => false);
  for (let k = 0; k < count; k++) lit[order[k] as number] = true;
  return lit;
}

// 継ぎ目の線。下から並べた色の列で、i 番目の階の下が同じ色の階なら true（いちばん下は false）
export function seamBelow(colors: readonly string[], i: number): boolean {
  return i > 0 && i < colors.length && colors[i] === colors[i - 1];
}

// 屋根と旗の色は最上階（列の最後）の色。階が無い時は null
export function crownColor<T>(colors: readonly T[]): T | null {
  return colors.at(-1) ?? null;
}

// ---- 建物の画面の縮尺（tower 画面が使う）----

export const MIN_SCALE = 0.4; // これより小さくしない。階が多い時は、上から数えて直近の階だけを出す
export const CARD_H = 230; // 詳しい札の高さの見積もり
const TOWER_TOP_PAD = TOP_PAD; // 旗の先より上の余白
// 画面の見出し（合計・色ごとの数の 2 行）+ 上の帯 + 下のタブ + 余白
const TOWER_CHROME_PX = 96 + 80 + 16 + 88 + 20;

// 建物（Tower）の縦の見積もり。n 階、次の階の枠つき
export function towerHeight(n: number, withSlot = true): number {
  return canvasHeight(Math.max(0, Math.floor(n)) + (withSlot ? 1 : 0));
}

export type TowerScale = { scale: number; maxBlocks: number; height: number };

// 全体が 1 画面の高さに収まる縮尺。入りきらない（MIN_SCALE でも超える）時は、直近の階だけ出す
export function towerScale(screenHeight: number, blockCount: number): TowerScale {
  const h = Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 0;
  return fitScale(Math.max(1, h - TOWER_CHROME_PX), blockCount, MIN_SCALE, 1);
}

function fitScale(avail: number, blockCount: number, minScale: number, maxScale: number): TowerScale {
  const n = Math.max(0, Math.floor(blockCount));
  const lo = Math.min(minScale, maxScale);
  const raw = avail / (n === 0 ? emptyTowerHeight() : towerHeight(n));
  const scale = Math.min(maxScale, Math.max(lo, raw));
  let maxBlocks = n;
  if (raw < lo) {
    const fixed = towerHeight(0);
    maxBlocks = Math.max(1, Math.floor((avail / lo - fixed) / ROW_H));
  }
  const shown = Math.min(n, maxBlocks);
  return { scale, maxBlocks, height: (shown === 0 ? emptyTowerHeight() : towerHeight(shown)) * scale };
}

// ---- 0 階の建物（輪郭の絵）----

export { OUTLINE_ROWS }; // 輪郭の絵の胴の高さ（階の数ぶん）

// 0 階の時の建物の縦（屋根と胴の輪郭 + 地面）
export function emptyTowerHeight(): number {
  return canvasHeight(OUTLINE_ROWS);
}

// 輪郭の絵を出すか: 0 階で、次の階の枠を出す画面で、今回の集中の端数（塗り）が無い時。
// 塗りがある時（振り返りで 0 階だった直後）は、塗りが見える枠を出す。
export function showOutline(nextSlot: boolean | undefined, blockCount: number, fill: number): boolean {
  return nextSlot === true && blockCount <= 0 && !(fill > 0);
}

// ---- PC 幅の建物の画面（建物を高さいっぱいに大きく、札は右に固定）----

export const WIDE_MIN_WIDTH = 900; // 左のレールと同じ幅で切り替える
export const WIDE_MAX_W = 1120; // 本文の最大幅（2 列）
export const WIDE_CARD_W = 360; // 右の札の列の幅
export const WIDE_GAP = 24; // 列の間
export const WIDE_PAD = 16; // 本文の外側の余白
export const WIDE_MIN_SCALE = 0.7;
export const WIDE_MAX_SCALE = 2;
const WIDE_RAIL_W = 88; // 左のレール（navLayout の RAIL_WIDTH と同じ）
const ART_W = CANVAS_W; // 建物の絵の幅（日付の文字を含む）
// 上の帯 + 上下の余白
const WIDE_CHROME_PX = 96 + 2 * WIDE_PAD + 16;

export function isWideTower(width: number): boolean {
  return Number.isFinite(width) && width >= WIDE_MIN_WIDTH;
}

// 左の列（建物）の幅
export function wideTowerColumn(screenWidth: number): number {
  const w = Number.isFinite(screenWidth) ? screenWidth : 0;
  const content = Math.min(w - WIDE_RAIL_W, WIDE_MAX_W) - 2 * WIDE_PAD;
  return Math.max(1, content - WIDE_CARD_W - WIDE_GAP);
}

// PC 幅: 高さいっぱいに大きく（等倍を超えてよい）。幅は左の列に収める
export function wideTowerScale(screenWidth: number, screenHeight: number, blockCount: number): TowerScale {
  const h = Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 0;
  const cap = Math.min(WIDE_MAX_SCALE, wideTowerColumn(screenWidth) / ART_W);
  return fitScale(Math.max(1, h - WIDE_CHROME_PX), blockCount, WIDE_MIN_SCALE, cap);
}

// 拡大した時の縮尺（全体の縮尺の 2 倍。1 を超えない）
export function zoomScale(fit: number): number {
  return Math.min(1, fit * 2);
}

// 押した階（下から shownIndex 番目・0 から。shown 階のうち）のすぐ下に出す札の上端（縮尺後の px）。
// 建物の高さの中に収める。収まらない時は 0。
export function cardTop(shownIndex: number, shown: number, scale: number, containerH: number): number {
  const blockTop = TOWER_TOP_PAD + CROWN_H + ROW_H + (shown - 1 - shownIndex) * ROW_H;
  const below = (blockTop + ROW_H) * scale;
  return Math.max(0, Math.min(below, containerH - CARD_H));
}
