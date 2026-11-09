// 色・大きさ・角の丸みはここ 1 か所だけ。画面のファイルに色の値を直接書かない。
// 配色はキャラ（エビ）の色で統一する（#181・方向 B）: 温かい紙色の地・濃いえんじの文字・珊瑚の主色。
// 金・銀・銅は階の色（変えない）。Duolingo の緑・字形は使わない（owner-choices §5）。
// 文字の色は、置く背景に対してコントラスト 4.5 以上（下の各行の注は WCAG の式で計算した値・
// __tests__/themeColors.test.ts が同じ式で検査する・3 つの組すべて）。
// 配色は 3 つの組（エビ・海・深い海）から設定で選べる（#363）。選んだ組は起動の入口（index.js）が
// 画面より先に決める（lib/palette.ts）。金・銀・銅と塔の絵の色は、どの組でも変えない。

import { paletteFromGlobal, type PaletteName } from './lib/palette';

// 階の色（質の印）。どの組でも同じ
const METAL = {
  gold: '#c8961d',
  goldLip: '#8f6a10',
  goldInk: '#2a1d00', // gold の上で 6.2
  silver: '#8d98a6',
  silverLip: '#636d79',
  silverInk: '#1f2733', // silver の上で 5.1
  bronze: '#a5633a',
  bronzeLip: '#6f4024',
  bronzeInk: '#ffffff', // bronze の上で 4.7
} as const;

export type Palette = {
  bg: string;
  bgFocus: string;
  surface: string;
  surfaceSunk: string;
  text: string;
  muted: string;
  line: string;
  edge: string;
  primary: string;
  primaryLip: string;
  primarySoft: string;
  onPrimary: string;
  shrimp: string;
  danger: string;
  dangerSoft: string;
  // レーダーで重ねる 3 案（A・B・C）。線と面だけに使い、文字には使わない。主色と離れた色相にする
  series: readonly [string, string, string];
  // 友達のイニシャルの丸の地（onPrimary の文字が乗って 4.5 以上）
  avatar: readonly string[];
};

const PRIMARY = '#b83c2a';
const SHRIMP_SERIES = [PRIMARY, '#2b7a78', '#7b4fb3'] as const;

// B エビ（既定・#181 のまま）
const shrimp: Palette = {
  bg: '#fbf6ef', // 温かい紙色
  // 集中の場面の地（紙色を少し深くして、場面が変わったと分かるように・#315）。text に 13.4・muted に 6.5
  bgFocus: '#f1e7e1',
  surface: '#ffffff',
  surfaceSunk: '#f4e9dd',
  text: '#3b1a22', // 濃いえんじ。bg に 14.4・白に 15.5・surfaceSunk に 12.9
  muted: '#6d4c45', // 白に 7.6・bg に 7.0・surfaceSunk に 6.3・primarySoft に 6.2（補助の文字・入力の例・押せない時の文字）
  line: '#ecd9cf', // 区切りと表示だけのカードの細い枠（文字には使わない）
  edge: '#d9bfb2', // 入力欄・札など押せる物の縁（line より濃い）

  // 主色（ボタンの地・選択中・強調の文字）。参考の #cf4a35 は白い文字で 4.5 ちょうどで、
  // 淡い地（primarySoft）の上の文字にも使うため、少し濃くした
  primary: PRIMARY, // 白の文字が乗って 5.6・bg に 5.3・primarySoft の上で 4.6
  primaryLip: '#8c2c1e', // 主ボタンの下の厚み
  primarySoft: '#fde3dc',
  onPrimary: '#ffffff',

  // エビの珊瑚。絵・アイコン・強調の線・ブランドの印だけに使い、文字や文字の地には使わない（白に 3.0）
  shrimp: '#ee6b57',

  // 危険・期限が近い。主色（朱）と見分けがつくよう、青みの深い紅にした
  danger: '#a3123a', // 白に 7.8・bg に 7.2・dangerSoft の上で 6.2
  dangerSoft: '#f8e1df',

  series: SHRIMP_SERIES,
  avatar: [PRIMARY, SHRIMP_SERIES[2], METAL.bronze, METAL.goldLip, METAL.silverLip, SHRIMP_SERIES[1]],
};

// C 海（海の中・明るい）
const SEA_PRIMARY = '#1f6f66';
const SEA_SERIES = [SEA_PRIMARY, '#b8473a', '#7b4fb3'] as const;
const sea: Palette = {
  bg: '#e3f3f0',
  bgFocus: '#d3ebe7',
  surface: '#ffffff',
  surfaceSunk: '#d9eeea',
  text: '#10343a',
  muted: '#3f6b70',
  line: '#cfe5e1',
  edge: '#a9cfca',
  primary: SEA_PRIMARY,
  primaryLip: '#0f4a43',
  primarySoft: '#d5efea',
  onPrimary: '#ffffff',
  shrimp: '#ff6f4f',
  danger: '#a3123a',
  dangerSoft: '#f8e1df',
  series: SEA_SERIES,
  avatar: [SEA_PRIMARY, SEA_SERIES[2], METAL.bronze, METAL.goldLip, METAL.silverLip, SEA_SERIES[1]],
};

// C 深い海（暗い地に明るい文字）。主ボタンの文字は暗い色なので、友達の丸の地は明るい色にする
const DEEP_PRIMARY = '#7fd6c8';
const DEEP_SERIES = [DEEP_PRIMARY, '#ff9f87', '#c7a8f0'] as const;
const deep: Palette = {
  bg: '#0e3d40',
  bgFocus: '#0a2f31',
  surface: '#175457',
  surfaceSunk: '#124649',
  text: '#e6f4f2',
  muted: '#a9cdca',
  line: '#245f62',
  edge: '#3a7f83',
  primary: DEEP_PRIMARY,
  primaryLip: '#3e9c8f',
  primarySoft: '#1b5a5d',
  onPrimary: '#0b3336',
  shrimp: '#ff7a5c',
  danger: '#ffb3c0', // 暗い地で読める淡い紅
  dangerSoft: '#4a2a33',
  series: DEEP_SERIES,
  avatar: [DEEP_PRIMARY, DEEP_SERIES[2], '#e8a57c', '#e2b84f', '#b6bfca', DEEP_SERIES[1]],
};

export const PALETTES: Record<PaletteName, Palette> = { shrimp, sea, deep };

// 起動時に選ばれた組（無い・知らない値は shrimp）
export const paletteName: PaletteName = paletteFromGlobal();
const picked = PALETTES[paletteName];

export const color = {
  bg: picked.bg,
  bgFocus: picked.bgFocus,
  surface: picked.surface,
  surfaceSunk: picked.surfaceSunk,
  text: picked.text,
  muted: picked.muted,
  line: picked.line,
  edge: picked.edge,
  primary: picked.primary,
  primaryLip: picked.primaryLip,
  primarySoft: picked.primarySoft,
  onPrimary: picked.onPrimary,
  shrimp: picked.shrimp,
  danger: picked.danger,
  dangerSoft: picked.dangerSoft,
  ...METAL,
  series: picked.series,
};

export type FloorColor = 'gold' | 'silver' | 'bronze';

export const floorColor: Record<FloorColor, { fill: string; lip: string; ink: string }> = {
  gold: { fill: color.gold, lip: color.goldLip, ink: color.goldInk },
  silver: { fill: color.silver, lip: color.silverLip, ink: color.silverInk },
  bronze: { fill: color.bronze, lip: color.bronzeLip, ink: color.bronzeInk },
};

// 余白は 4 の倍数だけ
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

// 角の丸みは 3 種だけ: 小さな四角い物（box）・カード（card）・丸と札と主ボタン（full・ピル型）
export const radius = { box: 8, card: 16, full: 999 } as const;

// 枠の太さ: 表示だけの物は細く（thin）、押せる物は太く（bold）して見分ける
export const border = { thin: 1.5, bold: 2 } as const;

// 文字は 14 以上。本文は 16
export const font = {
  small: 14,
  body: 16,
  large: 20,
  title: 24,
  code: 32,
  hero: 40,
  clock: 64,
} as const;

// 押せる物の最小の高さ（大きく押しやすく）
export const touch = { min: 48, big: 56 } as const;

// 友達のイニシャルの丸の地の色（選ばれた組から・onPrimary の字が乗って 4.5 以上）
export const avatarColors: readonly string[] = picked.avatar;

// 建物の絵だけに使う色（文字には使わない）
export const towerArt = {
  windowLit: '#fff6d6', // 点いた窓。暗い字（ink）の反対側の淡い色
  windowOff: '#c3cad3', // 消えた窓。薄い灰
  core: '#4a5462', // 板と板のすき間に見える建物の芯（すき間を空にせず 1 棟に見せる）
  seam: 'rgba(23,32,44,0.35)', // 同じ色の階が続く時の継ぎ目の線
  pole: '#5b6676', // 旗竿
  ground: '#8a95a3', // 地面の線
  shadow: 'rgba(23,32,44,0.14)', // 足元の影
  // 見下ろした絵の上面（いちばん明るい）。左の側面は fill、右の側面は lip（#269）
  topGold: '#e2b84f',
  topSilver: '#b6bfca',
  topBronze: '#c88660',
} as const;
