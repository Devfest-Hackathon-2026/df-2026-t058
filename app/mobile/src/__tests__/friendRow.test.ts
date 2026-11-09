// ホームの一番上の友達の列（11/9 本人）
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
import { blockPaths, unseenFloors } from '../components/FriendRow';

const fs = require('fs');
const path = require('path');
const read = (f: string): string => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('友達の列', () => {
  test('まだ見ていない階だけが落ちてくる', () => {
    const today = [{ id: 's1:0', color: 'gold' as const }, { id: 's2:0', color: 'silver' as const }];
    expect([...unseenFloors(today, new Set(['s1:0']))]).toEqual(['s2:0']);
  });
  test('階は下から上へ積む（上の階ほど y が小さい）', () => {
    const y = (d: string) => Number(d.split(' ')[1]);
    expect(y(blockPaths(1, 3).top)).toBeLessThan(y(blockPaths(0, 3).top));
  });
  test('ホームの一番上に置き、中身・数字は出さない', () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home.indexOf('<FriendRow')).toBeLessThan(home.indexOf('<AgentSays'));
    const row = read('components/FriendRow.tsx');
    expect(row).not.toContain('oneLine');
    expect(row).not.toContain('onPress');
  });
});
