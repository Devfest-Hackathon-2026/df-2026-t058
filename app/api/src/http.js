// HTTP の共通部品（契約 §2 のエラー形式）。
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const BODY_LIMIT = 64 * 1024; // 契約 §2: 413 too_large（経路ごとの上限は router.add の opts.bodyLimit）
// 上限を超えた後も、ここまでは読み捨てて（溜めない）から 413 を返す。
// 送り終える前に接続を閉じると、相手には 413 でなく「つながらない」（EPIPE）に見えるため。これを超えたら接続を切る。
const DRAIN_MAX = 8 * 1024 * 1024;

export async function readJson(req, limit = BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (over) {
      if (size > limit + DRAIN_MAX) {
        req.destroy();
        break;
      }
      continue;
    }
    if (size > limit) {
      over = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }
  if (over) throw new HttpError(413, 'too_large', '本文が大きすぎます');
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_argument', 'JSON として読めません');
  }
}

// CORS（開発用・Web の開発サーバーなど別の origin から呼ぶ時）。
// 環境変数 CORS_ORIGINS（カンマ区切り）に完全一致する Origin にだけ許可を返す。既定は空＝付けない。
// '*' や 'null' は書かれていても許さない（誰からでも呼べる状態にしない）。
export const CORS_ALLOW_METHODS = 'GET, POST, PUT';
export const CORS_ALLOW_HEADERS = 'content-type, x-dev-user, authorization';
const CORS_MAX_AGE_SEC = 600;

export function parseCorsOrigins(raw) {
  if (Array.isArray(raw)) raw = raw.join(',');
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '*' && s !== 'null');
}

// 応答に付ける CORS のヘッダ。許可しない時は Vary だけ（キャッシュが Origin ごとに分かれるように）。
export function corsHeaders(allowed, origin, { preflight = false } = {}) {
  if (allowed.length === 0) return {};
  const headers = { vary: 'Origin' };
  if (typeof origin !== 'string' || !allowed.includes(origin)) return headers;
  headers['access-control-allow-origin'] = origin;
  if (preflight) {
    headers['access-control-allow-methods'] = CORS_ALLOW_METHODS;
    headers['access-control-allow-headers'] = CORS_ALLOW_HEADERS;
    headers['access-control-max-age'] = String(CORS_MAX_AGE_SEC);
  }
  return headers;
}

export function send(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

// 想定外のエラーは中身（スタック・パス等）を返さない（契約 §2・500）。
export function sendError(res, err) {
  if (err instanceof HttpError) {
    const headers = err.status === 413 ? { connection: 'close' } : {};
    return send(res, err.status, { error: { code: err.code, message: err.message } }, headers);
  }
  console.error('internal error:', err);
  return send(res, 500, { error: { code: 'internal', message: 'サーバー側の失敗です' } });
}
