// 配色の組を選ぶ処理（#363）: 保存・読み込み・知らない値の扱い・起動の入口・設定の項目
import {
  DEFAULT_PALETTE,
  PALETTE_GLOBAL,
  PALETTE_KEY,
  PALETTE_NAMES,
  afterPaletteSave,
  loadPalette,
  paletteFromGlobal,
  parsePalette,
  savePalette,
  type PaletteStore,
} from '../lib/palette';
import * as copy from '../lib/copy';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

function memStore(init: Record<string, string> = {}) {
  const data: Record<string, string> = { ...init };
  const store: PaletteStore = {
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => {
      data[k] = v;
    },
  };
  return { data, store };
}

describe('配色の値の扱い', () => {
  test('3 つの組・既定はエビ・キーは moltower.palette', () => {
    expect([...PALETTE_NAMES]).toEqual(['shrimp', 'sea', 'deep']);
    expect(DEFAULT_PALETTE).toBe('shrimp');
    expect(PALETTE_KEY).toBe('moltower.palette');
    expect(PALETTE_GLOBAL).toBe('__MOLT_PALETTE');
  });

  test('知らない値・無い値はエビ', () => {
    expect(parsePalette('sea')).toBe('sea');
    expect(parsePalette('deep')).toBe('deep');
    for (const v of [null, undefined, '', 'ocean', 'SEA', 3, {}, 'toString']) expect(parsePalette(v)).toBe('shrimp');
  });

  test('起動の入口が置いた値を読む', () => {
    expect(paletteFromGlobal({ [PALETTE_GLOBAL]: 'deep' })).toBe('deep');
    expect(paletteFromGlobal({ [PALETTE_GLOBAL]: 'nope' })).toBe('shrimp');
    expect(paletteFromGlobal({})).toBe('shrimp');
    expect(paletteFromGlobal(null)).toBe('shrimp');
  });

  test('保存して読み込む（同期の localStorage 形でもよい）', async () => {
    const { data, store } = memStore();
    expect(await loadPalette(store)).toBe('shrimp');
    expect(await savePalette(store, 'sea')).toBe(true);
    expect(data[PALETTE_KEY]).toBe('sea');
    expect(await loadPalette(store)).toBe('sea');

    const sync: Record<string, string> = {};
    const syncStore: PaletteStore = { getItem: (k) => sync[k] ?? null, setItem: (k, v) => void (sync[k] = v) };
    expect(await savePalette(syncStore, 'deep')).toBe(true);
    expect(await loadPalette(syncStore)).toBe('deep');
  });

  test('知らない値は保存しない。保存先が無い・壊れている時は既定で、落ちない', async () => {
    const { data, store } = memStore({ [PALETTE_KEY]: 'sea' });
    expect(await savePalette(store, 'ocean')).toBe(false);
    expect(data[PALETTE_KEY]).toBe('sea');
    expect(await savePalette(null, 'sea')).toBe(false);
    expect(await loadPalette(null)).toBe('shrimp');
    const broken: PaletteStore = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: async () => {
        throw new Error('x');
      },
    };
    expect(await loadPalette(broken)).toBe('shrimp');
    expect(await savePalette(broken, 'sea')).toBe(false);
    expect(await loadPalette(memStore({ [PALETTE_KEY]: 'bad' }).store)).toBe('shrimp');
  });

  test('保存した後: Web は読み直し、端末は開き直しの 1 行', () => {
    expect(afterPaletteSave('web')).toBe('reload');
    expect(afterPaletteSave('ios')).toBe('restart');
    expect(afterPaletteSave('android')).toBe('restart');
  });
});

describe('起動の入口と設定の項目', () => {
  test('package.json の main は index.js', () => {
    const pkg = JSON.parse(read('..', 'package.json'));
    expect(pkg.main).toBe('index.js');
  });

  test('index.js は保存値を置いてから expo-router を require する（import で先に読まない）', () => {
    const s = read('..', 'index.js');
    expect(s).not.toMatch(/^\s*import\s/m);
    expect(s).toContain("'moltower.palette'");
    expect(s).toContain('globalThis.__MOLT_PALETTE');
    expect(s).toContain('localStorage');
    expect(s).toContain('AsyncStorage');
    // Web: 置いてから本体
    expect(s.indexOf('put(globalThis.localStorage')).toBeLessThan(s.indexOf("require('expo-router/entry')"));
    // 端末: 読み終えてから本体
    expect(s.indexOf('AsyncStorage.getItem(KEY)')).toBeLessThan(s.indexOf("require('expo-router/build/qualified-entry')"));
  });

  test('設定に「配色」: 3 つの選択肢・地/主色/文字の丸・今の組に印・保存・Web は読み直し', () => {
    const s = read('app', 'settings.tsx');
    expect(s).toContain('<Label>{COPY_PALETTE_LABEL}</Label>');
    expect(s).toContain('PALETTE_NAMES.map(');
    expect(s).toContain('[p.bg, p.primary, p.text]');
    expect(s).toContain('accessibilityState={{ selected: on }}');
    expect(s).toContain('savePalette(paletteStore(), name)');
    expect(s).toContain('window.location.reload()');
    expect(s).toContain('COPY_PALETTE_RESTART');
    expect(copy.COPY_PALETTE_LABEL).toBe('配色');
    expect(copy.COPY_PALETTE_NAMES).toEqual({ shrimp: 'エビ', sea: '海', deep: '深い海' });
    expect(copy.COPY_PALETTE_RESTART).toBe('アプリを開き直すと変わります');
  });
});
