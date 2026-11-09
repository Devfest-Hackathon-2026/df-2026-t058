// 足す画面: 期限の札（読み取れない時に出す）の並びと、場面転換の間
import { ADD_TO_PLAN_MS, DEADLINE_CHIPS } from '../lib/deadlineSpeech';

describe('goal/new 期限の札', () => {
  test('近い順に 3 日〜3 か月', () => {
    const days = DEADLINE_CHIPS.map((c) => c.days);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(days[0]).toBe(3);
    expect(days[days.length - 1]).toBe(90);
  });
  test('場面転換は控えめ（1 秒ほど）', () => {
    expect(ADD_TO_PLAN_MS).toBeGreaterThanOrEqual(600);
    expect(ADD_TO_PLAN_MS).toBeLessThanOrEqual(1200);
  });
});
