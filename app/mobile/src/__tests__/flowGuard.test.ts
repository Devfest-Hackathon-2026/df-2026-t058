import { attachBeforeUnload, flowActive, keepScreenOn, resetResumed, resumePath, takeResume } from '../lib/flowGuard';

describe('flowActive', () => {
  it('進行中の集中 → true', () => expect(flowActive({ activeSession: { id: 's1' }, pendingReflect: null })).toBe(true));
  it('終えた直後（振り返り待ち）→ true', () => expect(flowActive({ activeSession: null, pendingReflect: { id: 's1' } })).toBe(true));
  it('確定後・無し → false', () => {
    expect(flowActive({ activeSession: null, pendingReflect: undefined })).toBe(false);
    expect(flowActive({})).toBe(false);
  });
});

describe('beforeunload', () => {
  function fakeWin() {
    const ls = new Set<(e: any) => void>();
    return {
      ls,
      addEventListener: (_t: 'beforeunload', l: (e: any) => void) => ls.add(l),
      removeEventListener: (_t: 'beforeunload', l: (e: any) => void) => ls.delete(l),
    };
  }
  it('付けると確認を出し、外すと何も残らない', () => {
    const w = fakeWin();
    const off = attachBeforeUnload(w);
    expect(w.ls.size).toBe(1);
    const e = { preventDefault: jest.fn(), returnValue: undefined as unknown };
    [...w.ls][0]?.(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBe('');
    off();
    expect(w.ls.size).toBe(0);
  });
});

describe('wakeLock', () => {
  function fakeDoc() {
    let l: (() => void) | null = null;
    return {
      visibilityState: 'visible',
      addEventListener: (_t: 'visibilitychange', f: () => void) => {
        l = f;
      },
      removeEventListener: () => {
        l = null;
      },
      fire: () => l?.(),
      has: () => l !== null,
    };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('取得し、戻った時に取り直し、解放する', async () => {
    const release = jest.fn(async () => undefined);
    const request = jest.fn(async () => ({ release }));
    const doc = fakeDoc();
    const stop = keepScreenOn({ wakeLock: { request } }, doc);
    await tick();
    expect(request).toHaveBeenCalledWith('screen');
    doc.fire();
    await tick();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    await tick();
    expect(release).toHaveBeenCalled();
    expect(doc.has()).toBe(false);
  });

  it('非対応・失敗は無言で何もしない', async () => {
    expect(() => keepScreenOn(undefined, fakeDoc())()).not.toThrow();
    expect(() => keepScreenOn({}, fakeDoc())()).not.toThrow();
    const stop = keepScreenOn({ wakeLock: { request: async () => Promise.reject(new Error('x')) } }, fakeDoc());
    await tick();
    expect(() => stop()).not.toThrow();
  });
});

describe('続きに入る', () => {
  it('進行中 → 集中、振り返り待ち → 振り返り、無ければ null', () => {
    expect(resumePath({ active: { id: 'a' }, toReflect: [{ id: 'r' }] }, false)).toBe('/focus/a');
    expect(resumePath({ active: null, toReflect: [{ id: 'r' }] }, false)).toBe('/reflect/r');
    expect(resumePath({ active: null, toReflect: [] }, false)).toBeNull();
  });
  it('開いてから 1 回だけ（続きが無くても確認済みにする）', () => {
    resetResumed();
    expect(takeResume({ active: null, toReflect: [] })).toBeNull();
    expect(takeResume({ active: { id: 'a' }, toReflect: [] })).toBeNull();
    resetResumed();
    expect(takeResume({ active: { id: 'a' }, toReflect: [] })).toBe('/focus/a');
    expect(takeResume({ active: { id: 'a' }, toReflect: [] })).toBeNull();
  });
});
