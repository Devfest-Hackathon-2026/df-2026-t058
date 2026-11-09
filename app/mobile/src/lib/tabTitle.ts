// Web のタブの文字。「建物 – モル塔」の形（ホームだけアプリ名のみ）。ネイティブでは何もしない。

import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_APP_NAME } from './appName';

export function tabTitleFor(screen: string | null, appName: string = DEFAULT_APP_NAME): string {
  const s = screen?.trim();
  return s ? `${s} – ${appName}` : appName;
}

// 画面が前面に来るたびに付け直す（Stack ではホームが閉じず、戻っても useEffect は再実行されないため。useLoad と同じ useFocusEffect）
export function useTabTitle(screen: string | null): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || typeof document === 'undefined') return;
      document.title = tabTitleFor(screen);
    }, [screen]),
  );
}
