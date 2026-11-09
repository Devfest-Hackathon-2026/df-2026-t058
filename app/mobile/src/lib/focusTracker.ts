// 集中中の時計と「離れた／戻った」の送信（純粋な組み立て部分。試験はここを使う）。
// - AppState の見張りは画面の外（ここ）に置く。集中の画面を閉じても、集中が終わるまで leave/return を送る。
// - 送れなかったイベントは列に残し、少し間を空けて送り直す。409（もう離れている／離れていない／終わった）は捨てる。
// - 時計と「いま離れているか」は端末に書く。起動し直しても、離れていた分を時計に入れない。
// 時計は表示用。正しい時間はサーバーがイベントの時刻から決める（P3）。

import { ApiError } from '../api/errors';
import { elapsedMs, pauseClock, resumeClock, startClock, type ClockState } from './focusClock';

export type FocusEventType = 'leave' | 'return';

export interface SavedFocus {
  sessionId: string;
  clock: ClockState;
  away: boolean;
}

export interface TrackerDeps {
  sendEvent: (sessionId: string, type: FocusEventType) => Promise<unknown>;
  appState: {
    currentState?: string | null;
    addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
  };
  load: () => Promise<SavedFocus | null>;
  save: (v: SavedFocus | null) => Promise<void>;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void;
}

export type ClockListener = (clock: ClockState, kind: FocusEventType) => void;

const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 30000;

// 通信の失敗・サーバーの一時的な失敗だけ送り直す。4xx（409 を含む）は送り直しても通らない。
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.code === 'network' || e.status === 0 || e.status === 429 || e.status >= 500;
}

export function createFocusTracker(deps: TrackerDeps) {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));

  let cur: SavedFocus | null = null;
  let sub: { remove(): void } | null = null;
  const listeners = new Set<ClockListener>();
  const pending: { sessionId: string; type: FocusEventType }[] = [];
  let draining: Promise<void> | null = null;
  let retryMs = 0;
  let retryWaiting = false;

  const persist = () => {
    deps.save(cur).catch(() => undefined);
  };

  const emit = (kind: FocusEventType) => {
    if (!cur) return;
    for (const l of listeners) l(cur.clock, kind);
  };

  function scheduleRetry() {
    if (retryWaiting) return;
    retryMs = Math.min(RETRY_MAX_MS, retryMs > 0 ? retryMs * 2 : RETRY_FIRST_MS);
    retryWaiting = true;
    schedule(() => {
      retryWaiting = false;
      void drain();
    }, retryMs);
  }

  // 列の先頭から順に送る（leave の後に return の順を守る）。
  function drain(): Promise<void> {
    if (draining) return draining;
    draining = (async () => {
      while (pending.length > 0) {
        const ev = pending[0]!;
        try {
          await deps.sendEvent(ev.sessionId, ev.type);
        } catch (e) {
          if (isRetryable(e)) {
            scheduleRetry();
            return;
          }
          // 409 など: サーバーの記録はもうその状態。捨てて次へ
        }
        pending.shift();
        retryMs = 0;
      }
    })().finally(() => {
      draining = null;
    });
    return draining;
  }

  function enqueue(sessionId: string, type: FocusEventType) {
    pending.push({ sessionId, type });
    void drain();
  }

  function leave() {
    if (!cur || cur.away) return;
    cur = { ...cur, away: true, clock: pauseClock(cur.clock, now()) };
    persist();
    enqueue(cur.sessionId, 'leave');
    emit('leave');
  }

  function back() {
    if (!cur || !cur.away) return;
    cur = { ...cur, away: false, clock: resumeClock(cur.clock, now()) };
    persist();
    enqueue(cur.sessionId, 'return');
    emit('return');
  }

  function onAppState(state: string) {
    if (!cur) return;
    if (state === 'active') {
      back();
      void drain(); // 戻った時は送り残しも送ってみる
    } else {
      leave();
    }
  }

  function watch() {
    if (!sub) sub = deps.appState.addEventListener('change', onAppState);
  }

  function stopWatching() {
    sub?.remove();
    sub = null;
  }

  return {
    // 集中を始めた直後に呼ぶ（始める画面）。新しい集中なので return は送らない。
    begin(sessionId: string, startedAtIso: string): ClockState {
      const t = now();
      const already = Math.max(0, t - Date.parse(startedAtIso));
      cur = { sessionId, clock: startClock(t, Number.isFinite(already) ? already : 0), away: false };
      persist();
      watch();
      return cur.clock;
    },

    // 進行中の集中を見張る（集中の画面・ホーム）。メモリに無い＝起動し直した時は、端末の覚えから時計を戻し、
    // return を 1 回送る（サーバーが leave だけ持っている場合に備える。409 は捨てる）。
    async track(sessionId: string, startedAtIso: string): Promise<ClockState> {
      if (cur?.sessionId === sessionId) {
        watch();
        return cur.clock;
      }
      const saved = await deps.load().catch(() => null);
      if (cur?.sessionId === sessionId) {
        watch();
        return cur.clock;
      }
      const t = now();
      if (saved && saved.sessionId === sessionId) {
        // 離れたまま落ちた時は、離れていた分を入れずに続きから
        cur = { sessionId, clock: resumeClock(saved.clock, t), away: false };
      } else {
        // 覚えが無い: 始めた時刻からの経過で作る（止まっていた分は分からない）
        const already = Math.max(0, t - Date.parse(startedAtIso));
        cur = { sessionId, clock: startClock(t, Number.isFinite(already) ? already : 0), away: false };
      }
      persist();
      watch();
      enqueue(sessionId, 'return');
      if (deps.appState.currentState && deps.appState.currentState !== 'active') leave();
      return cur.clock;
    },

    clockOf(sessionId: string): ClockState | null {
      return cur?.sessionId === sessionId ? cur.clock : null;
    },

    subscribe(l: ClockListener): () => void {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },

    // 終える前に送り残しを送る。全部送れたら true。
    async flush(): Promise<boolean> {
      await drain();
      return pending.length === 0;
    },

    // 集中を終えた後。見張りをやめ、端末の覚えを消す。
    finish(sessionId: string): number {
      const ms = cur?.sessionId === sessionId ? elapsedMs(cur.clock, now()) : 0;
      if (cur?.sessionId === sessionId) {
        cur = null;
        persist();
        stopWatching();
      }
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.sessionId === sessionId) pending.splice(i, 1);
      return ms;
    },

    pendingCount: () => pending.length,
  };
}

export type FocusTracker = ReturnType<typeof createFocusTracker>;
