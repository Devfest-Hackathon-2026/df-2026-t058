// レーダーチャートの座標（純粋関数）。軸は上（12 時）から時計回りに等間隔。

export interface Point {
  x: number;
  y: number;
}

export interface RadarGeometry {
  cx: number;
  cy: number;
  radius: number;
  max: number; // 値の上限（契約は 1〜5）
}

// i 番目の軸（n 本中）の角度（ラジアン）。0 本目が真上。
export function axisAngle(i: number, n: number): number {
  return -Math.PI / 2 + (2 * Math.PI * i) / n;
}

// 値 value（0〜max）を i 番目の軸の上の点に。範囲外は端に寄せる。
export function pointFor(i: number, n: number, value: number, g: RadarGeometry): Point {
  const v = Math.min(g.max, Math.max(0, Number.isFinite(value) ? value : 0));
  const r = (v / g.max) * g.radius;
  const a = axisAngle(i, n);
  return { x: round(g.cx + r * Math.cos(a)), y: round(g.cy + r * Math.sin(a)) };
}

// 1 案の多角形（SVG の points 属性の文字列）。軸に値が無ければ 0。
export function polygonPoints(keys: string[], values: Record<string, number>, g: RadarGeometry): string {
  const n = keys.length;
  return keys.map((k, i) => pointFor(i, n, values[k] ?? 0, g)).map((p) => `${p.x},${p.y}`).join(' ');
}

// 目盛りの輪（1〜max の各段）。
export function ringPoints(n: number, level: number, g: RadarGeometry): string {
  return Array.from({ length: n }, (_, i) => pointFor(i, n, level, g))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
}

// 軸の名前を置く位置と、文字の寄せ方。
export function labelFor(i: number, n: number, g: RadarGeometry, gap: number): Point & { anchor: 'start' | 'middle' | 'end' } {
  const a = axisAngle(i, n);
  const r = g.radius + gap;
  const x = round(g.cx + r * Math.cos(a));
  const y = round(g.cy + r * Math.sin(a));
  const c = Math.cos(a);
  const anchor = Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end';
  return { x, y, anchor };
}

const round = (n: number) => Math.round(n * 100) / 100;

// 軸の名前が長い時は 2 行に分ける。「の」「で」の後ろで切れればそこで、無ければ真ん中で。
export function splitLabel(label: string, maxChars = 5): string[] {
  const chars = [...label];
  if (chars.length <= maxChars) return [label];
  const mid = chars.length / 2;
  let best = -1;
  chars.forEach((c, i) => {
    const cut = i + 1;
    if ((c === 'の' || c === 'で') && cut >= 2 && cut <= chars.length - 2) {
      if (best < 0 || Math.abs(cut - mid) < Math.abs(best - mid)) best = cut;
    }
  });
  const at = best > 0 ? best : Math.ceil(mid);
  return [chars.slice(0, at).join(''), chars.slice(at).join('')];
}
