import { hasPlan, planRatio } from '../lib/planProgress';
import { elapsedMs, pauseClock, resumeClock, startClock } from '../lib/focusClock';

describe('planRatio', () => {
  it('計画の分までの割合を返す', () => {
    expect(planRatio(0, 30)).toBe(0);
    expect(planRatio(15 * 60_000, 30)).toBe(0.5);
    expect(planRatio(30 * 60_000, 30)).toBe(1);
  });

  it('計画の分を超えても 1 のまま', () => {
    expect(planRatio(90 * 60_000, 30)).toBe(1);
  });

  it('計画の分が無い・0・負・数でない時は 0 で壊れない', () => {
    expect(planRatio(10 * 60_000, 0)).toBe(0);
    expect(planRatio(10 * 60_000, -5)).toBe(0);
    expect(planRatio(10 * 60_000, undefined)).toBe(0);
    expect(planRatio(10 * 60_000, null)).toBe(0);
    expect(planRatio(10 * 60_000, NaN)).toBe(0);
  });

  it('経過が負・数でない時は 0', () => {
    expect(planRatio(-1, 30)).toBe(0);
    expect(planRatio(NaN, 30)).toBe(0);
  });

  it('一時停止の間は割合が増えず、戻ると進む（時計と同じ）', () => {
    let c = startClock(0);
    c = pauseClock(c, 10 * 60_000);
    const atPause = planRatio(elapsedMs(c, 10 * 60_000), 30);
    expect(planRatio(elapsedMs(c, 20 * 60_000), 30)).toBe(atPause);
    c = resumeClock(c, 20 * 60_000);
    expect(planRatio(elapsedMs(c, 25 * 60_000), 30)).toBeCloseTo(0.5);
  });

  it('hasPlan', () => {
    expect(hasPlan(30)).toBe(true);
    expect(hasPlan(0)).toBe(false);
    expect(hasPlan(undefined)).toBe(false);
  });
});
