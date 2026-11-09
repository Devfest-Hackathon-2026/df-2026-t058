// 画面を開いた時（と戻ってきた時）に読み込む。失敗は短い文にする。

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { errorText } from '../api/errors';

export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const v = await run();
      if (alive.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [run]);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void reload();
      return () => {
        alive.current = false;
      };
    }, [reload]),
  );

  return { data, error, loading, reload, setData };
}
