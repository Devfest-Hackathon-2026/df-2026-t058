// 最大 3 案を 1 つのレーダーに重ねる。軸の名前はサーバーの axes から。

import Svg, { Line, Polygon, Text as SvgText, TSpan } from 'react-native-svg';
import type { Axis } from '../api/types';
import { labelFor, pointFor, polygonPoints, ringPoints, splitLabel, type RadarGeometry } from '../lib/radar';
import { color } from '../theme';

export interface RadarSeries {
  id: string;
  values: Record<string, number>;
  color: string;
  emphasized: boolean;
}

const W = 320;
const H = 250;
const FONT = 14;
const MAX = 5;

export function RadarChart(props: { axes: Axis[]; series: RadarSeries[] }) {
  const { axes, series } = props;
  const n = axes.length;
  if (n < 3) return null;
  const g: RadarGeometry = { cx: W / 2, cy: 128, radius: 78, max: MAX };
  const keys = axes.map((a) => a.key);
  // 選んだ案を最後に描いて上に出す
  const ordered = [...series].sort((a, b) => Number(a.emphasized) - Number(b.emphasized));

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel="進め方の比較">
      {Array.from({ length: MAX }, (_, i) => (
        <Polygon
          key={`ring-${i}`}
          points={ringPoints(n, i + 1, g)}
          fill="none"
          stroke={color.line}
          strokeWidth={i === MAX - 1 ? 1.5 : 1}
        />
      ))}
      {axes.map((a, i) => {
        const end = pointFor(i, n, MAX, g);
        return <Line key={`axis-${a.key}`} x1={g.cx} y1={g.cy} x2={end.x} y2={end.y} stroke={color.line} strokeWidth={1} />;
      })}
      {ordered.map((s) => (
        <Polygon
          key={s.id}
          points={polygonPoints(keys, s.values, g)}
          fill={s.color}
          fillOpacity={s.emphasized ? 0.28 : 0.06}
          stroke={s.color}
          strokeWidth={s.emphasized ? 3 : 1.5}
          strokeOpacity={s.emphasized ? 1 : 0.55}
          strokeLinejoin="round"
        />
      ))}
      {axes.map((a, i) => {
        const p = labelFor(i, n, g, 12);
        const lines = splitLabel(a.label);
        // 上半分の名前は上へ、下半分は下へ伸ばす
        const below = p.y > g.cy + 1;
        const firstY = below ? p.y + FONT : p.y - (lines.length - 1) * (FONT + 2) + 4;
        return (
          <SvgText key={`label-${a.key}`} textAnchor={p.anchor} fontSize={FONT} fontWeight="700" fill={color.muted}>
            {lines.map((line, j) => (
              <TSpan key={j} x={p.x} y={firstY + j * (FONT + 2)}>
                {line}
              </TSpan>
            ))}
          </SvgText>
        );
      })}
    </Svg>
  );
}
