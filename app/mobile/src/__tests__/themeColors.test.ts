// 配色（#181・エビの色で統一）: 文字の色のコントラスト比・主ボタンの白い文字・色の値は theme.ts だけ
import { PALETTES, avatarColors, color, paletteName, radius, type Palette } from '../theme';
import { PALETTE_NAMES } from '../lib/palette';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');

// WCAG 2 の相対輝度とコントラスト比
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// [文字, 地, theme.ts の注に書いた値]
const TEXT_PAIRS: [string, string, string, string, number][] = [
  ['text', 'bg', color.text, color.bg, 14.4],
  ['text', 'surface', color.text, color.surface, 15.5],
  ['text', 'surfaceSunk', color.text, color.surfaceSunk, 12.9],
  ['muted', 'surface', color.muted, color.surface, 7.6],
  ['muted', 'bg', color.muted, color.bg, 7.0],
  ['muted', 'surfaceSunk', color.muted, color.surfaceSunk, 6.3],
  ['muted', 'primarySoft', color.muted, color.primarySoft, 6.2],
  ['onPrimary', 'primary', color.onPrimary, color.primary, 5.6],
  ['primary', 'bg', color.primary, color.bg, 5.3],
  ['primary', 'primarySoft', color.primary, color.primarySoft, 4.6],
  ['danger', 'surface', color.danger, color.surface, 7.8],
  ['danger', 'bg', color.danger, color.bg, 7.2],
  ['danger', 'dangerSoft', color.danger, color.dangerSoft, 6.2],
];

describe('配色のコントラスト（#181）', () => {
  test.each(TEXT_PAIRS)('%s の文字が %s の上で 4.5 以上', (_a, _b, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(TEXT_PAIRS)('%s / %s の注の値が計算と合う（小数 1 桁）', (_a, _b, fg, bg, noted) => {
    expect(Math.abs(contrast(fg, bg) - noted)).toBeLessThan(0.06);
  });

  test('主ボタンの白い文字が主色に対して 4.5 以上', () => {
    expect(color.onPrimary).toBe('#ffffff');
    expect(contrast(color.onPrimary, color.primary)).toBeGreaterThanOrEqual(4.5);
  });

  test('友達のイニシャルの丸は、白い文字が 4.5 以上', () => {
    for (const c of avatarColors) expect([c, contrast('#ffffff', c) >= 4.5]).toEqual([c, true]);
  });

  test('既定の組はエビで、color はその値そのまま', () => {
    expect(paletteName).toBe('shrimp');
    expect(color.bg).toBe(PALETTES.shrimp.bg);
    expect(color.primary).toBe('#b83c2a');
    expect(color.series).toBe(PALETTES.shrimp.series);
  });
});

// 3 つの組すべて（#363）。[文字, 地]
const ALL_PAIRS: [keyof Palette, keyof Palette][] = [
  ['text', 'bg'],
  ['text', 'bgFocus'],
  ['text', 'surface'],
  ['text', 'surfaceSunk'],
  ['muted', 'surface'],
  ['muted', 'bg'],
  ['muted', 'bgFocus'],
  ['muted', 'surfaceSunk'],
  ['muted', 'primarySoft'],
  ['onPrimary', 'primary'],
  ['primary', 'bg'],
  ['primary', 'primarySoft'],
  ['danger', 'surface'],
  ['danger', 'bg'],
  ['danger', 'dangerSoft'],
];
const CASES = PALETTE_NAMES.flatMap((n) => ALL_PAIRS.map(([fg, bg]) => [n, fg, bg] as const));

describe('3 つの配色の組（#363）', () => {
  test('組は shrimp・sea・deep の 3 つ', () => {
    expect(Object.keys(PALETTES).sort()).toEqual(['deep', 'sea', 'shrimp']);
  });

  test.each(CASES)('%s: %s の文字が %s の上で 4.5 以上', (n, fg, bg) => {
    const p = PALETTES[n];
    const c = contrast(p[fg] as string, p[bg] as string);
    expect([n, fg, bg, c >= 4.5 ? 'ok' : c]).toEqual([n, fg, bg, 'ok']);
  });

  test.each([...PALETTE_NAMES])('%s: 友達の丸は onPrimary の字が 4.5 以上', (n) => {
    const p = PALETTES[n];
    expect(p.avatar.length).toBeGreaterThan(1);
    for (const c of p.avatar) expect([c, contrast(p.onPrimary, c) >= 4.5]).toEqual([c, true]);
  });

  test.each([...PALETTE_NAMES])('%s: 主色は series の最初で、危険の色と色相が離れている', (n) => {
    const p = PALETTES[n];
    expect(p.series[0]).toBe(p.primary);
    const diff = Math.abs(hueOf(p.primary) - hueOf(p.danger));
    expect(Math.min(diff, 360 - diff)).toBeGreaterThanOrEqual(15);
  });

  test('金・銀・銅は組に入れない（どの組でも同じ）', () => {
    for (const n of PALETTE_NAMES) {
      expect(Object.keys(PALETTES[n])).not.toContain('gold');
      expect(Object.keys(PALETTES[n])).not.toContain('bronzeInk');
    }
    expect(color.gold).toBe('#c8961d');
  });
});

function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('配色（続き）', () => {

  test('危険の色は主色と見分けがつく（同じ色ではなく、色相が離れている）', () => {
    const hue = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const diff = Math.abs(hue(color.primary) - hue(color.danger));
    expect(Math.min(diff, 360 - diff)).toBeGreaterThanOrEqual(15);
  });

  test('カードの角は 16、主ボタンはピル型（full）', () => {
    expect(radius.card).toBe(16);
    const ui: string = fs.readFileSync(path.join(SRC, 'components', 'ui.tsx'), 'utf8');
    expect(ui).toMatch(/lip: \{ borderRadius: radius\.full/);
    expect(ui).toMatch(/card: \{[^}]*borderRadius: radius\.card/);
  });
});

// src の下の .ts/.tsx を全部（試験は除く）
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir) as string[]) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...walk(full));
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('色の値は theme.ts だけ（#181）', () => {
  // 絵の部品（建物の窓の灯りなど）は例外として許す
  const ALLOWED = [path.join(SRC, 'theme.ts'), path.join(SRC, 'components', 'Tower.tsx')];

  test('theme.ts 以外に # から始まる色の値・rgb() が無い', () => {
    const files = walk(SRC).filter((f) => !ALLOWED.includes(f));
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const f of files) {
      const lines = (fs.readFileSync(f, 'utf8') as string).split('\n');
      lines.forEach((line, i) => {
        // 文字列の中の色だけを見る（Issue 番号の「#181」などは引用符の外なので数えない）
        if (/['"`]#[0-9a-fA-F]{3,8}['"`]/.test(line) || /['"`]rgba?\(/.test(line)) {
          hits.push(`${path.relative(SRC, f)}:${i + 1}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  test('+html.tsx の theme-color は主色の名前を使う', () => {
    const s: string = fs.readFileSync(path.join(SRC, 'app', '+html.tsx'), 'utf8');
    expect(s).toContain('name="theme-color" content={color.primary}');
  });

  test('favicon.svg の地は主色の淡い地、縁は主色', () => {
    const s: string = fs.readFileSync(path.join(SRC, '..', 'public', 'favicon.svg'), 'utf8');
    expect(s).toContain(`fill="${color.primarySoft}"`);
    expect(s).toContain(`stroke="${color.primary}"`);
  });
});

describe('ホームの上の帯のブランドの印（#181）', () => {
  test('SHOW_BRAND_MARK（既定 true）で出し入れし、22px のエビの珊瑚の丸', () => {
    const m = require('../lib/mascot');
    expect(m.SHOW_BRAND_MARK).toBe(true);
    expect(m.BRAND_MARK_SIZE).toBe(22);
  });
  test('ホームの上には印もアプリ名も出さない（#315・11/9 本人「左上のアプリ名はいらない」）', () => {
    const home: string = fs.readFileSync(path.join(SRC, 'app', '(tabs)', 'index.tsx'), 'utf8');
    expect(home).not.toContain('testID="brand-mark"');
    expect(home).not.toContain('testID="home-app-name"');
  });
});
