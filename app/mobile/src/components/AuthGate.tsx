// 招待コードでのログイン（real モードで、サーバーが invite の時だけ）。
// 起動時に方式を確かめ、トークンが無い・捨てられた（401 かログアウト）時はログイン画面へ戻す。見た目は無い。

import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { session } from '../api';

const never = () => () => undefined;

export function AuthGate() {
  const navReady = !!useRootNavigationState()?.key;
  const status = useSyncExternalStore(session ? session.subscribe : never, () => session?.getStatus() ?? 'ready');

  useEffect(() => {
    void session?.init();
  }, []);

  useEffect(() => {
    if (navReady && status === 'login') router.replace('/login');
  }, [navReady, status]);

  return null;
}
