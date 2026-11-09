import { createHmac, createPublicKey, verify } from 'node:crypto';
import { HttpError } from '../http.js';
import { createFailureCounter, DEFAULT_TOKEN_TTL_HOURS, NAME_MAX, signToken } from './invite.js';

// Google でログイン（契約 §3.0b・Issue #213）。依存なし: Google の公開鍵（JWK）で RS256 を node:crypto で検証する。
// ID トークン・メール・sub はログに出さない・保存しない（保存するのは sub から作った userId だけ）。

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CREDENTIAL_MAX = 4096;
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000; // Cache-Control が無い時
const REFETCH_MIN_MS = 60 * 1000; // 知らない kid での取り直しは 1 分に 1 回まで

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const B64U_RE = /^[A-Za-z0-9_-]+$/;

// userId = u_ + HMAC(SESSION_SECRET, "Google:" + sub) の先頭 22 文字。
// 招待コード方式の名前は正規化で小文字になる（大文字の G を含めない）ので、どんな名前とも衝突しない。
export function googleUserIdFor(secret, sub) {
  return `u_${b64u(createHmac('sha256', secret).update(`Google:${sub}`, 'utf8').digest()).slice(0, 22)}`;
}

// 表示名: given_name、無ければ name。前後の空白を落として 30 字まで。
export function googleDisplayName(payload) {
  const pick = [payload?.given_name, payload?.name].find((v) => typeof v === 'string' && v.trim());
  return pick ? Array.from(pick.trim()).slice(0, NAME_MAX).join('').trim() : '';
}

export function maxAgeMs(cacheControl) {
  const m = /max-age=(\d+)/i.exec(cacheControl || '');
  return m ? Number(m[1]) * 1000 : DEFAULT_KEYS_TTL_MS;
}

const parse = (part) => {
  if (!B64U_RE.test(part)) return null;
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

// 検証。通れば payload、だめなら null（理由は返さない）。getKey(kid) → JWK か null。
export async function verifyGoogleIdToken(credential, { clientId, getKey, nowSec }) {
  if (typeof credential !== 'string' || credential.length > CREDENTIAL_MAX) return null;
  const parts = credential.split('.');
  if (parts.length !== 3 || !B64U_RE.test(parts[2])) return null;
  const header = parse(parts[0]);
  const payload = parse(parts[1]);
  if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const jwk = await getKey(header.kid);
  if (!jwk) return null;
  let ok = false;
  try {
    const key = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
    ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch {
    return null;
  }
  if (!ok) return null;
  if (!GOOGLE_ISSUERS.includes(payload.iss)) return null;
  if (payload.aud !== clientId) return null;
  if (typeof payload.exp !== 'number' || !(nowSec < payload.exp)) return null;
  if (payload.email_verified !== true && payload.email_verified !== 'true') return null;
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) return null;
  return payload;
}

// 公開鍵の取得と、Cache-Control の間だけのメモリ保持。
export function createGoogleKeys({ fetchImpl = (u, i) => fetch(u, i), nowMs }) {
  let keys = null; // Map kid → JWK
  let until = 0;
  let fetchedAt = -Infinity;
  async function refresh() {
    fetchedAt = nowMs();
    const res = await fetchImpl(GOOGLE_CERTS_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`google certs ${res.status}`);
    const body = await res.json();
    keys = new Map((Array.isArray(body?.keys) ? body.keys : []).filter((k) => k?.kty === 'RSA' && typeof k.kid === 'string').map((k) => [k.kid, k]));
    until = fetchedAt + maxAgeMs(res.headers?.get?.('cache-control'));
  }
  return async function getKey(kid) {
    if (!keys || nowMs() >= until || (!keys.has(kid) && nowMs() - fetchedAt >= REFETCH_MIN_MS)) await refresh();
    return keys.get(kid) || null;
  };
}

// 窓口。clientId と sessionSecret は呼び出し側（index.js）が invite の検査を通した物を渡す。
export function createGoogleAuth({ clientId, sessionSecret, ttlHours, now = () => new Date(), fetchImpl, log = (m) => console.warn(m) }) {
  const nowMs = () => now().getTime();
  const ttl = ttlHours === undefined || ttlHours === '' ? DEFAULT_TOKEN_TTL_HOURS : Number(ttlHours);
  const failures = createFailureCounter({ now: nowMs });
  const getKey = createGoogleKeys({ fetchImpl, nowMs });
  const deny = () => new HttpError(401, 'unauthenticated', 'Google でログインできませんでした');

  return {
    // ID トークン → { token, userId, displayName }。だめなら 401（理由は言わない）、失敗が多ければ 429。
    async login({ credential, key }) {
      const blockedBy = failures.blocked(key);
      if (blockedBy) {
        log(`google login blocked (${blockedBy})`);
        throw new HttpError(429, 'rate_limited', 'しばらくしてからもう一度');
      }
      let payload = null;
      try {
        payload = await verifyGoogleIdToken(credential, { clientId, getKey, nowSec: Math.floor(nowMs() / 1000) });
      } catch {
        log('google login: certs unavailable'); // 鍵が取れない（Google 側）。本人の失敗としては数えない
        throw deny();
      }
      if (!payload) {
        failures.fail(key);
        log('google login failed');
        throw deny();
      }
      const userId = googleUserIdFor(sessionSecret, payload.sub);
      const expSec = Math.floor(nowMs() / 1000) + Math.round(ttl * 3600);
      return { token: signToken(sessionSecret, userId, expSec), userId, displayName: googleDisplayName(payload) };
    },
  };
}
