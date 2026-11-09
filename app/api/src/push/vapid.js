import { createPrivateKey, sign } from 'node:crypto';

// VAPID（RFC 8292）: push サービスに「この送り手です」と示す ES256 の JWT。
// 鍵は base64url（公開鍵＝65 バイトの点 0x04||x||y、秘密鍵＝32 バイトの d）。値はログに出さない。
export const VAPID_TTL_SEC = 12 * 3600;

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64u = (s) => Buffer.from(String(s), 'base64url');

export function vapidKeyObject(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  const d = fromB64u(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error('VAPID の鍵の形が違います');
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)), d: b64u(d) },
    format: 'jwk',
  });
}

// Authorization ヘッダの値（vapid t=<JWT>, k=<公開鍵>）。aud は endpoint の origin、有効 12 時間。
export function vapidAuthorization({ endpoint, publicKey, privateKey, subject, now = new Date() }) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + VAPID_TTL_SEC,
    sub: subject,
  };
  const data = `${header}.${b64u(JSON.stringify(claims))}`;
  const sig = sign('sha256', Buffer.from(data), { key: vapidKeyObject(publicKey, privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${publicKey}`;
}
