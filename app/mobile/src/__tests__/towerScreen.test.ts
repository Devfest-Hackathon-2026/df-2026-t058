// 建物の画面の原稿の検査（#157）: PC 幅は札を右の列に固定・読み込み中は骨組み・0 階は輪郭の絵
import type { Floor } from '../api/types';
import { FloorArt, floorLabel } from '../components/Tower';
import { canvasHeight, towerSize } from '../lib/isoTower';
import { latestScrollY, towerNeedsScroll } from '../lib/towerView';

declare const require: (name: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, p), 'utf8');

describe('建物の画面', () => {
  const screen = read('../app/(tabs)/tower.tsx');
  test('PC 幅では右の列に札を出し、建物に重ねない', () => {
    expect(screen).toContain('isWideTower(screenW)');
    expect(screen).toContain('wideTowerScale(');
    expect(screen).toContain('recordCard && !wide');
    expect(screen).toMatch(/styles\.wideSide[\s\S]*recordCard/);
  });
  test('読み込み中は骨組みを出す', () => {
    expect(screen).toContain("from '../../components/State'");
    expect(screen).toContain('!data && !error');
    expect(screen).toContain('<Skeleton');
  });
  test('建物の高さは towerSize で割り付ける（0 階は輪郭の高さ）', () => {
    expect(screen).toContain('towerSize(shown).h');
  });
  test('縦にスクロールでき、PC 幅でも建物の列が独立してスクロールする（#269）', () => {
    expect(screen).toContain('<ScrollView');
    expect(screen).toContain('<Screen scroll={false}>');
    const wide = screen.indexOf('styles.wideTower}>');
    expect(wide).toBeGreaterThan(0);
    expect(screen.indexOf('scroller(measured, true)', wide)).toBeGreaterThan(wide);
  });
  test('開いた時は最上階（最新）が見える位置。地面・最新へのボタンはスクロールが要る時だけ', () => {
    expect(screen).toContain('toLatest(false)');
    expect(screen).toContain('placed.current = true');
    expect(screen).not.toContain('scrollToEnd({ animated: false })');
    expect(screen).toContain('const jump = needScroll ?');
    expect(screen).toContain('scrollToEnd({ animated: true })');
    expect(screen).toContain('↓ 地面まで');
    expect(screen).toContain('↑ 最新へ');
  });
});

describe('スクロールの計算（towerView）', () => {
  test('中身が見える高さを超える時だけスクロールが要る', () => {
    expect(towerNeedsScroll(500, 600)).toBe(false);
    expect(towerNeedsScroll(601, 600)).toBe(false);
    expect(towerNeedsScroll(900, 600)).toBe(true);
    expect(towerNeedsScroll(900, 0)).toBe(false);
  });
  test('最新の位置: 上で見えるなら 0、建物が下にあればその分下げる', () => {
    expect(latestScrollY(0, 1, 2000)).toBe(0);
    const y = latestScrollY(400, 1, 600);
    expect(y).toBeGreaterThan(0);
    expect(latestScrollY(800, 1, 600) - y).toBe(400);
  });
});

describe('建物の部品（Tower）', () => {
  type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
  const kids = (el: El): El[] => ([] as unknown[]).concat(el.props.children ?? []).flat().filter(Boolean) as El[];
  test('1 階は 3 面（左・右・上）の多角形と、左右の側面の窓 4 つ', () => {
    const svg = FloorArt({ c: 'gold', lit: [true, false, true, true] }) as unknown as El;
    const [faces, ...windows] = kids(svg) as [El, ...El[]];
    const g: El = (faces.type as (p: unknown) => El)(faces.props);
    expect(kids(g)).toHaveLength(3);
    expect(windows).toHaveLength(4);
  });
  test('下の方の階（窓を間引く）は 3 面だけ', () => {
    const svg = FloorArt({ c: 'silver', lit: [true, true, true, true], windows: false }) as unknown as El;
    expect(kids(svg)).toHaveLength(1);
  });
  test('絵の高さは階の数に応じて増える（次の階の枠つき）', () => {
    expect(towerSize(10).h).toBe(canvasHeight(11));
    expect(towerSize(50).h - towerSize(10).h).toBe(40 * 32);
  });
  test('読み上げの名前は今のまま', () => {
    const f = { id: 'f', color: 'bronze', floors: 1, at: new Date(2026, 10, 8, 9).toISOString() } as unknown as Floor;
    expect(floorLabel(f, 0)).toBe('11/8 銅 1 階目');
  });
});

describe('建物の絵（Tower）', () => {
  const tower = read('../components/Tower.tsx');
  test('0 階は輪郭の絵（屋根と胴）を出す', () => {
    expect(tower).toContain('showOutline(nextSlot, shown.length, fill)');
    expect(tower).toContain('testID="tower-outline"');
    expect(tower).toContain('strokeDasharray');
  });
  test('見下ろした絵: 依存を足さず react-native-svg だけで描き、落ちる動きは「動きを減らす」で止める', () => {
    expect(tower).toContain("from 'react-native-svg'");
    expect(tower).toContain("from '../lib/isoTower'");
    expect(tower).toContain('useReduceMotion()');
    expect(tower).toContain('outputRange: [-DROP_PX, 0]');
  });
});
