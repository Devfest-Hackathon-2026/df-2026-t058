import { elapsedMs, formatClock, isRunning, pauseClock, resumeClock, startClock } from '../lib/focusClock';

describe('集中の時計', () => {
  test('動いている間だけ進む', () => {
    let c = startClock(0);
    expect(elapsedMs(c, 60_000)).toBe(60_000);
    c = pauseClock(c, 60_000);
    expect(isRunning(c)).toBe(false);
    expect(elapsedMs(c, 600_000)).toBe(60_000); // 離れている間は止まる
    c = resumeClock(c, 600_000);
    expect(isRunning(c)).toBe(true);
    expect(elapsedMs(c, 630_000)).toBe(90_000); // 続きから進む
  });

  test('二重に止めても二重に動かしても変わらない', () => {
    let c = startClock(0);
    c = pauseClock(c, 10_000);
    const again = pauseClock(c, 50_000);
    expect(again).toBe(c);
    c = resumeClock(c, 20_000);
    const twice = resumeClock(c, 40_000);
    expect(twice).toBe(c);
    expect(elapsedMs(c, 30_000)).toBe(20_000);
  });

  test('途中から始める（開き直した時）', () => {
    const c = startClock(1_000, 5 * 60_000);
    expect(elapsedMs(c, 1_000)).toBe(300_000);
  });

  test('時計が戻っても負にならない', () => {
    const c = startClock(10_000);
    expect(elapsedMs(c, 5_000)).toBe(0);
    expect(pauseClock(c, 5_000).accumulatedMs).toBe(0);
  });

  test('表示の形', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock((21 * 60 + 12) * 1000)).toBe('21:12');
    expect(formatClock((3600 + 5 * 60 + 9) * 1000)).toBe('1:05:09');
    expect(formatClock(-5)).toBe('0:00');
  });
});
