// Android アプリの通知（#299）。端末内の通知（集中の呼び戻し・毎日の声かけ）と FCM の受け取り。
// Web・iOS では何もしない（Web の通知は lib/push.ts のまま）。判断は純粋な関数にして試験する。
// expo-notifications は外から渡す（setNotificationsModule）。渡されるまでは何もしない＝Web・試験・CI を壊さない。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import type { NudgeLevel } from '../api/types';
import { color } from '../theme';
import {
  COPY_NOTIFY_ASK,
  COPY_NOTIFY_ASK_LATER,
  COPY_NOTIFY_ASK_YES,
  COPY_NOTIFY_DAILY,
  COPY_NOTIFY_FOCUS_LEAVE,
  COPY_NOTIFY_TITLE,
} from './copy';

// ── 決まり ──
export const FOCUS_LEAVE_DELAY_SEC = 120; // 集中中に離れて 2 分
export const DAILY_TIME = { hour: 19, minute: 0 }; // 毎日の声かけ（時刻は AI 側の方針で固定・本人に聞かない）
export const ID_FOCUS_LEAVE = 'focus-leave';
export const ID_DAILY = 'daily-nudge';

export type ChannelId = 'focus' | 'friends' | 'daily';
export const CHANNELS: { id: ChannelId; name: string; high: boolean }[] = [
  { id: 'focus', name: '集中の呼び戻し', high: true },
  { id: 'friends', name: '友達', high: false },
  { id: 'daily', name: '毎日の声かけ', high: false },
];

// ── 純粋な関数 ──
export type FocusNotifyEvent = 'leave' | 'return' | 'end';
export type FocusNotifyAction = { kind: 'schedule'; seconds: number } | { kind: 'cancel' };

// 離れたら 2 分後に 1 回。戻った・終えたら取り消す
export function focusNotifyAction(ev: FocusNotifyEvent): FocusNotifyAction {
  return ev === 'leave' ? { kind: 'schedule', seconds: FOCUS_LEAVE_DELAY_SEC } : { kind: 'cancel' };
}

// 毎日の声かけの時刻。通知の強さが「なし」か、許可が無ければ出さない（null）
export function dailyNudgeTime(level: NudgeLevel | null | undefined, granted: boolean): { hour: number; minute: number } | null {
  if (!granted || !level || level === 'off') return null;
  return { ...DAILY_TIME };
}

// 通知の data.route を受け付けるか。アプリ内の相対パス（'/' 始まり）だけ。'//'・'\'・'://' を含む物は拒否
export function safeRoute(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return null;
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (v.includes('\\') || v.includes('://') || /[\s\u0000-\u001f]/.test(v)) return null;
  return v;
}

// 許可を聞くか。Android・目標の道筋を 1 つ以上決めた・まだ聞いていない・OS がまだ決めていない時だけ
export function shouldAskPermission(a: { platform: string; hasRoadmap: boolean; asked: boolean; status: string }): boolean {
  return a.platform === 'android' && a.hasRoadmap && !a.asked && a.status === 'undetermined';
}

// トークンが変わった（または初めて）なら登録し直す
export function needsRegister(prev: string | null, next: string | null): boolean {
  return !!next && next !== prev;
}

// ── expo-notifications の使う部分だけの形 ──
interface Sub {
  remove(): void;
}
interface TokenLike {
  type: string;
  data: unknown;
}
interface ResponseLike {
  notification: { request: { content: { data?: unknown } } };
}
export interface NotificationsModule {
  getPermissionsAsync(): Promise<{ status: string }>;
  requestPermissionsAsync(): Promise<{ status: string }>;
  setNotificationChannelAsync(id: string, ch: { name: string; importance: number; lightColor?: string }): Promise<unknown>;
  AndroidImportance: { HIGH: number; DEFAULT: number };
  SchedulableTriggerInputTypes: { TIME_INTERVAL: string; DAILY: string };
  scheduleNotificationAsync(r: {
    identifier?: string;
    content: { title?: string; body: string; data?: Record<string, unknown> };
    trigger: Record<string, unknown>;
  }): Promise<string>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
  getDevicePushTokenAsync(): Promise<TokenLike>;
  addPushTokenListener(l: (t: TokenLike) => void): Sub;
  addNotificationResponseReceivedListener(l: (r: ResponseLike) => void): Sub;
  getLastNotificationResponseAsync?(): Promise<ResponseLike | null>;
}

export interface DeviceApi {
  registerDevice(token: string): Promise<void>;
  unregisterDevice(token: string): Promise<void>;
}

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, v: string): Promise<void>;
}

const KEY_TOKEN = 'nativePushToken.v1';
const KEY_ASKED = 'nativeNotifyAsked.v1';
const LIGHT = color.bg; // 温かい紙色

// ── 流れ（部品を受けて動かす・試験では偽物を渡す）──
export function createNativeNotify(deps: { platform: () => string; mod: () => NotificationsModule | null; store: Store }) {
  // Android で、部品が渡されている時だけ動く
  const m = (): NotificationsModule | null => (deps.platform() === 'android' ? deps.mod() : null);
  const quiet = async <T>(f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await f();
    } catch {
      return undefined;
    }
  };

  async function ensureChannels(n: NotificationsModule): Promise<void> {
    for (const c of CHANNELS) {
      await quiet(() =>
        n.setNotificationChannelAsync(c.id, {
          name: c.name,
          importance: c.high ? n.AndroidImportance.HIGH : n.AndroidImportance.DEFAULT,
          lightColor: LIGHT,
        }),
      );
    }
  }

  async function status(): Promise<string> {
    const n = m();
    if (!n) return 'unavailable';
    return (await quiet(async () => (await n.getPermissionsAsync()).status)) ?? 'unavailable';
  }

  // FCM のトークンを取り、変わっていればサーバーへ登録する
  async function registerToken(api: DeviceApi, given?: string): Promise<boolean> {
    const n = m();
    if (!n) return false;
    const token = given ?? (await quiet(async () => (await n.getDevicePushTokenAsync()).data));
    if (typeof token !== 'string') return false;
    const prev = await quiet(() => deps.store.get(KEY_TOKEN));
    if (!needsRegister(prev ?? null, token)) return false;
    const ok = await quiet(async () => {
      await api.registerDevice(token);
      return true;
    });
    if (!ok) return false;
    if (prev) await quiet(() => api.unregisterDevice(prev)); // 古いトークンは消す（失敗しても困らない）
    await quiet(() => deps.store.set(KEY_TOKEN, token));
    return true;
  }

  // OS の許可を依頼する（Android 13 は通知チャンネルを先に作る）
  async function requestPermission(api: DeviceApi): Promise<boolean> {
    const n = m();
    if (!n) return false;
    await ensureChannels(n);
    const s = await quiet(async () => (await n.requestPermissionsAsync()).status);
    if (s !== 'granted') return false;
    await registerToken(api);
    return true;
  }

  // 集中中の離脱・復帰・終了
  async function onFocusEvent(ev: FocusNotifyEvent, sessionId?: string): Promise<void> {
    const n = m();
    if (!n) return;
    const a = focusNotifyAction(ev);
    await quiet(() => n.cancelScheduledNotificationAsync(ID_FOCUS_LEAVE));
    if (a.kind !== 'schedule' || (await status()) !== 'granted') return;
    const route = sessionId ? safeRoute(`/focus/${encodeURIComponent(sessionId)}`) : null;
    await quiet(() =>
      n.scheduleNotificationAsync({
        identifier: ID_FOCUS_LEAVE,
        content: { title: COPY_NOTIFY_TITLE, body: COPY_NOTIFY_FOCUS_LEAVE, data: route ? { route } : {} },
        trigger: { type: n.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: a.seconds, channelId: 'focus' },
      }),
    );
  }

  // 毎日の声かけを、通知の強さに合わせて入れ直す
  async function syncDaily(level: NudgeLevel | null | undefined): Promise<void> {
    const n = m();
    if (!n) return;
    await quiet(() => n.cancelScheduledNotificationAsync(ID_DAILY));
    const t = dailyNudgeTime(level, (await status()) === 'granted');
    if (!t) return;
    await quiet(() =>
      n.scheduleNotificationAsync({
        identifier: ID_DAILY,
        content: { title: COPY_NOTIFY_TITLE, body: COPY_NOTIFY_DAILY, data: { route: '/' } },
        trigger: { type: n.SchedulableTriggerInputTypes.DAILY, hour: t.hour, minute: t.minute, channelId: 'daily' },
      }),
    );
  }

  // ホームを読んだ後。初めて道筋を決めた後なら許可を聞き（confirm＝モルティーのセリフ）、毎日の声かけを合わせる
  async function onHome(
    a: { hasRoadmap: boolean; nudgeLevel: NudgeLevel },
    api: DeviceApi,
    confirm: () => Promise<boolean>,
  ): Promise<void> {
    const n = m();
    if (!n) return;
    const asked = (await quiet(() => deps.store.get(KEY_ASKED))) === '1';
    if (shouldAskPermission({ platform: deps.platform(), hasRoadmap: a.hasRoadmap, asked, status: await status() })) {
      await quiet(() => deps.store.set(KEY_ASKED, '1')); // 「あとで」でも聞き直さない
      if (await confirm()) await requestPermission(api);
    } else if ((await status()) === 'granted') {
      await registerToken(api);
    }
    await syncDaily(a.nudgeLevel);
  }

  // 通知のタップで移動・トークンが変わったら登録し直す。戻り値で購読をやめる
  function start(navigate: (path: string) => void, api: DeviceApi): () => void {
    const n = m();
    if (!n) return () => undefined;
    const go = (r: ResponseLike | null | undefined) => {
      const route = safeRoute((r?.notification?.request?.content?.data as { route?: unknown } | undefined)?.route);
      if (route) navigate(route);
    };
    const subs: Sub[] = [];
    try {
      subs.push(n.addNotificationResponseReceivedListener(go));
      subs.push(
        n.addPushTokenListener((t) => {
          if (typeof t.data === 'string') void registerToken(api, t.data);
        }),
      );
    } catch {
      // 部品が無くても画面は止めない
    }
    if (n.getLastNotificationResponseAsync) void quiet(() => n.getLastNotificationResponseAsync!()).then(go);
    void quiet(() => ensureChannels(n));
    return () => subs.forEach((s) => quiet(async () => s.remove()));
  }

  return { status, requestPermission, registerToken, onFocusEvent, syncDaily, onHome, start };
}

// ── 本物（アプリ全体で 1 つ）──
let notificationsModule: NotificationsModule | null = null;

// expo-notifications を入れたら、起動時に 1 回これで渡す（例: setNotificationsModule(require('expo-notifications'))）
export function setNotificationsModule(mod: NotificationsModule | null): void {
  notificationsModule = mod;
}

export const nativeNotify = createNativeNotify({
  platform: () => Platform.OS,
  mod: () => notificationsModule,
  store: {
    get: (k) => AsyncStorage.getItem(k),
    set: (k, v) => AsyncStorage.setItem(k, v),
  },
});

// モルティーのセリフで「はい／あとで」を聞く（OS の許可の窓の前）
export function askWithAgent(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(COPY_NOTIFY_TITLE, COPY_NOTIFY_ASK, [
      { text: COPY_NOTIFY_ASK_LATER, style: 'cancel', onPress: () => resolve(false) },
      { text: COPY_NOTIFY_ASK_YES, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
