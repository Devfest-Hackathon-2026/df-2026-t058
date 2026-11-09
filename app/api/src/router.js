import { HttpError } from './http.js';

// 最小の経路表。各機能は register(router, ctx) の中で add() するだけ。
// 例: router.add('POST', '/api/goals', async ({ req, userId, body, ctx }) => ({ status: 201, body: {...} }))
// ハンドラは { status, body } を返すか、HttpError を投げる。
export function createRouter() {
  const routes = [];

  function compile(path) {
    const names = [];
    const re = path.replace(/:([A-Za-z]\w*)/g, (_, n) => {
      names.push(n);
      return '([^/]+)';
    });
    return { re: new RegExp(`^${re}$`), names };
  }

  return {
    // opts.auth=false で認証不要（既定は必要）。
    // opts.bodyLimit で本文の上限（バイト）を経路ごとに変える。無ければ既定（http.js の BODY_LIMIT＝64KB）。
    add(method, path, handler, opts = {}) {
      const { bodyLimit } = opts;
      if (bodyLimit !== undefined && !(Number.isInteger(bodyLimit) && bodyLimit > 0)) {
        throw new Error(`bodyLimit は正の整数（バイト）にしてください: ${method} ${path}`);
      }
      routes.push({ method, ...compile(path), handler, auth: opts.auth !== false, bodyLimit });
    },
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = {};
        r.names.forEach((n, i) => {
          // 壊れた % の並び（例: %E0）は URIError になる。500 にせず 400 で返す（スタックをログに出さない）。
          try {
            params[n] = decodeURIComponent(m[i + 1]);
          } catch {
            throw new HttpError(400, 'invalid_argument', 'パスが正しくありません');
          }
        });
        return { handler: r.handler, params, auth: r.auth, bodyLimit: r.bodyLimit };
      }
      return null;
    },
  };
}
