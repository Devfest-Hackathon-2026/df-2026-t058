declare const require: (name: string) => any;
declare const __dirname: string;

import { createAuthSession, loginErrorText, TOKEN_KEY } from '../api/auth';
import { ApiError } from '../api/errors';
import { COPY_INVITE_LOGIN } from '../lib/copy';
import { BUTTON_OPTIONS, credentialOf, renderSignInButton, showGoogleSignIn } from '../lib/googleSignIn';

// Google でログイン（#213）。値は本物の形で書かず、実行時に組み立てる
const cred = () => ['h', Math.random().toString(36).slice(2), 's'].join('.');
const tok = () => ['t', Math.random().toString(36).slice(2), 'x'].join('.');

describe('credentialOf / showGoogleSignIn', () => {
  test('credential が文字列で空でない時だけ取り出す', () => {
    const c = cred();
    expect(credentialOf({ credential: c })).toBe(c);
    for (const r of [null, undefined, {}, { credential: '' }, { credential: 5 }]) expect(credentialOf(r)).toBeNull();
  });
  test('Web でクライアント ID がある時だけ', () => {
    expect(showGoogleSignIn('web', 'id-x')).toBe(true);
    expect(showGoogleSignIn('ios', 'id-x')).toBe(false);
    expect(showGoogleSignIn('web', null)).toBe(false);
  });
});

describe('renderSignInButton', () => {
  test('initialize と renderButton を呼び、押された credential を渡す', async () => {
    let cb: ((r: { credential?: string }) => void) | null = null;
    const rendered: unknown[] = [];
    const google = {
      accounts: {
        oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) },
        id: {
          initialize: (c: { client_id: string; callback: (r: { credential?: string }) => void }) => {
            expect(c.client_id).toBe('id-x');
            cb = c.callback;
          },
          renderButton: (el: unknown, opts: Record<string, unknown>) => rendered.push(el, opts),
        },
      },
    };
    const got: string[] = [];
    const el = {};
    expect(await renderSignInButton('id-x', el, (c) => got.push(c), async () => google)).toBe(true);
    expect(rendered[0]).toBe(el);
    expect(rendered[1]).toEqual({ ...BUTTON_OPTIONS, locale: 'ja' });
    const c = cred();
    (cb as unknown as (r: { credential?: string }) => void)({ credential: c });
    (cb as unknown as (r: { credential?: string }) => void)({});
    expect(got).toEqual([c]);
  });
  test('読み込めない・id が無い・置き場が無い時は false', async () => {
    expect(await renderSignInButton('id-x', {}, () => {}, async () => Promise.reject(new Error('x')))).toBe(false);
    const noId = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    expect(await renderSignInButton('id-x', {}, () => {}, async () => noId)).toBe(false);
  });
});

describe('session.loginGoogle', () => {
  test('credential を /api/login/google に送り、トークンを保存して ready（credential は保存しない）', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const t = tok();
    const data: Record<string, string> = {};
    const session = createAuthSession({
      baseUrl: 'http://api.test',
      storage: { getItem: async (k) => data[k] ?? null, setItem: async (k, v) => void (data[k] = v), removeItem: async (k) => void delete data[k] },
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => JSON.stringify({ token: t, user: { id: 'u_1' } }) } as Response;
      }) as unknown as typeof fetch,
    });
    const c = cred();
    await session.loginGoogle(c);
    expect(calls[0]?.url).toBe('http://api.test/api/login/google');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ credential: c });
    expect(data).toEqual({ [TOKEN_KEY]: t });
    expect(session.getStatus()).toBe('ready');
  });
  test('401 は理由を言わない 1 行', () => {
    expect(loginErrorText(new ApiError(401, 'unauthenticated', ''))).toBe('Google でログインできませんでした');
  });
});

describe('ログイン画面', () => {
  const fs = require('fs');
  const path = require('path');
  const screen: string = fs.readFileSync(path.join(__dirname, '..', 'app', 'login.tsx'), 'utf8');
  test('Google のボタンは Web で ID がある時だけ、その下に小さく「招待コードで入る」、招待コードの欄は残す', () => {
    expect(COPY_INVITE_LOGIN).toBe('招待コードで入る');
    expect(screen).toMatch(/showGoogleSignIn\(Platform\.OS, googleClientId\)/);
    const g = screen.indexOf('nativeID="login-google"');
    const inv = screen.indexOf('COPY_INVITE_LOGIN}', g);
    const code = screen.indexOf('testID="login-code"', inv);
    expect(g).toBeGreaterThan(0);
    expect(inv).toBeGreaterThan(g);
    expect(code).toBeGreaterThan(inv);
    expect(screen).toContain('session.loginGoogle(credential)');
  });
});
