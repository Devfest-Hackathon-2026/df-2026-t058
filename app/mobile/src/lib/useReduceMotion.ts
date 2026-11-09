// OS設定の購読は全コンポーネントで共有する。未確認・サーバー描画中は静止。
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export const NATIVE_DRIVER = Platform.OS !== 'web';
let known: boolean | null = null;
let subscription: { remove(): void } | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const snapshot = () => known ?? true;
const publish = (value: boolean) => {
  known = value;
  listeners.forEach(listener => listener());
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const token = ++generation;
    let changed = false;
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      if (token !== generation) return;
      changed = true;
      publish(value);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (token === generation && !changed) publish(value); })
      .catch(() => { if (token === generation && !changed) publish(true); });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      generation++;
      subscription?.remove();
      subscription = null;
      known = null;
    }
  };
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
