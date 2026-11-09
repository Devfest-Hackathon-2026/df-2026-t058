// 集中 → 振り返りの確定までは、アプリを閉じにくくする（Web でできる範囲）。
// ①閉じる・離れる時の確認（beforeunload） ②画面を暗くしない（wakeLock） ③戻ってきたら流れの続きへ。
// 判断と付け外しは、画面から切り出して試験する（window などは引数で渡す）。
import { useEffect } from 'react';
import { Platform } from 'react-native';

// 流れの途中か: 進行中の集中がある、または、終えたが振り返りが確定していない
export function flowActive(s: { activeSession?: unknown; pendingReflect?: unknown }): boolean {
  return !!s.activeSession || !!s.pendingReflect;
}

// アプリを開いた直後の続き: 進行中の集中 → 振り返り待ち、の順。開いてから 1 回だけ（alreadyResumed）
export function resumePath(
  data: { active?: { id: string } | null; toReflect?: { id: string }[] | null },
  alreadyResumed: boolean,
): string | null {
  if (alreadyResumed) return null;
  if (data.active) return `/focus/${data.active.id}`;
  const pending = data.toReflect?.[0];
  return pending ? `/reflect/${pending.id}` : null;
}

let resumed = false;
// ホームが最初に読めた時に 1 回だけ呼ぶ。続きが無くても「確認済み」にする（あとで振り返るで戻った時に、また引き戻さない）
export function takeResume(data: Parameters<typeof resumePath>[0]): string | null {
  const p = resumePath(data, resumed);
  resumed = true;
  return p;
}
export function resetResumed(): void {
  resumed = false;
}

type Listener = (e: { preventDefault(): void; returnValue?: unknown }) => void;
export interface UnloadTarget {
  addEventListener(type: 'beforeunload', l: Listener): void;
  removeEventListener(type: 'beforeunload', l: Listener): void;
}

// 閉じる確認を付ける。戻り値を呼ぶと外す
export function attachBeforeUnload(win: UnloadTarget): () => void {
  const l: Listener = (e) => {
    e.preventDefault();
    e.returnValue = ''; // 古いブラウザ向け（文言は変えられない）
  };
  win.addEventListener('beforeunload', l);
  return () => win.removeEventListener('beforeunload', l);
}

interface Sentinel {
  release(): Promise<void>;
}
export interface WakeNav {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> };
}
export interface VisDoc {
  visibilityState?: string;
  addEventListener(type: 'visibilitychange', l: () => void): void;
  removeEventListener(type: 'visibilitychange', l: () => void): void;
}

// 画面を暗くしない。対応していない・失敗は無言で何もしない。戻り値を呼ぶと解放する
export function keepScreenOn(nav: WakeNav | undefined, doc: VisDoc | undefined): () => void {
  const wl = nav?.wakeLock;
  if (!wl || !doc) return () => undefined;
  let sentinel: Sentinel | null = null;
  let stopped = false;
  const acquire = async () => {
    try {
      const s = await wl.request('screen');
      if (stopped) await s.release().catch(() => undefined);
      else sentinel = s;
    } catch {
      // 取れなくても続ける
    }
  };
  const onVisible = () => {
    // 隠れた時に OS が解放するので、戻った時に取り直す
    if (doc.visibilityState === 'visible' && !stopped) void acquire();
  };
  doc.addEventListener('visibilitychange', onVisible);
  void acquire();
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', onVisible);
    const s = sentinel;
    sentinel = null;
    if (s) void s.release().catch(() => undefined);
  };
}

// 流れの途中の間だけ、閉じる確認を付ける（Web だけ）
export function useFlowGuard(active: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const win = (globalThis as { window?: UnloadTarget }).window;
    return win ? attachBeforeUnload(win) : undefined;
  }, [active]);
}

// 集中の画面の間だけ、画面を暗くしない（Web だけ）
export function useKeepScreenOn(): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const g = globalThis as { navigator?: WakeNav; document?: VisDoc };
    return keepScreenOn(g.navigator, g.document);
  }, []);
}
