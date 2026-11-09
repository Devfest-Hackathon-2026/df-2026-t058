// 同じE案の静止画と場面別アニメーション。短い一動作の後は静止画に戻す。
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { canAnimate, MASCOT_ANIMATION_MS, MASCOT_ANIMATIONS, MASCOT_NAME, MASCOT_POSES, poseFor, type MascotPose } from '../lib/mascot';
import { useReduceMotion } from '../lib/useReduceMotion';

export function Mascot(props: { size?: number; height?: number; waiting?: boolean; pose?: MascotPose; motionKey?: string; testID?: string; animate?: boolean }) {
  const { size, height, waiting = false, motionKey = '', testID, animate = true } = props;
  const pose = props.pose ?? poseFor({ waiting });
  const reduce = useReduceMotion();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState<MascotPose | null>(null);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  const allowed = animate && canAnimate(reduce, focused, active) && failed !== pose;
  useEffect(() => {
    setPlaying(allowed);
    if (!allowed) return;
    const timer = setTimeout(() => setPlaying(false), MASCOT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [allowed, pose, motionKey, waiting]);
  const animated = allowed && playing;
  const edge = height ?? size ?? 38;
  return (
    <Image
      key={[pose, motionKey, animated].join(':')}
      source={animated ? MASCOT_ANIMATIONS[pose] : MASCOT_POSES[pose]}
      contentFit="contain"
      transition={0}
      accessible
      accessibilityLabel={MASCOT_NAME}
      onError={() => setFailed(pose)}
      testID={testID ?? (animated ? 'mascot-animated' : 'mascot')}
      style={{ width: edge, height: edge }}
    />
  );
}
