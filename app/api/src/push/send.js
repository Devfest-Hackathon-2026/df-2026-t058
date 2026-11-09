import { encryptPayload } from './encrypt.js';
import { fromB64u, vapidAuthorization } from './vapid.js';

// 1 端末へ送る。結果は 'ok'（届いた）／'gone'（404・410＝登録を消す）／'failed'（ほかの失敗＝数えるだけ）。
// 本文・endpoint・鍵はログに出さない（例外の中身も外へ出さない）。
export const PUSH_TTL_SEC = 4 * 3600;

export async function sendPush({ sub, payload, vapid, fetchImpl = fetch, now = new Date() }) {
  try {
    const body = encryptPayload(JSON.stringify(payload), fromB64u(sub.p256dh), fromB64u(sub.auth));
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization({ endpoint: sub.endpoint, ...vapid, now }),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(PUSH_TTL_SEC),
        Urgency: 'normal',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}
