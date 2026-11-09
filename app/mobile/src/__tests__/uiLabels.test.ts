// 共通部品が、読み上げの名前（accessibilityLabel）を持つことを確かめる。
// 部品は hooks を使わない関数なので、呼んで返る要素の props を見る（描画用の依存は足さない）。

import { helpBarLabel } from '../components/HelpBars';
import { floorLabel } from '../components/Tower';
import { BigButton, Chip, chipWraps, Field, statLabel, TextLink, towerBarCount } from '../components/ui';
import { showDemoSeed } from '../api/demoSeed';
import type { Floor } from '../api/types';
import { radius, touch } from '../theme';

const noop = () => {};

// Field が返す View の 2 番目の子が TextInput
const inputOf = (el: ReturnType<typeof Field>) => (el.props.children as { props: Record<string, unknown> }[])[1]!;

describe('入力欄・図形の読み上げの名前と大きさ', () => {
  it('Field: ラベルがあれば名前になり、無ければ例の文字が名前になる。明示した名前が先', () => {
    expect(inputOf(Field({ label: '目標' })).props.accessibilityLabel).toBe('目標');
    expect(inputOf(Field({ placeholder: '2027-01-31' })).props.accessibilityLabel).toBe('2027-01-31');
    expect(inputOf(Field({ label: '目標', accessibilityLabel: '選んだ理由' })).props.accessibilityLabel).toBe('選んだ理由');
  });

  it('Chip: 押せる高さが 48 以上', () => {
    const el = Chip({ label: 'x', onPress: noop });
    const style = (el.props.style as Record<string, unknown>[]).flat();
    expect(style.some((s) => s && (s as { minHeight?: number }).minHeight === touch.min)).toBe(true);
  });

  it('Tower: 階の名前に日付・色の名前・何階目が入る', () => {
    const f = { id: 'f', color: 'silver', floors: 2, at: new Date(2026, 10, 7, 12).toISOString() } as unknown as Floor;
    expect(floorLabel(f, 1)).toBe('11/7 銀 2 階目');
  });

  it('棒と数字: 回数が文字でも言われる', () => {
    expect(helpBarLabel(2, 1)).toBe('モルティの手助け ヒント 2 やり方 1');
    expect(statLabel('建物', '3', '階')).toBe('建物 3 階');
  });
});

describe('共通部品の読み上げの名前', () => {
  it('Chip: 表示の文字と同じ名前が付き、選ばれていれば selected が真', () => {
    const on = Chip({ label: '1週間', selected: true, onPress: noop });
    expect(on.props.accessibilityLabel).toBe('1週間');
    expect(on.props.accessibilityRole).toBe('button');
    expect(on.props.accessibilityState).toEqual({ selected: true });
    const off = Chip({ label: '30分', onPress: noop });
    expect(off.props.accessibilityLabel).toBe('30分');
    expect(off.props.accessibilityState).toEqual({ selected: false });
  });

  it('Chip: 長い札（複数行）は丸みを小さくし、短い札は丸いまま。名前は文字のまま', () => {
    const long = '英語の面接で自己紹介を 3 分で話せるようになる';
    const flat = (el: ReturnType<typeof Chip>) => (el.props.style as Record<string, unknown>[]).flat().filter(Boolean);
    expect(chipWraps(long)).toBe(true);
    expect(chipWraps('＋')).toBe(false);
    expect(chipWraps('1週間')).toBe(false);
    expect(flat(Chip({ label: long, onPress: noop })).some((s) => (s as { borderRadius?: number }).borderRadius === radius.box)).toBe(true);
    expect(flat(Chip({ label: '1週間', onPress: noop })).some((s) => (s as { borderRadius?: number }).borderRadius === radius.box)).toBe(false);
    expect(Chip({ label: long, onPress: noop }).props.accessibilityLabel).toBe(long);
  });

  it('建物の絵: 棒は階の数だけ、最大 10 本。読み上げの名前は変わらない', () => {
    expect(towerBarCount(0)).toBe(0);
    expect(towerBarCount(3)).toBe(3);
    expect(towerBarCount(25)).toBe(10);
    expect(towerBarCount(-1)).toBe(0);
    expect(statLabel('建物', '25', '階')).toBe('建物 25 階');
  });

  it('見本ボタン: 目標が 0 で、サーバーが許す時だけ出る', () => {
    expect(showDemoSeed({ demoSeed: true }, 0)).toBe(true);
    expect(showDemoSeed({ demoSeed: true }, 1)).toBe(false);
    expect(showDemoSeed({ demoSeed: false }, 0)).toBe(false);
    expect(showDemoSeed(null, 0)).toBe(false);
  });

  it('BigButton: 名前が付く（処理中で文字が消えても）', () => {
    const el = BigButton({ label: '次へ', onPress: noop, busy: true });
    expect(el.props.accessibilityLabel).toBe('次へ');
    expect(el.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it('TextLink: 名前が付く', () => {
    const el = TextLink({ label: '目標を足す', onPress: noop });
    expect(el.props.accessibilityLabel).toBe('目標を足す');
  });
});
