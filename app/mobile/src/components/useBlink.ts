// 押せない時に、足りない欄の枠を 3 回点滅させる共通の動き。
// frame は Animated.View の borderColor に渡す（点滅していない時は rest の色）。

import { useRef } from 'react';
import { Animated } from 'react-native';
import { color } from '../theme';

export function useBlink(rest: string = color.surface) {
  const blink = useRef(new Animated.Value(0)).current;
  const frameColor = blink.interpolate({ inputRange: [0, 1], outputRange: [rest, color.danger] });

  function flash() {
    blink.setValue(0);
    Animated.sequence(
      [0, 1, 2].map(() =>
        Animated.sequence([
          Animated.timing(blink, { toValue: 1, duration: 200, useNativeDriver: false }),
          Animated.timing(blink, { toValue: 0, duration: 200, useNativeDriver: false }),
        ]),
      ),
    ).start();
  }

  return { frameColor, flash };
}
