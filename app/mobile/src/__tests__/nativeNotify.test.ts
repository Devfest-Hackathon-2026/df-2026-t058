// Android アプリの通知（#299）: 予約の判断（純粋な関数）と、部品を偽物にした流れ。
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined },
}));

import { createMockApi } from '../api/mock';
import { createHttpApi } from '../api/http';
import * as copy from '../lib/copy';
import {
  DAILY_TIME,
  FOCUS_LEAVE_DELAY_SEC,
  ID_DAILY,
  ID_FOCUS_LEAVE,
  createNativeNotify,
  dailyNudgeTime,
  focusNotifyAction,
  needsRegister,
  safeRoute,
  shouldAskPermission,
  type NotificationsModule,
} from '../lib/nativeNotify';

describe('純粋な判断', () => {
  test('離れたら 2 分後に予約・戻った／終えたら取り消し', () => {
    expect(FOCUS_LEAVE_DELAY_SEC).toBe(120);
    expect(focusNotifyAction('leave')).toEqual({ kind: 'schedule', seconds: 120 });
    expect(focusNotifyAction('return')).toEqual({ kind: 'cancel' });
    expect(focusNotifyAction('end')).toEqual({ kind: 'cancel' });
  });

  test('毎日の声かけ: 強さが「なし」・許可なしなら出さない。既定は 19:00', () => {
    expect(dailyNudgeTime('off', true)).toBeNull();
    expect(dailyNudgeTime('friend_start', false)).toBeNull();
    expect(dailyNudgeTime(undefined, true)).toBeNull();
    expect(dailyNudgeTime('friend_start', true)).toEqual({ hour: 19, minute: 0 });
    expect(dailyNudgeTime('strong', true)).toEqual(DAILY_TIME);
  });

  test('route は "/" 始まりだけ。"//"・http・"\\" は拒否', () => {
    expect(safeRoute('/')).toBe('/');
    expect(safeRoute('/focus/s1')).toBe('/focus/s1');
    expect(safeRoute('//evil.example')).toBeNull();
    expect(safeRoute('http://evil.example')).toBeNull();
    expect(safeRoute('https://evil.example/')).toBeNull();
    expect(safeRoute('/redirect?u=https://x')).toBeNull();
    expect(safeRoute('/\\evil')).toBeNull();
    expect(safeRoute('focus/s1')).toBeNull();
    expect(safeRoute('')).toBeNull();
    expect(safeRoute(42)).toBeNull();
    expect(safeRoute(undefined)).toBeNull();
  });

  test('許可を聞くのは Android・道筋あり・未質問・未決定の時だけ', () => {
    const base = { platform: 'android', hasRoadmap: true, asked: false, status: 'undetermined' };
    expect(shouldAskPermission(base)).toBe(true);
    expect(shouldAskPermission({ ...base, platform: 'web' })).toBe(false);
    expect(shouldAskPermission({ ...base, platform: 'ios' })).toBe(false);
    expect(shouldAskPermission({ ...base, hasRoadmap: false })).toBe(false);
    expect(shouldAskPermission({ ...base, asked: true })).toBe(false);
    expect(shouldAskPermission({ ...base, status: 'denied' })).toBe(false);
  });

  test('トークンが変わった時だけ登録し直す', () => {
    expect(needsRegister(null, 'a')).toBe(true);
    expect(needsRegister('a', 'a')).toBe(false);
    expect(needsRegister('a', 'b')).toBe(true);
    expect(needsRegister('a', null)).toBe(false);
  });
});

// expo-notifications の偽物（モジュールごと差し替え）
function fakeModule(status = 'granted') {
  const scheduled = new Map<string, any>();
  const calls: string[] = [];
  let tapListener: ((r: any) => void) | null = null;
  let tokenListener: ((t: any) => void) | null = null;
  const mod: NotificationsModule = {
    getPermissionsAsync: async () => ({ status }),
    requestPermissionsAsync: async () => {
      calls.push('request');
      return { status: 'granted' };
    },
    setNotificationChannelAsync: async (id) => {
      calls.push(`channel:${id}`);
      return null;
    },
    AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DAILY: 'daily' },
    scheduleNotificationAsync: async (r) => {
      scheduled.set(r.identifier!, r);
      return r.identifier!;
    },
    cancelScheduledNotificationAsync: async (id) => {
      scheduled.delete(id);
    },
    getDevicePushTokenAsync: async () => ({ type: 'android', data: 'tok-1' }),
    addPushTokenListener: (l) => {
      tokenListener = l;
      return { remove: () => (tokenListener = null) };
    },
    addNotificationResponseReceivedListener: (l) => {
      tapListener = l;
      return { remove: () => (tapListener = null) };
    },
  };
  return { mod, scheduled, calls, tap: (r: any) => tapListener?.(r), token: (t: any) => tokenListener?.(t) };
}

function memStore() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v), m };
}

function fakeApi() {
  const log: string[] = [];
  return {
    log,
    registerDevice: async (t: string) => void log.push(`reg:${t}`),
    unregisterDevice: async (t: string) => void log.push(`unreg:${t}`),
  };
}

describe('流れ（偽物の部品）', () => {
  test('Web・iOS・部品なしでは何もしない', async () => {
    const f = fakeModule();
    for (const n of [
      createNativeNotify({ platform: () => 'web', mod: () => f.mod, store: memStore() }),
      createNativeNotify({ platform: () => 'ios', mod: () => f.mod, store: memStore() }),
      createNativeNotify({ platform: () => 'android', mod: () => null, store: memStore() }),
    ]) {
      await n.onFocusEvent('leave', 's1');
      await n.syncDaily('strong');
      expect(n.start(() => undefined, fakeApi())).toBeInstanceOf(Function);
    }
    expect(f.scheduled.size).toBe(0);
  });

  test('離れたら予約・戻ったら取り消し・終えたら取り消し', async () => {
    const f = fakeModule();
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store: memStore() });
    await n.onFocusEvent('leave', 's1');
    const r = f.scheduled.get(ID_FOCUS_LEAVE);
    expect(r.trigger).toEqual({ type: 'timeInterval', seconds: 120, channelId: 'focus' });
    expect(r.content.body).toBe(copy.COPY_NOTIFY_FOCUS_LEAVE);
    expect(r.content.data).toEqual({ route: '/focus/s1' });
    await n.onFocusEvent('return');
    expect(f.scheduled.has(ID_FOCUS_LEAVE)).toBe(false);
    await n.onFocusEvent('leave', 's1');
    await n.onFocusEvent('end');
    expect(f.scheduled.has(ID_FOCUS_LEAVE)).toBe(false);
  });

  test('許可が無ければ予約しない', async () => {
    const f = fakeModule('denied');
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store: memStore() });
    await n.onFocusEvent('leave', 's1');
    await n.syncDaily('strong');
    expect(f.scheduled.size).toBe(0);
  });

  test('毎日の声かけ: 強さに合わせて入れる・「なし」で消す', async () => {
    const f = fakeModule();
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store: memStore() });
    await n.syncDaily('friend_start');
    expect(f.scheduled.get(ID_DAILY).trigger).toEqual({ type: 'daily', hour: 19, minute: 0, channelId: 'daily' });
    expect(f.scheduled.get(ID_DAILY).content.body).toBe(copy.COPY_NOTIFY_DAILY);
    await n.syncDaily('off');
    expect(f.scheduled.has(ID_DAILY)).toBe(false);
  });

  test('初めて道筋を決めた後: セリフで「はい」→ チャンネル → OS の許可 → 登録。2 回目は聞かない', async () => {
    const f = fakeModule('undetermined');
    const store = memStore();
    const api = fakeApi();
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store });
    let asked = 0;
    const confirm = async () => (asked++, true);
    await n.onHome({ hasRoadmap: false, nudgeLevel: 'friend_start' }, api, confirm);
    expect(asked).toBe(0);
    await n.onHome({ hasRoadmap: true, nudgeLevel: 'friend_start' }, api, confirm);
    expect(asked).toBe(1);
    expect(f.calls).toEqual(['channel:focus', 'channel:friends', 'channel:daily', 'request']);
    expect(api.log).toEqual(['reg:tok-1']);
    await n.onHome({ hasRoadmap: true, nudgeLevel: 'friend_start' }, api, confirm);
    expect(asked).toBe(1);
  });

  test('「あとで」なら OS の窓を出さず、困らない', async () => {
    const f = fakeModule('undetermined');
    const api = fakeApi();
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store: memStore() });
    await n.onHome({ hasRoadmap: true, nudgeLevel: 'strong' }, api, async () => false);
    expect(f.calls).not.toContain('request');
    expect(api.log).toEqual([]);
    expect(f.scheduled.size).toBe(0);
  });

  test('トークンが変わったら登録し直し、古い方を消す。同じなら送らない', async () => {
    const f = fakeModule();
    const api = fakeApi();
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store: memStore() });
    expect(await n.registerToken(api)).toBe(true);
    expect(await n.registerToken(api)).toBe(false);
    expect(await n.registerToken(api, 'tok-2')).toBe(true);
    expect(api.log).toEqual(['reg:tok-1', 'reg:tok-2', 'unreg:tok-1']);
  });

  test('サーバーの登録に失敗しても止まらず、次に登録し直す', async () => {
    const f = fakeModule();
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store: memStore() });
    const bad = { registerDevice: async () => Promise.reject(new Error('x')), unregisterDevice: async () => undefined };
    expect(await n.registerToken(bad)).toBe(false);
    const api = fakeApi();
    expect(await n.registerToken(api)).toBe(true);
  });

  test('タップ: アプリ内のパスだけ移動・外部 URL は無視', () => {
    const f = fakeModule();
    const n = createNativeNotify({ platform: () => 'android', mod: () => f.mod, store: memStore() });
    const went: string[] = [];
    const stop = n.start((p) => went.push(p), fakeApi());
    const resp = (route: unknown) => ({ notification: { request: { content: { data: { route } } } } });
    f.tap(resp('/focus/s1'));
    f.tap(resp('https://evil.example'));
    f.tap(resp('//evil.example'));
    f.tap({ notification: { request: { content: {} } } });
    expect(went).toEqual(['/focus/s1']);
    stop();
    f.tap(resp('/'));
    expect(went).toEqual(['/focus/s1']);
  });
});

describe('窓口', () => {
  test('mock の registerDevice・unregisterDevice は何もしないで成功', async () => {
    const api = createMockApi();
    await expect(api.registerDevice('t')).resolves.toBeUndefined();
    await expect(api.unregisterDevice('t')).resolves.toBeUndefined();
  });

  test('http は POST|DELETE /api/push/device に {token, platform:"android"} を送る', async () => {
    const sent: { method?: string; url: string; body?: string }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      sent.push({ url, method: init.method, body: init.body });
      return { ok: true, status: 204, text: async () => '' };
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://localhost', getUserId: async () => 'u1', fetchImpl });
    await api.registerDevice('t1');
    await api.unregisterDevice('t1');
    expect(sent.map((s) => [s.method, s.url, JSON.parse(s.body!)])).toEqual([
      ['POST', 'http://localhost/api/push/device', { token: 't1', platform: 'android' }],
      ['DELETE', 'http://localhost/api/push/device', { token: 't1', platform: 'android' }],
    ]);
  });

  test('Web の通知（push.ts）は nativeNotify を使わない', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(`${__dirname}/../lib/push.ts`, 'utf8');
    expect(src).not.toContain('nativeNotify');
  });
});
