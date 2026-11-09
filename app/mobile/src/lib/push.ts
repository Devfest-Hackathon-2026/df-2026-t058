// 端末への通知（Web Push・#212・契約 §3.7c）。判定と組み立ては純粋な関数にして試験する。
// ブラウザの部品（serviceWorker・PushManager・Notification）は PushBrowser に包んで渡す（試験では偽物）。
// 許可の窓は、本人が設定のスイッチを押した時（enablePush）だけ出す。

import type { NudgeLevel, PushSubscriptionBody } from '../api/types';

export const SW_URL = '/sw.js';

// ── 対応の判定 ──
export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIos: boolean;
  standalone: boolean; // ホーム画面に追加して開いている
}

// ok: 使える／ios_home: iPhone・iPad でホーム画面に追加すれば使える／no: 使えない（行を出さない）
export type PushSupport = 'ok' | 'ios_home' | 'no';

export function pushSupport(env: PushEnv): PushSupport {
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) return 'ok';
  if (env.isIos && !env.standalone) return 'ios_home';
  return 'no';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function readPushEnv(g: any = globalThis): PushEnv {
  const nav = g?.navigator;
  const ua: string = typeof nav?.userAgent === 'string' ? nav.userAgent : '';
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  const standalone = nav?.standalone === true || g?.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return {
    hasServiceWorker: !!nav && 'serviceWorker' in nav,
    hasPushManager: !!g && 'PushManager' in g,
    hasNotification: !!g && 'Notification' in g,
    isIos,
    standalone,
  };
}

// ── 組み立て ──
// VAPID の公開鍵（base64url）を applicationServerKey に渡すバイト列へ
export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of padded) {
    if (ch === '=') break;
    const v = table.indexOf(ch);
    if (v < 0) throw new Error('bad_key');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// subscription.toJSON() から、サーバーへ送る形（契約 §3.7c）へ。足りなければ null
export function subscriptionBody(json: unknown): PushSubscriptionBody | null {
  const j = json as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = j?.endpoint;
  const p256dh = j?.keys?.p256dh;
  const auth = j?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// ── 失敗の分類 ──
// denied: 通知を許可されなかった／unavailable: サーバーに通知が無い（404）／too_many: 端末が 3 台を超えた（409）
export type PushFailure = 'denied' | 'unavailable' | 'too_many' | 'failed';

export class PushError extends Error {
  readonly kind: PushFailure;
  constructor(kind: PushFailure) {
    super(kind);
    this.name = 'PushError';
    this.kind = kind;
  }
}

export function classifyPushError(e: unknown): PushFailure {
  if (e instanceof PushError) return e.kind;
  const x = e as { status?: unknown; name?: unknown } | null;
  if (x?.name === 'NotAllowedError') return 'denied'; // subscribe が許可なしで断られた
  if (x?.status === 404) return 'unavailable';
  if (x?.status === 409) return 'too_many';
  return 'failed';
}

// ── 状態 ──
// hidden: 項目ごと出さない／ios_home: ホーム画面に追加の案内だけ／off・on・denied: スイッチを出す
export type PushState = 'hidden' | 'ios_home' | 'off' | 'on' | 'denied';

export function pushStateOf(a: {
  support: PushSupport;
  keyFound: boolean;
  permission: string;
  subscribed: boolean;
  nudgeLevel: NudgeLevel;
}): PushState {
  if (a.support === 'no' || !a.keyFound) return 'hidden';
  if (a.support === 'ios_home') return 'ios_home';
  if (a.permission === 'denied') return 'denied';
  // nudgeLevel が off ならサーバーは送らない（§3.7c）ので、スイッチも切れて見せる
  return a.subscribed && a.permission === 'granted' && a.nudgeLevel !== 'off' ? 'on' : 'off';
}

// スイッチを入れた時の通知の強さ（friend_start 未満＝off なら friend_start に上げる。上は保つ）
export function nudgeAfterEnable(level: NudgeLevel): NudgeLevel {
  return level === 'off' ? 'friend_start' : level;
}

// ── 流れ（ブラウザの部品と窓口を受けて動かす）──
export interface PushSub {
  endpoint: string;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
}

export interface PushBrowser {
  permission(): string; // 'default' | 'granted' | 'denied'
  requestPermission(): Promise<string>;
  // register=false の時は、登録済みの SW だけを見る（無ければ null）
  pushManager(register: boolean): Promise<{
    getSubscription(): Promise<PushSub | null>;
    subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<PushSub>;
  } | null>;
}

export interface PushApi {
  pushKey(): Promise<{ publicKey: string }>;
  pushSubscribe(body: PushSubscriptionBody): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;
}

// 許可の窓 → 鍵 → 購読 → サーバーへ登録
export async function enablePush(b: PushBrowser, api: PushApi): Promise<void> {
  const perm = await b.requestPermission();
  if (perm !== 'granted') throw new PushError('denied');
  const { publicKey } = await api.pushKey();
  const pm = await b.pushManager(true);
  if (!pm) throw new PushError('failed');
  const sub =
    (await pm.getSubscription()) ??
    (await pm.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
  const body = subscriptionBody(sub.toJSON());
  if (!body) throw new PushError('failed');
  await api.pushSubscribe(body);
}

// サーバーの登録を消してから、この端末の購読をやめる
export async function disablePush(b: PushBrowser, api: PushApi): Promise<void> {
  const pm = await b.pushManager(false);
  const sub = pm ? await pm.getSubscription() : null;
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint);
  await sub.unsubscribe();
}

// いまの状態（鍵が 404 なら hidden。許可の窓は出さない）
export async function readPushState(
  env: PushEnv,
  b: PushBrowser | null,
  api: PushApi,
  nudgeLevel: NudgeLevel,
): Promise<PushState> {
  const support = pushSupport(env);
  if (support === 'no') return 'hidden';
  let keyFound = true;
  try {
    await api.pushKey();
  } catch (e) {
    if (classifyPushError(e) === 'unavailable') keyFound = false;
  }
  if (!keyFound) return 'hidden';
  if (support !== 'ok' || !b) return pushStateOf({ support, keyFound, permission: 'default', subscribed: false, nudgeLevel });
  let subscribed = false;
  try {
    const pm = await b.pushManager(false);
    subscribed = !!(pm && (await pm.getSubscription()));
  } catch {
    subscribed = false;
  }
  return pushStateOf({ support, keyFound, permission: b.permission(), subscribed, nudgeLevel });
}

// 本物のブラウザの部品（Web だけ。対応していなければ null）
export function browserPush(g: any = globalThis): PushBrowser | null {
  if (pushSupport(readPushEnv(g)) !== 'ok') return null;
  const sw = g.navigator.serviceWorker;
  return {
    permission: () => String(g.Notification.permission),
    requestPermission: () => g.Notification.requestPermission(),
    pushManager: async (register) => {
      const reg = register ? await sw.register(SW_URL) : await sw.getRegistration(SW_URL);
      if (!reg) return null;
      if (register) await sw.ready;
      return reg.pushManager;
    },
  };
}
