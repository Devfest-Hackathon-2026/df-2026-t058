import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

// Web Push の本文の暗号化（RFC 8291・Content-Encoding: aes128gcm（RFC 8188）の 1 レコード）。
// uaPublic: 端末の p256dh（65 バイト）・authSecret: 端末の auth（16 バイト）。
// asPrivate・salt は試験（RFC 8291 付録 A）のためだけに渡す。普段は毎回新しく作る。
const RS = 4096;

const hkdf = (ikm, salt, info, len) => Buffer.from(hkdfSync('sha256', ikm, salt, info, len));

export function encryptPayload(plaintext, uaPublic, authSecret, { asPrivate, salt = randomBytes(16) } = {}) {
  const ecdh = createECDH('prime256v1');
  if (asPrivate) ecdh.setPrivateKey(asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // 非圧縮 65 バイト
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const body = Buffer.from(plaintext);
  if (body.length + 1 + 16 > RS) throw new Error('本文が長すぎます');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 最後のレコードは区切り 0x02 を付ける（詰め物なし）。
  const ct = Buffer.concat([cipher.update(Buffer.concat([body, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(RS, 16);
  head.writeUInt8(asPublic.length, 20);
  return Buffer.concat([head, asPublic, ct]);
}
