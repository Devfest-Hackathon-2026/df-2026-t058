// 集中の時計（表示用・純粋関数）。正しい作業時間はサーバーがイベントから決める。
// 離れている間は止まり（⏸）、戻ると続きから進む（▶）。

export interface ClockState {
  accumulatedMs: number; // 止まるまでに進んだ分
  runningSince: number | null; // 動いている時は動き出した時刻。止まっている時は null
}

export const startClock = (now: number, alreadyMs = 0): ClockState => ({
  accumulatedMs: Math.max(0, alreadyMs),
  runningSince: now,
});

export function pauseClock(s: ClockState, now: number): ClockState {
  if (s.runningSince === null) return s;
  return { accumulatedMs: s.accumulatedMs + Math.max(0, now - s.runningSince), runningSince: null };
}

export function resumeClock(s: ClockState, now: number): ClockState {
  if (s.runningSince !== null) return s;
  return { accumulatedMs: s.accumulatedMs, runningSince: now };
}

export function elapsedMs(s: ClockState, now: number): number {
  return s.accumulatedMs + (s.runningSince === null ? 0 : Math.max(0, now - s.runningSince));
}

export const isRunning = (s: ClockState) => s.runningSince !== null;

// 21:12 のような「分:秒」。1 時間を超えたら「時:分:秒」。
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
