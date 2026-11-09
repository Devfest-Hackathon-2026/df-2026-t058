// 端末で一度だけ作る乱数の ID（x-dev-user に入れる仮の本人）。本物のログインが来たら使わない。

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY = 'devUserId.v1';
let cached: Promise<string> | null = null;

export function getDevUserId(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (saved) return saved;
      } catch {
        // 読めない時（Web の閉じた保存領域など）は、この起動の間だけの ID になる
      }
      const id = `dev-${Crypto.randomUUID()}`;
      try {
        await AsyncStorage.setItem(KEY, id);
      } catch {
        // 保存できなくても続ける
      }
      return id;
    })();
  }
  return cached;
}
