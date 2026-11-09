import { ApiError } from '../api/errors';
import { isRunning } from '../lib/focusClock';
import { createFocusTracker, type SavedFocus } from '../lib/focusTracker';

function setup(opts: { saved?: SavedFocus | null; fail?: (type: string, n: number) => unknown } = {}) {
  let t = Date.parse('2026-11-05T01:00:00Z');
  const sent: string[] = [];
  let calls = 0;
  let listener: ((s: string) => void) | null = null;
  const timers: (() => void)[] = [];
  let stored: SavedFocus | null = opts.saved ?? null;
  const appState = {
    currentState: 'active' as string,
    addEventListener: (_: 'change', l: (s: string) => void) => {
      listener = l;
      return { remove: () => (listener = null) };
    },
  };
  const tracker = createFocusTracker({
    sendEvent: async (_id, type) => {
      calls++;
      const err = opts.fail?.(type, calls);
      if (err) throw err;
      sent.push(type);
      return {};
    },
    appState,
    load: async () => stored,
    save: async (v) => {
      stored = v;
    },
    now: () => t,
    schedule: (fn) => {
      timers.push(fn);
    },
  });
  const change = async (s: string) => {
    appState.currentState = s;
    listener?.(s);
    await tracker.flush();
  };
  const advance = (min: number) => {
    t += min * 60_000;
  };
  return {
    tracker,
    sent,
    change,
    advance,
    hasListener: () => listener !== null,
    runTimers: async () => {
      for (const fn of timers.splice(0)) fn();
      await tracker.flush();
    },
    stored: () => stored,
    startedAt: new Date(t).toISOString(),
  };
}

describe('集中の見張り', () => {
  test('集中の画面が無くても、離れた／戻ったを送る。終えたら見張りをやめる', async () => {
    const x = setup();
    x.tracker.begin('s1', x.startedAt);
    await x.change('background');
    await x.change('active');
    expect(x.sent).toEqual(['leave', 'return']);
    x.tracker.finish('s1');
    expect(x.hasListener()).toBe(false);
    expect(x.stored()).toBeNull();
  });

  test('return が通信の失敗で届かなければ、間を空けて送り直す。終える前の flush は false', async () => {
    const x = setup({
      fail: (type, n) => (type === 'return' && n === 2 ? new ApiError(0, 'network', '') : null),
    });
    x.tracker.begin('s1', x.startedAt);
    await x.change('background');
    await x.change('active');
    expect(x.sent).toEqual(['leave']);
    expect(x.tracker.pendingCount()).toBe(1);
    await x.runTimers();
    expect(x.sent).toEqual(['leave', 'return']);
    expect(await x.tracker.flush()).toBe(true);
  });

  test('409 は送り直さずに捨てる', async () => {
    const x = setup({ fail: () => new ApiError(409, 'conflict', '') });
    x.tracker.begin('s1', x.startedAt);
    await x.change('background');
    expect(x.tracker.pendingCount()).toBe(0);
    expect(await x.tracker.flush()).toBe(true);
  });

  test('離れたまま落ちた後に開き直すと、return を 1 回送り、離れていた分を時計に入れない', async () => {
    const first = setup();
    first.tracker.begin('s1', first.startedAt);
    first.advance(10);
    await first.change('background');
    const saved = first.stored();
    expect(saved?.away).toBe(true);

    // 起動し直した（メモリは空・端末の覚えだけが残る）
    const x = setup({ saved });
    x.advance(40); // 落ちていた間
    const clock = await x.tracker.track('s1', x.startedAt);
    await x.tracker.flush();
    expect(x.sent).toEqual(['return']);
    expect(isRunning(clock)).toBe(true);
    expect(clock.accumulatedMs).toBe(10 * 60_000);
  });

  test('覚えがメモリにある時は、開き直しても return を送らない', async () => {
    const x = setup();
    x.tracker.begin('s1', x.startedAt);
    await x.tracker.track('s1', x.startedAt);
    await x.tracker.flush();
    expect(x.sent).toEqual([]);
  });
});
