// ノートの写真を送る前に縮めて JPEG にする。
// 契約（contract-changes §3）は 1 枚 1.5MB・本文全体 6MB。1.5MiB を 3 枚 base64 にすると約 6.3MB になり、
// それだけで本文の上限を超えるので、端末では 1 枚 1.4MiB までに縮める（3 枚＋メモ＋資料で 6,000,000 バイト未満）。

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { ReflectImage } from '../api/types';

export const MAX_PHOTOS = 3;
export const MAX_BYTES = Math.floor(1.4 * 1024 * 1024);

// base64 の文字列が表すバイト数。
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

// 縮める段階: 長い辺の幅と JPEG の品質。上から順に試し、上限に収まった所で止める。
export const STEPS: { width: number; compress: number }[] = [
  { width: 1600, compress: 0.7 },
  { width: 1280, compress: 0.6 },
  { width: 1024, compress: 0.5 },
  { width: 800, compress: 0.4 },
];

export interface Shrinker {
  (uri: string, width: number, compress: number): Promise<string>; // base64 を返す
}

export async function shrinkToLimit(
  uri: string,
  shrink: Shrinker,
  originalWidth = 0,
  maxBytes = MAX_BYTES,
): Promise<string> {
  for (const s of STEPS) {
    // 元が小さい時は引き伸ばさない
    const width = originalWidth > 0 ? Math.min(s.width, originalWidth) : s.width;
    const b64 = await shrink(uri, width, s.compress);
    if (base64Bytes(b64) <= maxBytes) return b64;
  }
  throw new Error('too_large');
}

const shrinkWithExpo: Shrinker = async (uri, width, compress) => {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress, format: SaveFormat.JPEG, base64: true });
  if (!out.base64) throw new Error('no_base64');
  return out.base64;
};

export interface Photo {
  uri: string; // 表示用（縮めた後）
  image: ReflectImage;
}

export interface Picked {
  uri: string;
  width: number;
}

export async function preparePhoto(p: Picked): Promise<Photo> {
  const b64 = await shrinkToLimit(p.uri, shrinkWithExpo, p.width);
  return { uri: `data:image/jpeg;base64,${b64}`, image: { mimeType: 'image/jpeg', dataBase64: b64 } };
}

export const canUseCamera = Platform.OS !== 'web';

// 撮る／選ぶ。取り消したら空の配列。
export async function pickPhotos(mode: 'camera' | 'library', room: number): Promise<Picked[]> {
  if (room <= 0) return [];
  if (mode === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return [];
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    return r.canceled ? [] : r.assets.map((a) => ({ uri: a.uri, width: a.width })).slice(0, room);
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: room > 1,
    selectionLimit: room,
    quality: 1,
  });
  return r.canceled ? [] : r.assets.map((a) => ({ uri: a.uri, width: a.width })).slice(0, room);
}
