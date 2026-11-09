import type { ReactElement } from 'react';
import { BuildingIcon, ChevronRightIcon, ClipIcon, FriendsIcon, GearIcon, HomeIcon, KeyboardIcon, MicIcon, PlusIcon } from '../components/Icons';
import { voiceLook } from '../components/VoiceButton';
import { color } from '../theme';

const all = { MicIcon, GearIcon, HomeIcon, BuildingIcon, FriendsIcon, PlusIcon, ChevronRightIcon, KeyboardIcon, ClipIcon };

type Props = Record<string, unknown> & { children?: unknown };

function walk(node: unknown, out: Props[] = []): Props[] {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (node && typeof node === 'object' && 'props' in node) {
    const p = (node as ReactElement<Props>).props;
    out.push(p);
    walk(p.children, out);
  }
  return out;
}

describe('線画アイコン', () => {
  for (const [name, Icon] of Object.entries(all)) {
    it(`${name}: 既定値・線だけ・読み上げから隠す`, () => {
      const root = Icon({}) as ReactElement<Props>;
      expect(root.props.width).toBe(24);
      expect(root.props.stroke).toBe(color.text);
      expect(root.props.strokeWidth).toBe(2.25);
      expect(root.props.fill).toBe('none');
      expect(root.props.strokeLinecap).toBe('round');
      expect(root.props.strokeLinejoin).toBe('round');
      expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(walk(root).length).toBeGreaterThan(1);
    });

    it(`${name}: size と color が効く`, () => {
      const root = Icon({ size: 40, color: '#123456', strokeWidth: 3 }) as ReactElement<Props>;
      expect(root.props.width).toBe(40);
      expect(root.props.height).toBe(40);
      expect(root.props.stroke).toBe('#123456');
      expect(root.props.strokeWidth).toBe(3);
    });
  }

  it('歯車の外形は 8 つの歯（全周に等間隔）', () => {
    const d = walk(GearIcon({})).find((p) => typeof p.d === 'string')!.d as string;
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/L/g)).toHaveLength(8 * 4 - 1);
  });
});

describe('声のボタンの見た目', () => {
  it('押す前は薄い青の地に青いマイク', () => {
    expect(voiceLook(false)).toEqual({ circle: { backgroundColor: color.primarySoft }, iconColor: color.primary });
  });
  it('押している間は濃い青の塗りに白いマイク', () => {
    expect(voiceLook(true)).toEqual({ circle: { backgroundColor: color.primary }, iconColor: color.onPrimary });
  });
});
