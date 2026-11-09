// 招待コードでのログイン（契約 §1・§3.0・サーバーの AUTH_MODE=invite）。real モードだけで使う。
// 起動時に GET /api/health で方式を知る: invite ならトークン（端末に保存）を Bearer で送る。fake なら今までどおり x-dev-user。
// 保存先は注入できる形にして（試験・AsyncStorage に依存しない）、実物の結び付けは api/index.ts。

import { ApiError, errorFromBody, errorText } from './errors';

export type AuthKind = 'invite' | 'fake' | 'real';
export type AuthStatus = 'loading' | 'login' | 'ready';

export const TOKEN_KEY = 'inviteToken.v1';
export const NAME_MAX = 30;

export interface TokenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// health の応答から方式を決める。auth が無い（古いサーバー）・知らない値は今までどおり（fake 扱い）。
export function authKindOf(health: unknown): AuthKind {
  const a = (health as { auth?: unknown } | null)?.auth;
  return a === 'invite' ? 'invite' : a === 'real' ? 'real' : 'fake';
}

// ログイン画面の入力検査（空の名前・コードは送らない）。名前は前後の空白を落として 1〜30 文字。
export function checkLoginInput(name: string, code: string): { ok: true; name: string; code: string } | { ok: false } {
  const n = name.trim();
  const c = code.trim();
  if (n.length < 1 || n.length > NAME_MAX || c.length < 1) return { ok: false };
  return { ok: true, name: n, code: c };
}

// ログイン画面に出す 1 行。
export function loginErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_code') return 'コードが違います';
    if (e.code === 'rate_limited') return 'しばらくしてからもう一度';
    if (e.code === 'unauthenticated') return 'Google でログインできませんでした';
  }
  return errorText(e);
}

export interface AuthSessionDeps {
  baseUrl: string;
  storage: TokenStorage;
  fetchImpl?: typeof fetch;
}

export interface AuthSession {
  // 方式（初回だけ health を呼ぶ。つながらなければ network で投げ、次の呼び出しで取り直す）
  kind(): Promise<AuthKind>;
  token(): Promise<string | null>;
  // 同期で見る用（画面）
  hasToken(): boolean;
  getStatus(): AuthStatus;
  subscribe(listener: () => void): () => void;
  // 起動時に 1 回。invite でトークンが無ければ 'login'、それ以外は 'ready'
  init(): Promise<void>;
  login(name: string, code: string): Promise<void>;
  // Google の ID トークンで入る（契約 §3.0b）
  loginGoogle(credential: string): Promise<void>;
  // トークンを捨ててログイン画面へ（ログアウトと、401 を受けた時の 1 か所）
  signOut(): Promise<void>;
}

export function createAuthSession(deps: AuthSessionDeps): AuthSession {
  const base = deps.baseUrl.replace(/\/+$/, '');
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const listeners = new Set<() => void>();

  let status: AuthStatus = 'loading';
  let kindCache: Promise<AuthKind> | null = null;
  let tokenCache: Promise<string | null> | null = null;
  let tokenNow: string | null = null; // 同期で見る用の写し

  const setStatus = (s: AuthStatus) => {
    if (status === s) return;
    status = s;
    listeners.forEach((l) => l());
  };

  const loadToken = () => {
    if (!tokenCache) {
      tokenCache = (async () => {
        try {
          tokenNow = (await deps.storage.getItem(TOKEN_KEY)) || null;
        } catch {
          tokenNow = null; // 読めない時はログインし直し
        }
        return tokenNow;
      })();
    }
    return tokenCache;
  };

  const kind = () => {
    if (!kindCache) {
      const p = (async () => {
        let res: Response;
        try {
          res = await doFetch(`${base}/api/health`, { method: 'GET', headers: { accept: 'application/json' } });
        } catch {
          throw new ApiError(0, 'network', '');
        }
        let body: unknown = null;
        try {
          body = JSON.parse(await res.text());
        } catch {
          // 読めない応答は今までどおり（fake 扱い）
        }
        return res.ok ? authKindOf(body) : 'fake';
      })();
      kindCache = p;
      p.catch(() => {
        if (kindCache === p) kindCache = null; // 失敗は覚えない
      });
    }
    return kindCache;
  };

  async function signOut() {
    tokenCache = Promise.resolve(null);
    tokenNow = null;
    try {
      await deps.storage.removeItem(TOKEN_KEY);
    } catch {
      // 消せなくても、この起動の間は使わない
    }
    setStatus('login');
  }

  // 招待コードと Google で共通: 送って、受け取ったトークンを保存して ready
  async function postLogin(path: string, payload: Record<string, string>) {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new ApiError(0, 'network', '');
    }
    const text = await res.text();
    if (!res.ok) throw errorFromBody(res.status, text);
    let token: unknown;
    try {
      token = (JSON.parse(text) as { token?: unknown }).token;
    } catch {
      token = undefined;
    }
    if (typeof token !== 'string' || token === '') throw new ApiError(res.status, 'internal', '');
    tokenCache = Promise.resolve(token);
    tokenNow = token;
    try {
      await deps.storage.setItem(TOKEN_KEY, token);
    } catch {
      // 保存できなくても、この起動の間は使える
    }
    setStatus('ready');
  }

  return {
    kind,
    token: loadToken,
    hasToken: () => tokenNow !== null,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async init() {
      try {
        if ((await kind()) === 'invite') {
          setStatus((await loadToken()) ? 'ready' : 'login');
          return;
        }
      } catch {
        // つながらない時は画面を出す（各画面が「つながりません」を出す。次の呼び出しで方式を取り直す）
      }
      setStatus('ready');
    },

    login: (name, code) => postLogin('/api/login', { name, code }),
    // Google の ID トークン（credential）は送るだけで保存しない
    loginGoogle: (credential) => postLogin('/api/login/google', { credential }),

    signOut,
  };
}
