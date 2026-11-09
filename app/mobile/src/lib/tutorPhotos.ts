// 相談に付ける写真の決まり: 最大 2 枚（契約 §3.5）。写真は 1 回の質問にだけ使い、残さない。
// 入口は 1 つ。写真は常に付けられる（切り替えは無い）。

import type { ReflectImage, TutorRequest } from '../api/types';

export const MAX_TUTOR_PHOTOS = 2;

// 送る時の kind はここ 1 か所。サーバーが省略に対応したら undefined にして外す。
export const TUTOR_SEND_KIND: TutorRequest['kind'] = 'ask';

// 写真を足せる残りの枚数。
export function photoRoom(count: number): number {
  return Math.max(0, MAX_TUTOR_PHOTOS - count);
}

// 追加しても 2 枚を超えないように足す。
export function addPhotos<T>(current: T[], added: T[]): T[] {
  return [...current, ...added].slice(0, MAX_TUTOR_PHOTOS);
}

// 送る本文。写真は 1 枚以上ある時だけ載せる。
export function tutorBody(text: string, images: ReflectImage[]): TutorRequest {
  const base: TutorRequest = TUTOR_SEND_KIND ? { kind: TUTOR_SEND_KIND, text } : { text };
  return images.length === 0 ? base : { ...base, images: images.slice(0, MAX_TUTOR_PHOTOS) };
}
