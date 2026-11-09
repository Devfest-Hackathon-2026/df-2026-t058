// 端末への通知 第 2 段（#212）: 対応の判定・購読の組み立て・失敗の分類・状態・流れ・窓口・SW・設定の画面。
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import { ApiError } from '../api/errors';
import * as copy from '../lib/copy';
import {
  PushError,
  base64UrlToBytes,
  classifyPushError,
  disablePush,
  enablePush,
  nudgeAfterEnable,
  pushStateOf,
  pushSupport,
  readPushEnv,
  readPushState,
  subscriptionBody,
  type PushBrowser,
  type PushEnv,
  type PushSub,
} from '../lib/push';

const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const env = (o: Partial<PushEnv> = {}): PushEnv => ({
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIos: false,
  standalone: false,
  ...o,
});

// 試験用の値は実行時に組み立てる（本物の形をそのまま書かない）
const fakeEndpoint = () => ['https:', '', 'push.example.test', 'ep', String(Date.now())].join('/');
const fakeKeys = () => ({ p256dh: 'p'.repeat(8), auth: 'a'.repeat(4) });

function fakeBrowser(perm: string, existing: PushSub | null = null) {
  const log: string[] = [];
  let sub = existing;
  const make = (): PushSub => {
    const endpoint = fakeEndpoint();
    const s: PushSub = {
      endpoint,
      toJSON: () => ({ endpoint, keys: fakeKeys() }),
      unsubscribe: async () => {
        log.push('unsubscribe');
        sub = null;
        return true;
      },
    };
    return s;
  };
  const b: PushBrowser = {
    permission: () => perm,
    requestPermission: async () => {
      log.push('ask');
      return perm;
    },
    pushManager: async (register) => {
      log.push(register ? 'register' : 'lookup');
      return {
        getSubscription: async () => sub,
        subscribe: async (o) => {
          log.push(`subscribe:${o.userVisibleOnly}:${o.applicationServerKey.length}`);
          sub = make();
          return sub;
        },
      };
    },
  };
  return { b, log, current: () => sub };
}

function fakeApi(keyStatus = 200) {
  const calls: string[] = [];
  return {
    calls,
    pushKey: async () => {
      calls.push('key');
      if (keyStatus !== 200) throw new ApiError(keyStatus, 'not_found', '');
      return { publicKey: 'BA' + 'A'.repeat(85) }; // 65 バイトになる長さ
    },
    pushSubscribe: async (b: { endpoint: string }) => {
      calls.push(`subscribe:${b.endpoint.startsWith('https://')}`);
    },
    pushUnsubscribe: async () => {
      calls.push('unsubscribe');
    },
  };
}

describe('対応の判定', () => {
  it('3 つ揃えば ok、iPhone でホーム画面に無い時は ios_home、他は no', () => {
    expect(pushSupport(env())).toBe('ok');
    expect(pushSupport(env({ hasPushManager: false }))).toBe('no');
    expect(pushSupport(env({ hasPushManager: false, isIos: true }))).toBe('ios_home');
    expect(pushSupport(env({ hasPushManager: false, isIos: true, standalone: true }))).toBe('no');
    expect(pushSupport(env({ isIos: true, standalone: true }))).toBe('ok');
  });
  it('読み取り: navigator が無い（ネイティブ）時は全部 false', () => {
    expect(readPushEnv({})).toEqual({ hasServiceWorker: false, hasPushManager: false, hasNotification: false, isIos: false, standalone: false });
    const g = { navigator: { serviceWorker: {}, userAgent: 'iPhone', standalone: true }, PushManager: 1, Notification: 1 };
    expect(readPushEnv(g)).toEqual({ hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIos: true, standalone: true });
  });
});

describe('組み立て', () => {
  it('base64url をバイト列に戻す（- と _ と、= の無い末尾）', () => {
    expect(Array.from(base64UrlToBytes('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(base64UrlToBytes('-_8'))).toEqual([251, 255]);
    expect(base64UrlToBytes('BA' + 'A'.repeat(85)).length).toBe(65);
    expect(() => base64UrlToBytes('a*b')).toThrow();
  });
  it('購読の JSON から endpoint と鍵 2 つだけを出す。欠けたら null', () => {
    const endpoint = fakeEndpoint();
    const keys = fakeKeys();
    expect(subscriptionBody({ endpoint, keys, expirationTime: null })).toEqual({ endpoint, keys });
    expect(subscriptionBody({ endpoint, keys: { p256dh: keys.p256dh } })).toBeNull();
    expect(subscriptionBody({ endpoint: '', keys })).toBeNull();
    expect(subscriptionBody(null)).toBeNull();
  });
});

describe('失敗の分類と状態', () => {
  it('許可なし・404・409・その他', () => {
    expect(classifyPushError(new PushError('denied'))).toBe('denied');
    expect(classifyPushError({ name: 'NotAllowedError' })).toBe('denied');
    expect(classifyPushError(new ApiError(404, 'not_found', ''))).toBe('unavailable');
    expect(classifyPushError(new ApiError(409, 'conflict', ''))).toBe('too_many');
    expect(classifyPushError(new ApiError(0, 'network', ''))).toBe('failed');
    expect(classifyPushError('x')).toBe('failed');
  });
  it('状態: 鍵が無い・非対応は hidden、拒否は denied、購読ありでも nudge off なら off', () => {
    const base = { support: 'ok' as const, keyFound: true, permission: 'granted', subscribed: true, nudgeLevel: 'friend_start' as const };
    expect(pushStateOf(base)).toBe('on');
    expect(pushStateOf({ ...base, keyFound: false })).toBe('hidden');
    expect(pushStateOf({ ...base, support: 'no' })).toBe('hidden');
    expect(pushStateOf({ ...base, support: 'ios_home' })).toBe('ios_home');
    expect(pushStateOf({ ...base, permission: 'denied' })).toBe('denied');
    expect(pushStateOf({ ...base, nudgeLevel: 'off' })).toBe('off');
    expect(pushStateOf({ ...base, subscribed: false })).toBe('off');
    expect(pushStateOf({ ...base, permission: 'default' })).toBe('off');
  });
  it('スイッチを入れると、off だけ friend_start に上がる（strong は保つ）', () => {
    expect(nudgeAfterEnable('off')).toBe('friend_start');
    expect(nudgeAfterEnable('friend_start')).toBe('friend_start');
    expect(nudgeAfterEnable('strong')).toBe('strong');
  });
});

describe('流れ', () => {
  it('入れる: 許可 → 鍵 → 購読（userVisibleOnly・65 バイトの鍵）→ サーバーへ登録', async () => {
    const f = fakeBrowser('granted');
    const a = fakeApi();
    await enablePush(f.b, a);
    expect(f.log).toEqual(['ask', 'register', 'subscribe:true:65']);
    expect(a.calls).toEqual(['key', 'subscribe:true']);
  });
  it('許可されなければ denied で止まり、鍵も取らない', async () => {
    const f = fakeBrowser('denied');
    const a = fakeApi();
    const e = await enablePush(f.b, a).catch((x) => x);
    expect(classifyPushError(e)).toBe('denied');
    expect(a.calls).toEqual([]);
  });
  it('切る: サーバーの登録を消して、端末の購読もやめる。購読が無ければ何もしない', async () => {
    const f = fakeBrowser('granted');
    const a = fakeApi();
    await enablePush(f.b, a);
    await disablePush(f.b, a);
    expect(a.calls.slice(-1)).toEqual(['unsubscribe']);
    expect(f.current()).toBeNull();
    const n = a.calls.length;
    await disablePush(f.b, a);
    expect(a.calls.length).toBe(n);
  });
  it('いまの状態: 鍵が 404 なら hidden で、許可の窓は出さない', async () => {
    const f = fakeBrowser('default');
    expect(await readPushState(env(), f.b, fakeApi(404), 'friend_start')).toBe('hidden');
    expect(await readPushState(env(), f.b, fakeApi(), 'friend_start')).toBe('off');
    expect(await readPushState(env({ hasNotification: false }), null, fakeApi(), 'off')).toBe('hidden');
    expect(f.log).not.toContain('ask');
    expect(f.log).not.toContain('register');
  });
});

describe('窓口と mock', () => {
  it('http: GET key・POST subscribe・DELETE subscribe（endpoint だけ）', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const text = url.endsWith('/key') ? '{"publicKey":"k"}' : '';
      return { ok: true, status: url.endsWith('/key') ? 200 : 204, text: async () => text } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    expect(await api.pushKey()).toEqual({ publicKey: 'k' });
    const endpoint = fakeEndpoint();
    await api.pushSubscribe({ endpoint, keys: fakeKeys() });
    await api.pushUnsubscribe(endpoint);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET http://api.test/api/push/key',
      'POST http://api.test/api/push/subscribe',
      'DELETE http://api.test/api/push/subscribe',
    ]);
    expect(JSON.parse(String(calls[2]?.init.body ?? '{}'))).toEqual({ endpoint });
  });
  it('mock は鍵が無い（404 ＝ 通知の項目を出さない）', async () => {
    const e = await createMockApi({ aiDelayMs: 0 }).pushKey().catch((x) => x);
    expect(classifyPushError(e)).toBe('unavailable');
  });
});

describe('Service Worker と設定の画面', () => {
  const sw = read('..', 'public', 'sw.js');
  it('push で showNotification（題はアプリ名・既存のアイコン）、押すと / を開く。キャッシュしない', () => {
    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain('showNotification(APP_NAME');
    expect(sw).toContain(`const APP_NAME = '${require('../lib/appName').DEFAULT_APP_NAME}'`);
    expect(sw).toContain("const ICON = '/favicon.svg'");
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'public', 'favicon.svg'))).toBe(true);
    expect(sw).toContain("addEventListener('notificationclick'");
    expect(sw).toContain("openWindow('/')");
    expect(sw).not.toMatch(/caches\.|addEventListener\('fetch'/);
  });
  it('設定: スイッチ 1 つ・1 行の説明・拒否の文。開いた時は状態を見るだけ', () => {
    const s = read('app', 'settings.tsx');
    expect(s).toContain('<Switch');
    // 通知の 1 つと、Android だけの「他のアプリを開けなくする」（#300）の 1 つ
    expect(s.split('<Switch').length).toBe(3);
    expect(s).toContain('COPY_PUSH_HINT');
    expect(s).toContain('COPY_PUSH_DENIED');
    // 使えない端末では見出しだけが空で残らないよう、1 行の文を出す（#355）
    expect(s).toContain("push === 'hidden' ? (");
    expect(s).toContain('COPY_PUSH_UNAVAILABLE');
    // 焦りの強さは全員「強め」固定（11/9）。スイッチを入れても強さは変えない
    expect(s).not.toContain('nudgeAfterEnable(me.nudgeLevel)');
    // 許可の窓（enablePush）はスイッチを押した時の関数の中だけ
    const toggle = s.indexOf('async function togglePush');
    expect(toggle).toBeGreaterThan(0);
    expect(s.indexOf('enablePush(b, api)')).toBeGreaterThan(toggle);
    expect(s.indexOf('useEffect(', 0)).toBeLessThan(toggle);
    expect(s.slice(s.indexOf('useEffect(', 0), toggle)).not.toContain('enablePush(');
    expect(copy.COPY_PUSH_HINT).toBe('取り組みの合図を、夜 9 時までに 1 日 2 通まで');
    expect(copy.COPY_PUSH_DENIED).toBe('ブラウザの設定で通知を許可してください');
  });
});
