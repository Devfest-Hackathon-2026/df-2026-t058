// 友達の一覧の「◯階・◯日」（#230）。0 は出さない・承認済みの友達だけ・順位で並べ替えない
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { createMockApi } from '../api/mock';
import { friendStatsText } from '../lib/copy';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, p), 'utf8');

describe('友達の階数と連続日数', () => {
  it('短い 1 行。0 の項目は出さない・両方 0 なら空・値が無い時も空', () => {
    expect(friendStatsText(12, 4)).toBe('12階・4日');
    expect(friendStatsText(0, 4)).toBe('4日');
    expect(friendStatsText(3, 0)).toBe('3階');
    expect(friendStatsText(0, 0)).toBe('');
    expect(friendStatsText(undefined, undefined)).toBe('');
  });

  it('mock: 承認済みの友達だけ値が入り、申請中は 0', async () => {
    const api = createMockApi({ now: () => Date.parse('2026-11-06T12:00:00.000Z'), aiDelayMs: 0 });
    const { friends } = await api.friends();
    for (const f of friends) {
      expect(typeof f.floors).toBe('number');
      expect(typeof f.streak).toBe('number');
      if (f.friendship.status !== 'accepted') {
        expect(f.floors).toBe(0);
        expect(f.streak).toBe(0);
      }
    }
    const accepted = friends.find((f) => f.friendship.status === 'accepted');
    expect((accepted?.floors ?? 0) > 0).toBe(true);
  });

  it('画面: 各行の右に出し、並べ替えない', () => {
    const src = read('../app/(tabs)/friends.tsx');
    const at = src.indexOf('function Person(', 0);
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf('friendStatsText(f.floors, f.streak)', at)).toBeGreaterThan(at);
    expect(src.indexOf('testID="friend-stats"', at)).toBeGreaterThan(at);
    expect(src).not.toContain('.floors -');
    expect(src).not.toContain('.streak -');
  });
});
