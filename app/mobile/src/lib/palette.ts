// 配色の組（エビ・海・深い海）を選ぶ処理（#363）。保存・読み込み・知らない値の扱いだけの純関数。
// 色の値そのものは theme.ts の PALETTES にある。ここには色を書かない。
// 画面の StyleSheet.create は読み込み時に色を固めるので、選んだ組は起動の入口（app/mobile/index.js）が
// 画面より先に globalThis.__MOLT_PALETTE に置き、theme.ts がそれを読む。変えた後は開き直しで効く。

export const PALETTE_KEY = 'moltower.palette';
export const PALETTE_GLOBAL = '__MOLT_PALETTE';

export const PALETTE_NAMES = ['shrimp', 'sea', 'deep'] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];
export const DEFAULT_PALETTE: PaletteName = 'shrimp';

// 無い・知らない値は既定（エビ）
export function parsePalette(v: unknown): PaletteName {
  return typeof v === 'string' && (PALETTE_NAMES as readonly string[]).includes(v) ? (v as PaletteName) : DEFAULT_PALETTE;
}

// 起動の入口が置いた値を読む（theme.ts が使う）
export function paletteFromGlobal(g: unknown = globalThis): PaletteName {
  if (!g || typeof g !== 'object') return DEFAULT_PALETTE;
  return parsePalette((g as Record<string, unknown>)[PALETTE_GLOBAL]);
}

// 保存先（Web は localStorage、端末は AsyncStorage）。同期でも非同期でもよい
export type PaletteStore = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
};

export async function loadPalette(store: PaletteStore | null): Promise<PaletteName> {
  if (!store) return DEFAULT_PALETTE;
  try {
    return parsePalette(await store.getItem(PALETTE_KEY));
  } catch {
    return DEFAULT_PALETTE;
  }
}

// 保存できたら true。知らない値は保存しない
export async function savePalette(store: PaletteStore | null, name: string): Promise<boolean> {
  if (!store || !(PALETTE_NAMES as readonly string[]).includes(name)) return false;
  try {
    await store.setItem(PALETTE_KEY, name);
    return true;
  } catch {
    return false;
  }
}

// 保存した後: Web はその場で読み直す。端末は「開き直すと変わります」を出す
export function afterPaletteSave(os: string): 'reload' | 'restart' {
  return os === 'web' ? 'reload' : 'restart';
}
