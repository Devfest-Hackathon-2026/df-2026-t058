// 画面の上で、エビ（エージェント）が話す 1 つの吹き出し（#257）。発言の文は lib/agentLines.ts にだけ書く。
// 出る時（文が変わった時も）に、吹き出しが小さく浮かぶ（透明度と縮尺）。動きを減らす設定なら動かさない。
// waiting＝AI の返事待ち: 一緒に考える姿、吹き出しは「…」。小画面とキーボードの間も小さな絵を残し、
// 発言を短い版（1 文）にする。動きの再生はMascotが管理する。

import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { firstSentences } from '../lib/agentLines';
import { AGENT_ICON_SIZE, AGENT_SMALL_ICON_SIZE, isSmallScreen, MASCOT_NAME, poseFor, type MascotPose } from '../lib/mascot';
import { NATIVE_DRIVER, useReduceMotion } from '../lib/useReduceMotion';
import { color, font, radius, space } from '../theme';
import { Mascot } from './Mascot';

export const WAITING_DOTS = '…';
export const POP_MS = 200;
export const POP_FROM_SCALE = 0.94;

// 吹き出しに出す文: 返事待ちは点、小さい時は短い版（無ければ 1 文目）、ふだんは 2 文まで
export function bubbleText(props: { text: string; short?: string; waiting?: boolean }, small: boolean): string {
  if (props.waiting) return WAITING_DOTS;
  if (small) return props.short?.trim() ? firstSentences(props.short, 1) : firstSentences(props.text, 1);
  return firstSentences(props.text, 2);
}

// キーボードが出ているか（Web では知らせが来ないので、ずっと false）
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return shown;
}

export function AgentSays(props: {
  text: string;
  short?: string;
  waiting?: boolean;
  done?: boolean; // 何かが積まれた／できた（姿が happy になる）
  pose?: MascotPose;
  popKey?: string; // これが変わった時だけ浮かぶ（既定は文。入力に合わせて文が変わる所は、段階の名前を渡す）
  chat?: boolean; // 会話の形（ホーム・#315）: 小さな丸の中のモルティと、名前なしの大きめの吹き出し
  noIcon?: boolean; // 絵を出さない（同じ場面に別の姿のモルティがいる時・振り返りの最後）
  testID?: string;
}) {
  const { waiting = false, chat = false, noIcon = false, testID = 'agent-says' } = props;
  const { height } = useWindowDimensions();
  const keyboard = useKeyboardShown();
  const small = isSmallScreen(height) || keyboard;
  const shown = bubbleText(props, small);
  const pose = props.pose ?? poseFor({ waiting, done: props.done });
  const popKey = props.popKey ?? shown;

  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return v.setValue(1);
    v.setValue(0);
    const anim = Animated.timing(v, { toValue: 1, duration: POP_MS, useNativeDriver: NATIVE_DRIVER });
    anim.start();
    return () => anim.stop();
  }, [popKey, reduce, v]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [POP_FROM_SCALE, 1] });

  return (
    <View style={styles.row} testID={testID}>
      {noIcon ? null : chat ? (
        <View style={styles.avatar}>
          <Mascot size={CHAT_ICON_SIZE} waiting={waiting} pose={pose} motionKey={popKey} />
        </View>
      ) : (
        <Mascot size={small ? AGENT_SMALL_ICON_SIZE : AGENT_ICON_SIZE} waiting={waiting} pose={pose} motionKey={popKey} />
      )}
      <Animated.View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={waiting ? '考え中' : shown}
        style={[styles.bubble, chat && styles.bubbleChat, { opacity: v, transform: [{ scale }] }]}
        testID={`${testID}-bubble`}
      >
        {chat ? null : <Text style={styles.name}>{MASCOT_NAME}</Text>}
        <Text style={[styles.text, chat && styles.textChat]}>{shown}</Text>
      </Animated.View>
    </View>
  );
}

// 開いた直後に大きく出るモルティ（ホーム・#315）。考えている姿で、話す前の間を作る
export const MOLTY_BIG_SIZE = 168;
export function MoltyBig(props: { testID?: string }) {
  return (
    <View style={styles.big} testID={props.testID ?? 'molty-big'}>
      <Mascot size={MOLTY_BIG_SIZE} waiting />
    </View>
  );
}

// 振り返りの最後に、建物の横に立つモルティ（#315）: 見て評価した、と分かるように嬉しい姿で建物に寄り添う
export const MOLTY_STAND_SIZE = 96;
export function MoltyStand(props: { testID?: string }) {
  return <Mascot size={MOLTY_STAND_SIZE} pose="happy" testID={props.testID ?? 'molty-stand'} />;
}

// 会話の形のモルティ: 薄い地の丸（直径 52）の中に絵
export const CHAT_AVATAR_SIZE = 56;
const CHAT_ICON_SIZE = 48;

const styles = StyleSheet.create({
  big: { alignItems: 'center' },
  avatar: {
    width: CHAT_AVATAR_SIZE,
    height: CHAT_AVATAR_SIZE,
    borderRadius: radius.full,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bubbleChat: { paddingVertical: space.lg, paddingHorizontal: space.lg },
  textChat: { fontSize: font.large, lineHeight: 31, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bubble: {
    flexShrink: 1,
    backgroundColor: color.surface,
    borderColor: color.line,
    borderWidth: 1.5,
    borderRadius: radius.card,
    borderTopLeftRadius: radius.box,
    // 吹き出しの中は広めに（11/9 本人「会話のスペースを広く」）
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  text: { fontSize: font.body, color: color.text, lineHeight: 26 },
  name: { fontSize: font.small, color: color.primary, fontWeight: '700', marginBottom: space.xs },
});
