// 集中中は他のアプリを開けなくする（Android だけ・#300）。既定は OFF。本人が設定で ON にした時だけ動く。
// ネイティブは modules/focus-lock（Kotlin）。Web・iOS・Expo Go ではモジュールが無いので何もしない。
// 閉じ込めない: 重ねる画面には「戻る」「集中をやめる」が常にあり、電話・緊急・設定などは通す（docs/android-focus-lock.md）。
// 端末の中だけ。サーバーには何も送らない。

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  COPY_FOCUS_LOCK_BACK,
  COPY_FOCUS_LOCK_NOTICE,
  COPY_FOCUS_LOCK_QUIT,
  COPY_FOCUS_LOCK_TITLE,
} from './copy';

// ネイティブ側（FocusLockModule.kt）の形
export interface NativeFocusLock {
  hasPermissions(): { usage: boolean; overlay: boolean };
  openUsageSettings(): void;
  openOverlaySettings(): void;
  start(opts: { allow: string[]; title: string; back: string; quit: string; notice: string }): void;
  stop(): void;
  addListener(event: 'onQuit', fn: () => void): { remove(): void };
}

export interface KeyStore {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

export interface FocusLockDeps {
  os: string;
  native: NativeFocusLock | null;
  store: KeyStore;
}

// 常に通すアプリ（ネイティブ側でも、自分・既定の電話・既定のホームを足す）。
// 電話/ダイヤラ・通話中の画面・緊急通報・システム UI・ランチャー・時計のアラーム・設定（許可を外せるように）
export const DEFAULT_ALLOW: readonly string[] = [
  'com.android.systemui',
  'com.android.phone',
  'com.android.dialer',
  'com.android.server.telecom',
  'com.android.incallui',
  'com.android.emergency',
  'com.google.android.dialer',
  'com.samsung.android.dialer',
  'com.samsung.android.incallui',
  'com.samsung.android.emergency',
  'com.android.launcher3',
  'com.google.android.apps.nexuslauncher',
  'com.sec.android.app.launcher',
  'com.android.deskclock',
  'com.google.android.deskclock',
  'com.sec.android.app.clockpackage',
  'com.android.settings',
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
];

export const FOCUS_LOCK_KEY = 'focusLock.enabled.v1';

export type FocusLockPermission = 'usage' | 'overlay';
const noop = (): void => undefined;

export function createFocusLock(deps: FocusLockDeps) {
  const { os, native, store } = deps;
  const supported = (): boolean => os === 'android' && native !== null;

  // 足りない許可（無ければ空）。調べられない時は全部足りない扱い
  function missing(): FocusLockPermission[] {
    if (!supported() || !native) return [];
    try {
      const p = native.hasPermissions();
      return [...(p.usage ? [] : ['usage' as const]), ...(p.overlay ? [] : ['overlay' as const])];
    } catch {
      return ['usage', 'overlay'];
    }
  }

  async function isEnabled(): Promise<boolean> {
    if (!supported()) return false;
    try {
      return (await store.getItem(FOCUS_LOCK_KEY)) === '1';
    } catch {
      return false;
    }
  }

  return {
    supported,
    missing,
    isEnabled,

    async setEnabled(on: boolean): Promise<void> {
      if (!supported()) return;
      try {
        await store.setItem(FOCUS_LOCK_KEY, on ? '1' : '0');
      } catch {
        // 保存できなくても続ける（既定の OFF に戻るだけ）
      }
    },

    // 足りない許可の、OS の設定画面を 1 つ開く（使用状況 → 重ねる の順）。開いた方を返す
    openNextSettings(): FocusLockPermission | null {
      const next = missing()[0] ?? null;
      if (!native || !next) return next;
      try {
        if (next === 'usage') native.openUsageSettings();
        else native.openOverlaySettings();
      } catch {
        // 開けなくても、機能なしで集中できる
      }
      return next;
    },

    // 集中の開始。ON かつ許可が揃っている時だけ見張りを始める。
    // 戻り値は「終了」（何度呼んでもよい）。「集中をやめる」が押されたら onQuit を呼ぶ。決してエラーにしない
    async begin(onQuit: () => void, allow: readonly string[] = DEFAULT_ALLOW): Promise<() => void> {
      const n = native;
      if (!n || !supported()) return noop;
      if (!(await isEnabled())) return noop;
      if (missing().length > 0) return noop;
      let sub: { remove(): void } | null = null;
      try {
        sub = n.addListener('onQuit', onQuit);
        n.start({
          allow: [...allow],
          title: COPY_FOCUS_LOCK_TITLE,
          back: COPY_FOCUS_LOCK_BACK,
          quit: COPY_FOCUS_LOCK_QUIT,
          notice: COPY_FOCUS_LOCK_NOTICE,
        });
      } catch {
        sub?.remove();
        return noop;
      }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        sub?.remove();
        try {
          n.stop();
        } catch {
          // 止められない時もネイティブ側がアプリの終了で解除する
        }
      };
    },
  };
}

export type FocusLockApi = ReturnType<typeof createFocusLock>;

// ネイティブのモジュールを探す（無ければ null。Expo Go・Web・iOS は null）
function loadNative(): NativeFocusLock | null {
  if (Platform.OS !== 'android') return null;
  try {
    return (require('expo').requireOptionalNativeModule('FocusLock') as NativeFocusLock | null) ?? null;
  } catch {
    return null;
  }
}

let shared: FocusLockApi | null = null;
export function focusLockApi(): FocusLockApi {
  if (!shared) shared = createFocusLock({ os: Platform.OS, native: loadNative(), store: AsyncStorage });
  return shared;
}

// 集中の画面から呼ぶ（開始）。戻り値を終了で呼ぶ
export function beginFocusLock(onQuit: () => void): Promise<() => void> {
  return focusLockApi()
    .begin(onQuit)
    .catch(() => noop);
}
