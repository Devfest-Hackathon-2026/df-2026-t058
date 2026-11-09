import { authKindOf, checkLoginInput, createAuthSession, loginErrorText, TOKEN_KEY, type TokenStorage } from '../api/auth';
import { ApiError } from '../api/errors';
import { createHttpApi } from '../api/http';

// 値は本物の形で書かず、実行時に組み立てる
const tok = () => ['t', Math.random().toString(36).slice(2), 'x'].join('.');

type Call = { url: string; init: RequestInit };

// URL ごとに応答を返す偽の fetch
function router(routes: Record<string, { status: number; body: unknown } | Error>, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = routes[new URL(url, 'http://x').pathname];
    if (!r) throw new Error(`no route ${url}`);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) } as Response;
  }) as unknown as typeof fetch;
}

function memoryStorage(initial: Record<string, string> = {}): TokenStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => {
      data[k] = v;
    },
    removeItem: async (k) => {
      delete data[k];
    },
  };
}

const HEALTH_INVITE = { status: 200, body: { ok: true, auth: 'invite', loginRequired: true } };
const HEALTH_FAKE = { status: 200, body: { ok: true, auth: 'fake' } };
const UNAUTH = { status: 401, body: { error: { code: 'unauthenticated', message: 'ログインが必要です' } } };

function setup(routes: Record<string, { status: number; body: unknown } | Error>, stored: Record<string, string> = {}) {
  const calls: Call[] = [];
  const fetchImpl = router(routes, calls);
  const storage = memoryStorage(stored);
  const session = createAuthSession({ baseUrl: 'http://api.test/', storage, fetchImpl });
  const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', auth: session, fetchImpl });
  return { calls, storage, session, api };
}

const headersOf = (c: Call | undefined) => (c?.init.headers ?? {}) as Record<string, string>;

describe('方式の切り替え（health）', () => {
  test('authKindOf: invite／real／fake。auth が無い古いサーバーは今までどおり fake', () => {
    expect(authKindOf({ ok: true, auth: 'invite', loginRequired: true })).toBe('invite');
    expect(authKindOf({ ok: true, auth: 'real' })).toBe('real');
    expect(authKindOf({ ok: true, auth: 'fake' })).toBe('fake');
    expect(authKindOf({ ok: true })).toBe('fake');
    expect(authKindOf(null)).toBe('fake');
    expect(authKindOf({ auth: 'other' })).toBe('fake');
  });

  test('invite なら Authorization: Bearer を付け、x-dev-user は付けない', async () => {
    const t = tok();
    const { api, calls } = setup({ '/api/health': HEALTH_INVITE, '/api/me': { status: 200, body: { id: 'u_1' } } }, { [TOKEN_KEY]: t });
    await api.me();
    const me = calls.find((c) => c.url.endsWith('/api/me'));
    expect(headersOf(me).authorization).toBe(`Bearer ${t}`);
    expect(headersOf(me)['x-dev-user']).toBeUndefined();
  });

  test('fake なら今までどおり x-dev-user（トークンは付けない）', async () => {
    const { api, calls } = setup({ '/api/health': HEALTH_FAKE, '/api/me': { status: 200, body: { id: 'u_1' } } }, { [TOKEN_KEY]: tok() });
    await api.me();
    const me = calls.find((c) => c.url.endsWith('/api/me'));
    expect(headersOf(me)['x-dev-user']).toBe('dev-abc');
    expect(headersOf(me).authorization).toBeUndefined();
  });

  test('方式は 1 回だけ取る。つながらなかった時は覚えず、次に取り直す', async () => {
    const calls: Call[] = [];
    const routes: Record<string, { status: number; body: unknown } | Error> = { '/api/health': new TypeError('offline') };
    const session = createAuthSession({ baseUrl: 'http://api.test', storage: memoryStorage(), fetchImpl: router(routes, calls) });
    await expect(session.kind()).rejects.toMatchObject({ code: 'network' });
    routes['/api/health'] = HEALTH_INVITE;
    await expect(session.kind()).resolves.toBe('invite');
    await session.kind();
    expect(calls).toHaveLength(2);
  });

  test('health 自体には認証のヘッダを付けない', async () => {
    const { api, calls } = setup({ '/api/health': HEALTH_INVITE });
    await api.health();
    expect(headersOf(calls[calls.length - 1]).authorization).toBeUndefined();
    expect(headersOf(calls[calls.length - 1])['x-dev-user']).toBeUndefined();
  });
});

describe('401 でトークンを捨てる', () => {
  test('unauthenticated を受けたら保存したトークンを捨ててログイン画面の状態になる', async () => {
    const { api, session, storage } = setup({ '/api/health': HEALTH_INVITE, '/api/home': UNAUTH }, { [TOKEN_KEY]: tok() });
    await session.init();
    expect(session.getStatus()).toBe('ready');
    await expect(api.home()).rejects.toMatchObject({ status: 401 });
    expect(storage.data[TOKEN_KEY]).toBeUndefined();
    expect(session.hasToken()).toBe(false);
    expect(session.getStatus()).toBe('login');
  });

  test('invalid_token も同じ。403 や 500 では捨てない', async () => {
    const bad = { status: 401, body: { error: { code: 'invalid_token', message: '' } } };
    const a = setup({ '/api/health': HEALTH_INVITE, '/api/home': bad }, { [TOKEN_KEY]: tok() });
    await a.api.home().catch(() => undefined);
    expect(a.storage.data[TOKEN_KEY]).toBeUndefined();

    for (const status of [403, 500]) {
      const b = setup({ '/api/health': HEALTH_INVITE, '/api/home': { status, body: { error: { code: 'forbidden', message: '' } } } }, { [TOKEN_KEY]: tok() });
      await b.api.home().catch(() => undefined);
      expect(b.storage.data[TOKEN_KEY]).toBeDefined();
    }
  });

  test('fake の 401 ではトークンにも状態にも触らない', async () => {
    const t = tok();
    const { api, session, storage } = setup({ '/api/health': HEALTH_FAKE, '/api/home': UNAUTH }, { [TOKEN_KEY]: t });
    await api.home().catch(() => undefined);
    expect(storage.data[TOKEN_KEY]).toBe(t);
    expect(session.getStatus()).toBe('loading');
  });

  test('トークンが無いまま呼ぶと、サーバーへは送らずに 401 とログイン画面の状態', async () => {
    const { api, session, calls } = setup({ '/api/health': HEALTH_INVITE, '/api/home': { status: 200, body: {} } });
    await expect(api.home()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(calls.some((c) => c.url.endsWith('/api/home'))).toBe(false);
    expect(session.getStatus()).toBe('login');
  });
});

describe('起動と ログイン／ログアウト', () => {
  test('init: invite でトークンあり→ready、なし→login。fake→ready。つながらない→ready', async () => {
    const a = setup({ '/api/health': HEALTH_INVITE }, { [TOKEN_KEY]: tok() });
    await a.session.init();
    expect(a.session.getStatus()).toBe('ready');

    const b = setup({ '/api/health': HEALTH_INVITE });
    await b.session.init();
    expect(b.session.getStatus()).toBe('login');

    const c = setup({ '/api/health': HEALTH_FAKE });
    await c.session.init();
    expect(c.session.getStatus()).toBe('ready');

    const d = setup({ '/api/health': new TypeError('offline') });
    await d.session.init();
    expect(d.session.getStatus()).toBe('ready');
  });

  test('login: 名前とコードを送り、受け取ったトークンを保存して ready。以後の呼び出しに使う', async () => {
    const t = tok();
    const { session, storage, calls, api } = setup({
      '/api/health': HEALTH_INVITE,
      '/api/login': { status: 200, body: { token: t, user: { id: 'u_1' } } },
      '/api/me': { status: 200, body: { id: 'u_1' } },
    });
    await session.init();
    expect(session.getStatus()).toBe('login');
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.getStatus()));
    await session.login('はると', 'code-value');
    const login = calls.find((c) => c.url.endsWith('/api/login'));
    expect(login?.init.method).toBe('POST');
    expect(JSON.parse(String(login?.init.body))).toEqual({ name: 'はると', code: 'code-value' });
    expect(headersOf(login).authorization).toBeUndefined();
    expect(storage.data[TOKEN_KEY]).toBe(t);
    expect(seen).toEqual(['ready']);
    await api.me();
    expect(headersOf(calls[calls.length - 1]).authorization).toBe(`Bearer ${t}`);
  });

  test('login の失敗: コード違い／回数超過は 1 行の文。トークンは保存しない。ログイン画面のまま', async () => {
    const wrong = setup({
      '/api/health': HEALTH_INVITE,
      '/api/login': { status: 401, body: { error: { code: 'invalid_code', message: 'コードが違います' } } },
    });
    await wrong.session.init();
    const e1 = await wrong.session.login('a', 'b').catch((e) => e);
    expect(e1).toBeInstanceOf(ApiError);
    expect(loginErrorText(e1)).toBe('コードが違います');
    expect(wrong.storage.data[TOKEN_KEY]).toBeUndefined();
    expect(wrong.session.getStatus()).toBe('login');

    const limited = setup({
      '/api/health': HEALTH_INVITE,
      '/api/login': { status: 429, body: { error: { code: 'rate_limited', message: 'x' } } },
    });
    const e2 = await limited.session.login('a', 'b').catch((e) => e);
    expect(loginErrorText(e2)).toBe('しばらくしてからもう一度');
    expect(loginErrorText(new ApiError(0, 'network', ''))).toBe('ネットにつながっていません。つながってから、もう一度');
    expect(loginErrorText(new Error('x'))).toBe('うまくいきませんでした');
  });

  test('login の応答にトークンが無ければ失敗（何も保存しない）', async () => {
    const { session, storage } = setup({ '/api/health': HEALTH_INVITE, '/api/login': { status: 200, body: {} } });
    await expect(session.login('a', 'b')).rejects.toMatchObject({ code: 'internal' });
    expect(storage.data[TOKEN_KEY]).toBeUndefined();
  });

  test('signOut: トークンを捨てて login。そのあとの呼び出しはサーバーへ送らない', async () => {
    const { session, storage, api, calls } = setup({ '/api/health': HEALTH_INVITE, '/api/me': { status: 200, body: {} } }, { [TOKEN_KEY]: tok() });
    await session.init();
    await session.signOut();
    expect(storage.data[TOKEN_KEY]).toBeUndefined();
    expect(session.getStatus()).toBe('login');
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(calls.some((c) => c.url.endsWith('/api/me'))).toBe(false);
  });
});

describe('ログイン画面の入力検査', () => {
  test('空の名前・空のコードは送らない。前後の空白は落とす', () => {
    expect(checkLoginInput('', 'code')).toEqual({ ok: false });
    expect(checkLoginInput('   ', 'code')).toEqual({ ok: false });
    expect(checkLoginInput('はると', '')).toEqual({ ok: false });
    expect(checkLoginInput('はると', '  ')).toEqual({ ok: false });
    expect(checkLoginInput('あ'.repeat(31), 'code')).toEqual({ ok: false });
    expect(checkLoginInput('  はると ', ' code ')).toEqual({ ok: true, name: 'はると', code: 'code' });
    expect(checkLoginInput('あ'.repeat(30), 'c')).toMatchObject({ ok: true });
  });
});
