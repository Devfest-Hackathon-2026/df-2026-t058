// URL の # 以降（例: "#code=abcd1234"）から招待コードを取り出す。画面から切り出して試験する。

export const INVITE_HASH_MAX = 200;

/** 取り出せなければ null。コードは URL デコードする。 */
export function codeFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== 'code') continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      return null;
    }
    if (value.length === 0 || value.length > INVITE_HASH_MAX) return null;
    return value;
  }
  return null;
}
