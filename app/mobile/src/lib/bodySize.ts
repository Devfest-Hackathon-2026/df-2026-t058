// 送る本文の大きさ（JSON にした時のバイト数）。振り返りは写真つきで上限 6MB（contract-changes §3）。
// 契約の「6MB」が MiB か MB か決まっていないので、小さい方（6,000,000 バイト）で見る（仮）。

export const MAX_REFLECT_BODY_BYTES = 6_000_000;

// 文字列の UTF-8 でのバイト数。
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// 写真（base64＝ASCII）は長さをそのまま足し、残りだけ UTF-8 で数える（大きな文字列を 1 字ずつ回さない）。
export function reflectBodyBytes(body: {
  images: { mimeType: string; dataBase64: string }[];
  audio?: { mimeType: string; dataBase64: string };
}): number {
  const images = body.images.reduce((a, img) => a + img.dataBase64.length, 0) + (body.audio?.dataBase64.length ?? 0);
  const rest = JSON.stringify({
    ...body,
    images: body.images.map((img) => ({ ...img, dataBase64: '' })),
    ...(body.audio ? { audio: { ...body.audio, dataBase64: '' } } : {}),
  });
  return images + utf8Bytes(rest);
}
