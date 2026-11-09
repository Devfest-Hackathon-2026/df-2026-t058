// 集中中の時計と「離れた／戻った」の送信。アプリ全体で 1 つ（画面が閉じても続く）。
// 中身は focusTracker.ts（試験はそちら）。ここは本物の API・AppState・端末の保存をつなぐだけ。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { api } from '../api';
import { createFocusTracker, type SavedFocus } from './focusTracker';

const KEY = 'focusClock.v1';

export const focusTracker = createFocusTracker({
  sendEvent: (sessionId, type) => api.sendEvent(sessionId, type),
  appState: AppState,
  load: async () => {
    const v = await AsyncStorage.getItem(KEY);
    return v ? (JSON.parse(v) as SavedFocus) : null;
  },
  save: async (v) => {
    if (v) await AsyncStorage.setItem(KEY, JSON.stringify(v));
    else await AsyncStorage.removeItem(KEY);
  },
});
