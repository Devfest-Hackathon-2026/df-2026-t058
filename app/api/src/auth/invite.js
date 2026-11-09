import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http.js';

// 招待コード方式の認証（AUTH_MODE=invite・契約 §1・本人 11/6）。Firebase のログインを入れるまでの仮。
// 純粋な関数（名前→ID・トークンの署名と検証・コードの比較）と、小さな窓口（createInviteAuth）に分ける。
// 秘密（TEAM_CODE・SESSION_SECRET）の値は、例外の文にもログにも出さない。

export const TEAM_CODE_MIN = 8;
export const SESSION_SECRET_MIN = 32;
export const DEFAULT_TOKEN_TTL_HOURS = 72;
export const NAME_MAX = 30;

// 総当たり対策（失敗だけを数える。成功しても戻さない）
export const LOGIN_WINDOW_MS = 5 * 60 * 1000;
export const LOGIN_FAIL_PER_IP = 5;
export const LOGIN_FAIL_TOTAL = 30;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest();
const hmac = (secret, data) => createHmac('sha256', secret).update(data, 'utf8').digest();
const USER_ID_RE = /^u_[A-Za-z0-9_-]{22}$/;
const TOKEN_MAX_LENGTH = 1024;
// 署名の部分は HMAC-SHA256（32 バイト）の base64url＝ちょうど 43 文字。
// Node の base64url の読み取りは知らない文字を読み飛ばすため、形を先に決めておく（同じ署名の別の書き方を通さない）。
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

// 名前の正規化: NFKC → 前後の空白除去 → 小文字化。同じ名前なら同じ人として扱う。
export function normalizeName(name) {
  return String(name).normalize('NFKC').trim().toLowerCase();
}

// userId は名前から決める（別の端末でも同じ人。チーム内の信頼が前提）。
export function userIdFor(secret, name) {
  return `u_${b64u(hmac(secret, normalizeName(name))).slice(0, 22)}`;
}

// コードの比較。長さが違っても時間が変わらないよう、sha256 を取ってから timingSafeEqual。
export function codeMatches(expected, given) {
  return timingSafeEqual(sha256(expected), sha256(typeof given === 'string' ? given : ''));
}

// トークン = base64url(JSON {uid, exp(秒)}) + '.' + base64url(HMAC-SHA256(secret, 前半))
export function signToken(secret, uid, expSec) {
  const head = b64u(JSON.stringify({ uid, exp: expSec }));
  return `${head}.${b64u(hmac(secret, head))}`;
}

// 通れば uid、だめなら null（署名の不一致・期限切れ・形の崩れ）。
export function verifyToken(secret, token, nowSec) {
  if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [head, sig] = parts;
  if (!SIG_RE.test(sig)) return null;
  const want = hmac(secret, head);
  let got;
  try {
    got = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
  if (!USER_ID_RE.test(payload.uid) || !(nowSec < payload.exp)) return null;
  return payload.uid;
}

// Authorization ヘッダから Bearer のトークンを取り出す。
export function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const m = /^Bearer +(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

// 接続元。Cloud Run は x-forwarded-for の最後に接続元を付ける（前の値は送り手が書ける＝信用しない）。
// 無ければソケットの remoteAddress。
export function clientKey(req) {
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (typeof raw === 'string') {
    const last = raw.split(',').pop().trim();
    if (last) return last.slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

// 失敗の回数を数える窓（メモリ内・1 台の前提）。
export function createFailureCounter({ now, windowMs = LOGIN_WINDOW_MS, perKey = LOGIN_FAIL_PER_IP, total = LOGIN_FAIL_TOTAL }) {
  const byKey = new Map(); // key → 失敗した時刻（ms）の配列
  let all = []; // 全体の失敗した時刻

  const fresh = (list, t) => list.filter((x) => t - x < windowMs);

  function sweep(t) {
    all = fresh(all, t);
    for (const [k, list] of byKey) {
      const kept = fresh(list, t);
      if (kept.length === 0) byKey.delete(k);
      else byKey.set(k, kept);
    }
  }

  return {
    // 'ip' か 'total'（上限に達している）／null（まだ余裕がある）
    blocked(key) {
      const t = now();
      all = fresh(all, t);
      if (all.length >= total) return 'total';
      const list = fresh(byKey.get(key) || [], t);
      if (list.length === 0) byKey.delete(key);
      else byKey.set(key, list);
      return list.length >= perKey ? 'ip' : null;
    },
    fail(key) {
      const t = now();
      if (byKey.size > 1000) sweep(t); // 接続元を変えながらの攻撃で溜め込まない
      byKey.set(key, [...fresh(byKey.get(key) || [], t), t]);
      all = [...fresh(all, t), t];
    },
  };
}

// 窓口。起動時に設定を検査する（足りない・短い時は例外。値は文に出さない）。
export function createInviteAuth({ teamCode, sessionSecret, ttlHours, now = () => new Date(), log = (m) => console.warn(m) }) {
  if (typeof teamCode !== 'string' || teamCode.length < TEAM_CODE_MIN) {
    throw new Error(`AUTH_MODE=invite には TEAM_CODE（${TEAM_CODE_MIN} 文字以上）が要ります`);
  }
  if (typeof sessionSecret !== 'string' || sessionSecret.length < SESSION_SECRET_MIN) {
    throw new Error(`AUTH_MODE=invite には SESSION_SECRET（${SESSION_SECRET_MIN} 文字以上）が要ります`);
  }
  const ttl = ttlHours === undefined || ttlHours === '' ? DEFAULT_TOKEN_TTL_HOURS : Number(ttlHours);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('TOKEN_TTL_HOURS は 0 より大きい数にしてください');

  const nowMs = () => now().getTime();
  const failures = createFailureCounter({ now: nowMs });

  return {
    // 名前とコード → { token, userId }。違えば 401、失敗が多ければ 429。
    login({ name, code, key }) {
      const blockedBy = failures.blocked(key);
      if (blockedBy) {
        log(`login blocked (${blockedBy})`);
        throw new HttpError(429, 'rate_limited', 'しばらくしてからもう一度');
      }
      if (!codeMatches(teamCode, code)) {
        failures.fail(key);
        log('login failed (invalid_code)');
        throw new HttpError(401, 'invalid_code', 'コードが違います');
      }
      const userId = userIdFor(sessionSecret, name);
      const expSec = Math.floor(nowMs() / 1000) + Math.round(ttl * 3600);
      return { token: signToken(sessionSecret, userId, expSec), userId };
    },
    // Authorization ヘッダ → uid（だめなら null）
    authenticate(req) {
      const token = bearerToken(req.headers?.authorization);
      return token ? verifyToken(sessionSecret, token, Math.floor(nowMs() / 1000)) : null;
    },
  };
}
