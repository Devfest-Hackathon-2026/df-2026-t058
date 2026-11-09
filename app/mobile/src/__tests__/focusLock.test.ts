// 集中中は他のアプリを開けなくする（#300）: JS 側の窓口・画面のつなぎ・設定の差し込み・文書。
// ネイティブのモジュールは差し替える（Kotlin は CI でビルドされない＝docs/android-focus-lock.md の手順で人が確かめる）。
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined },
}));

import * as copy from '../lib/copy';
import {
  DEFAULT_ALLOW,
  FOCUS_LOCK_KEY,
  createFocusLock,
  type KeyStore,
  type NativeFocusLock,
} from '../lib/focusLock';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(root, ...p), 'utf8');

function memStore(init: Record<string, string> = {}): KeyStore {
  const m = new Map(Object.entries(init));
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
}

function fakeNative(perm = { usage: true, overlay: true }) {
  const calls: string[] = [];
  const listeners: Array<() => void> = [];
  const n: NativeFocusLock & { calls: string[]; started: any; quit(): void } = {
    calls,
    started: null,
    hasPermissions: () => perm,
    openUsageSettings: () => calls.push('openUsage'),
    openOverlaySettings: () => calls.push('openOverlay'),
    start: (o) => {
      calls.push('start');
      n.started = o;
    },
    stop: () => calls.push('stop'),
    addListener: (_e, fn) => {
      listeners.push(fn);
      return { remove: () => listeners.splice(listeners.indexOf(fn), 1) };
    },
    quit: () => listeners.slice().forEach((f) => f()),
  };
  return n;
}

const on = () => memStore({ [FOCUS_LOCK_KEY]: '1' });

describe('focusLock（JS 側）', () => {
  test('Web・iOS・モジュールが無い時は何もしない', async () => {
    for (const os of ['web', 'ios']) {
      const n = fakeNative();
      const lock = createFocusLock({ os, native: n, store: on() });
      expect(lock.supported()).toBe(false);
      expect(await lock.isEnabled()).toBe(false);
      const end = await lock.begin(() => undefined);
      end();
      expect(n.calls).toEqual([]);
    }
    const none = createFocusLock({ os: 'android', native: null, store: on() });
    expect(none.supported()).toBe(false);
    expect(none.openNextSettings()).toBeNull();
    await expect(none.begin(() => undefined)).resolves.toBeInstanceOf(Function);
  });

  test('既定は OFF。OFF の時は始めない', async () => {
    const n = fakeNative();
    const lock = createFocusLock({ os: 'android', native: n, store: memStore() });
    expect(await lock.isEnabled()).toBe(false);
    (await lock.begin(() => undefined))();
    expect(n.calls).toEqual([]);
    await lock.setEnabled(true);
    expect(await lock.isEnabled()).toBe(true);
  });

  test('許可が無いと始めない（エラーにもしない）。足りない許可の画面を順に開く', async () => {
    const n = fakeNative({ usage: false, overlay: false });
    const lock = createFocusLock({ os: 'android', native: n, store: on() });
    expect(lock.missing()).toEqual(['usage', 'overlay']);
    (await lock.begin(() => undefined))();
    expect(n.calls).toEqual([]);
    expect(lock.openNextSettings()).toBe('usage');
    const n2 = fakeNative({ usage: true, overlay: false });
    const lock2 = createFocusLock({ os: 'android', native: n2, store: on() });
    expect(lock2.openNextSettings()).toBe('overlay');
    expect([...n.calls, ...n2.calls]).toEqual(['openUsage', 'openOverlay']);
  });

  test('allow の既定に、電話・緊急・システム UI・ランチャー・時計・設定が入る', async () => {
    for (const p of [
      'com.android.systemui',
      'com.android.phone',
      'com.google.android.dialer',
      'com.android.emergency',
      'com.android.launcher3',
      'com.google.android.deskclock',
      'com.android.settings',
    ]) {
      expect(DEFAULT_ALLOW).toContain(p);
    }
    const n = fakeNative();
    await createFocusLock({ os: 'android', native: n, store: on() }).begin(() => undefined);
    expect(n.started.allow).toEqual([...DEFAULT_ALLOW]);
    expect(n.started).toMatchObject({
      title: copy.COPY_FOCUS_LOCK_TITLE,
      back: copy.COPY_FOCUS_LOCK_BACK,
      quit: copy.COPY_FOCUS_LOCK_QUIT,
      notice: copy.COPY_FOCUS_LOCK_NOTICE,
    });
  });

  test('開始と終了が対で呼ばれる（終了は何度呼んでも 1 回だけ）', async () => {
    const n = fakeNative();
    const end = await createFocusLock({ os: 'android', native: n, store: on() }).begin(() => undefined);
    end();
    end();
    expect(n.calls).toEqual(['start', 'stop']);
  });

  test('「集中をやめる」で集中終了の導線が呼ばれ、終了後は呼ばれない', async () => {
    const n = fakeNative();
    const onQuit = jest.fn();
    const end = await createFocusLock({ os: 'android', native: n, store: on() }).begin(onQuit);
    n.quit();
    expect(onQuit).toHaveBeenCalledTimes(1);
    end();
    n.quit();
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  test('ネイティブが失敗しても例外を出さない', async () => {
    const n = fakeNative();
    n.start = () => {
      throw new Error('x');
    };
    const end = await createFocusLock({ os: 'android', native: n, store: on() }).begin(() => undefined);
    expect(() => end()).not.toThrow();
  });
});

describe('画面のつなぎ', () => {
  test('集中の画面は開始と終了の 2 か所だけ', () => {
    const s = read('src', 'app', 'focus', '[sessionId].tsx');
    expect(s.match(/beginFocusLock\(/g) ?? []).toHaveLength(1);
    expect(s).toContain('beginFocusLock(() => setConfirming(true))');
    expect(s).toContain('lockEnd.current(); // 終了');
  });

  test('設定のスイッチは Android でモジュールがある時だけ・文言は copy.ts', () => {
    const s = read('src', 'app', 'settings.tsx');
    expect(s).toContain("Platform.OS === 'android' && lock.supported()");
    expect(s).toContain('COPY_FOCUS_LOCK_LABEL');
    // モルティの吹き出しでなく普通の小さな文（#355）
    expect(s).toContain('{COPY_FOCUS_LOCK_WHY}');
    expect(s).not.toContain('<AgentSays');
    expect(copy.COPY_FOCUS_LOCK_LABEL).toBe('集中中は他のアプリを開けなくする');
    expect(copy.COPY_FOCUS_LOCK_TITLE).toBe('集中中です。続けますか？');
  });
});

describe('ネイティブと設定の差し込み', () => {
  const kt = ['FocusLockModule.kt', 'FocusLockService.kt']
    .map((f) => read('modules', 'focus-lock', 'android', 'src', 'main', 'java', 'expo', 'modules', 'focuslock', f))
    .join('\n');

  test('AccessibilityService は使わない', () => {
    expect(kt).not.toMatch(/AccessibilityService/);
    expect(read('plugins', 'withFocusLock.js')).not.toMatch(/BIND_ACCESSIBILITY_SERVICE/);
  });

  test('1 秒ごと・重ねる画面に 2 つのボタン・端まで覆わない・タスク終了で解除', () => {
    expect(kt).toContain('TICK_MS = 1000L');
    expect(kt).toContain('setOnClickListener { backToApp() }');
    expect(kt).toContain('setOnClickListener { quitFocus() }');
    expect(kt).toContain('FLAG_NOT_FOCUSABLE');
    expect(kt).toContain('widthPixels * 0.85');
    expect(kt).toContain('override fun onTaskRemoved');
    expect(kt).toContain('START_NOT_STICKY');
    expect(kt).toContain('FOREGROUND_SERVICE_TYPE_SPECIAL_USE');
  });

  test('config plugin が権限とサービスを入れ、app.json に 1 行', () => {
    const plugin = read('plugins', 'withFocusLock.js');
    for (const p of [
      'PACKAGE_USAGE_STATS',
      'SYSTEM_ALERT_WINDOW',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_SPECIAL_USE',
      'POST_NOTIFICATIONS',
    ]) {
      expect(plugin).toContain(`'android.permission.${p}'`);
    }
    expect(plugin).toContain("'android:foregroundServiceType': 'specialUse'");
    expect(plugin).toContain("'android:exported': 'false'");
    const app = JSON.parse(read('app.json'));
    expect(app.expo.plugins).toContain('./plugins/withFocusLock');
    const mod = JSON.parse(read('modules', 'focus-lock', 'expo-module.config.json'));
    expect(mod.android.modules).toEqual(['expo.modules.focuslock.FocusLockModule']);
  });

  test('人が確かめる手順の文書は 40 行以内', () => {
    const doc = read('..', '..', 'docs', 'android-focus-lock.md');
    expect(doc.trimEnd().split('\n').length).toBeLessThanOrEqual(40);
    for (const w of ['SYSTEM_ALERT_WINDOW', 'PACKAGE_USAGE_STATS', 'AccessibilityService', '強制終了', '電話']) {
      expect(doc).toContain(w);
    }
  });
});
