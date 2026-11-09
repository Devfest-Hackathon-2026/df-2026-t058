// 線画のアイコン部品（react-native-svg だけで描く。外部のアイコン集は使わない）。
// 太めで丸い線・塗りなし。読み上げからは隠す（呼ぶ側のボタンが名前を持つ）。

import type { ReactElement, ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { color } from '../theme';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function frame(p: IconProps, children: ReactNode): ReactElement {
  const size = p.size ?? 24;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={p.color ?? color.text}
      strokeWidth={p.strokeWidth ?? 2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {children}
    </Svg>
  );
}

export function MicIcon(p: IconProps) {
  return frame(
    p,
    <>
      <Rect x={9} y={3} width={6} height={11} rx={3} />
      <Path d="M5 11a7 7 0 0 0 14 0" />
      <Path d="M12 18v3M9 21h6" />
    </>,
  );
}

// 歯 8 つ（45 度ごと・全周に等間隔）の外形＋中央の穴
const TEETH = 8;
function gearPath(): string {
  const pt = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(12 + r * Math.sin(a)).toFixed(2)} ${(12 - r * Math.cos(a)).toFixed(2)}`;
  };
  const step = 360 / TEETH;
  const parts: string[] = [];
  for (let i = 0; i < TEETH; i++) {
    const c = i * step;
    parts.push(`${i === 0 ? 'M' : 'L'}${pt(7, c - 16)}L${pt(9.8, c - 9)}L${pt(9.8, c + 9)}L${pt(7, c + 16)}`);
  }
  return `${parts.join('')}Z`;
}
const GEAR_D = gearPath();

export function GearIcon(p: IconProps) {
  return frame(
    p,
    <>
      <Path d={GEAR_D} />
      <Circle cx={12} cy={12} r={3} />
    </>,
  );
}

export function HomeIcon(p: IconProps) {
  return frame(
    p,
    <>
      <Path d="M3.5 11 12 4l8.5 7" />
      <Path d="M6 9.5V20h12V9.5" />
      <Path d="M10 20v-5h4v5" />
    </>,
  );
}

// 階を重ねた建物（下ほど広い 3 段）
export function BuildingIcon(p: IconProps) {
  return frame(
    p,
    <>
      <Rect x={4} y={15} width={16} height={5} rx={1} />
      <Rect x={6} y={9.5} width={12} height={5.5} rx={1} />
      <Rect x={8} y={4} width={8} height={5.5} rx={1} />
    </>,
  );
}

export function FriendsIcon(p: IconProps) {
  return frame(
    p,
    <>
      <Circle cx={9} cy={8} r={3} />
      <Path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" />
      <Circle cx={17} cy={9} r={2.5} />
      <Path d="M16.5 14.2c2.6 0 4.5 2 4.5 5" />
    </>,
  );
}

export function PlusIcon(p: IconProps) {
  return frame(p, <Path d="M12 5v14M5 12h14" />);
}

export function ChevronRightIcon(p: IconProps) {
  return frame(p, <Path d="M9 5l7 7-7 7" />);
}

// 打ち込む（キーボード）: 下の dock でマイクの左に置く（#315・本人「言葉ではなくアイコンでも」）
export function KeyboardIcon(p: IconProps) {
  return frame(
    p,
    <>
      <Rect x={2.5} y={6} width={19} height={12} rx={2.5} />
      <Path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
    </>,
  );
}

// 見せる（クリップ）: 写真・ファイル・貼る。下の dock でマイクの右に置く
export function ClipIcon(p: IconProps) {
  return frame(p, <Path d="M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />);
}
