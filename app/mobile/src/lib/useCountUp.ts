// 数字が増えていく動き（0.6 秒・終わりにゆっくり）。画面を開いた直後と、値が変わった時にだけ動く。
// 値がまだ無い（読み込み中）間は動かさない。「動きを減らす」がオンなら、すぐ最終の値を返す。

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from './useReduceMotion';

export const COUNT_UP_MS = 600;

// 画面に出す数。動きを減らす時は、動きの途中の値を使わず最終の値
export function countUpShown(reduce: boolean, target: number, animated: number): number {
  return reduce ? target : animated;
}

export function useCountUp(target: number | null | undefined): number {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const last = useRef<number | null>(null);
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (target == null) return; // 読み込み中は動かさない
    const set = (n: number) => {
      shownRef.current = n;
      setShown(n);
    };
    if (reduce) {
      last.current = target;
      set(target);
      return;
    }
    if (last.current === target) return;
    last.current = target;
    v.setValue(shownRef.current);
    const id = v.addListener(({ value }) => set(Math.round(value)));
    const anim = Animated.timing(v, {
      toValue: target,
      duration: COUNT_UP_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // 文字の数を書き換えるので JS 側で動かす
    });
    anim.start(({ finished }) => {
      if (finished) set(target);
    });
    return () => {
      anim.stop();
      v.removeListener(id);
    };
  }, [target, reduce, v]);

  return countUpShown(reduce, target ?? 0, shown);
}
