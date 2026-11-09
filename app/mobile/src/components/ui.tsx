// 共通の部品。大きく押しやすいボタン（下に厚み・押すと沈む）、入力欄、選ぶ札、画面の枠。

import { useEffect, useRef, type ComponentRef, type ComponentType, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tap } from '../lib/haptics';
import { fieldMicShown } from '../lib/voiceFill';
import { canRecord, useVoiceFill, VoiceButton } from './VoiceButton';
import { NATIVE_DRIVER, useReduceMotion } from '../lib/useReduceMotion';
import { border, color, font, radius, space, touch } from '../theme';

type Variant = 'primary' | 'plain' | 'danger';

const LIP = 4;

// 押している間だけ小さく沈む縮尺
export const PRESS_SCALE = 0.97;

type SinkProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> };
const AnimatedPressable = Animated.createAnimatedComponent(Pressable) as unknown as ComponentType<
  Omit<PressableProps, 'style'> & { style?: object }
>;

// 押している間だけ縮む Pressable（ばねで戻る）。動きを減らす設定では縮まない。
// BigButton などは hooks を使わない関数のままにし、動きはこの部品が持つ
export function SinkPressable(props: SinkProps) {
  const { style, onPressIn, onPressOut, ...rest } = props;
  const reduce = useReduceMotion();
  const sink = useRef(new Animated.Value(1)).current;
  const to = (v: number) => {
    if (reduce) return sink.setValue(1);
    Animated.spring(sink, { toValue: v, speed: 40, bounciness: 4, useNativeDriver: NATIVE_DRIVER }).start();
  };
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        to(PRESS_SCALE);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      style={[style, { transform: [{ scale: sink }] }]}
    />
  );
}

export function BigButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  // small: 行の中に置く小さめの形（届いた申請の「承認」など）
  size?: 'big' | 'small';
}) {
  const { label, onPress, disabled, busy, variant = 'primary', style, testID, size = 'big' } = props;
  const off = disabled || busy;
  const face =
    variant === 'primary'
      ? { bg: color.primary, lip: color.primaryLip, fg: color.onPrimary, border: color.primary }
      : variant === 'danger'
        ? { bg: color.surface, lip: color.edge, fg: color.danger, border: color.edge }
        : { bg: color.surface, lip: color.edge, fg: color.primary, border: color.edge };
  return (
    <SinkPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={() => {
        tap();
        onPress();
      }}
      style={style}
    >
      {({ pressed }) => (
        <View style={[styles.lip, { backgroundColor: off ? color.line : face.lip }]}>
          <View
            style={[
              styles.face,
              size === 'small' && styles.faceSmall,
              {
                backgroundColor: off ? color.surfaceSunk : face.bg,
                borderColor: off ? color.line : face.border,
                transform: [{ translateY: pressed && !off ? LIP : 0 }],
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={variant === 'primary' ? color.muted : face.fg} />
            ) : (
              <Text style={[styles.faceText, size === 'small' && styles.faceTextSmall, { color: off ? color.muted : face.fg }]}>
                {label}
              </Text>
            )}
          </View>
        </View>
      )}
    </SinkPressable>
  );
}

// 札の文字が 2 行以上になりそうか。幅 160 の札（余白を引いて約 132）で 1 行に入るのは全角 8 字ほど
// （全角を 2、半角を 1 と数えて 16 まで）。部品は hooks を使わないので、長さで見積もる
export const CHIP_ONE_LINE_UNITS = 16;
export function chipWraps(label: string): boolean {
  let units = 0;
  for (const ch of label) units += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return units > CHIP_ONE_LINE_UNITS;
}

// ホームの建物の絵: 階の数だけ縦棒（最大 10 本）
export const TOWER_BARS_MAX = 10;
export const towerBarCount = (floors: number): number => Math.min(TOWER_BARS_MAX, Math.max(0, Math.floor(floors) || 0));

export function Chip(props: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { label, selected, onPress, testID, style } = props;
  return (
    <SinkPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.chip, chipWraps(label) && styles.chipMulti, selected && styles.chipOn, style]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </SinkPressable>
  );
}

// voice: 入力欄の右（複数行なら右下）にマイク。話した声を文字にして末尾に足す（自動では送らない・録音できる端末だけ）
export function Field(props: TextInputProps & { label?: string; inputRef?: Ref<ComponentRef<typeof TextInput>>; voice?: boolean }) {
  const { label, style, inputRef, voice = false, ...rest } = props;
  const input = (
    <TextInput
      ref={inputRef}
      accessibilityLabel={label ?? rest.placeholder}
      placeholderTextColor={color.muted}
      style={[styles.input, rest.multiline && styles.inputMulti, style]}
      {...rest}
    />
  );
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {fieldMicShown(voice, canRecord()) ? (
        <VoiceInput value={rest.value ?? ''} onChangeText={rest.onChangeText} max={rest.maxLength} testID={rest.testID}>
          {input}
        </VoiceInput>
      ) : (
        input
      )}
    </View>
  );
}

function VoiceInput(props: { children: ReactNode; value: string; onChangeText?: (t: string) => void; max?: number; testID?: string }) {
  const fill = useVoiceFill(props.value, props.onChangeText, props.max);
  return (
    <>
      <View style={styles.voiceRow}>
        <View style={{ flex: 1 }}>{props.children}</View>
        <View style={styles.voiceMic}>
          {fill.busy ? (
            <ThinkingDots />
          ) : (
            <VoiceButton small onDone={fill.onDone} onError={fill.onError} testID={props.testID ? `${props.testID}-voice` : 'field-voice'} />
          )}
        </View>
      </View>
      <ErrorLine text={fill.error} />
    </>
  );
}

// ホームの数字（連続記録・建物）の読み上げの名前。名前だけだと数字を言わない
export const statLabel = (label: string, value: string, unit: string) => `${label} ${value} ${unit}`;

// footerPlain: 下の固定欄に区切り線を引かない（会話の下のマイク・#315）
export function Screen(props: { children: ReactNode; scroll?: boolean; footer?: ReactNode; footerPlain?: boolean }) {
  const { children, scroll = true, footer, footerPlain = false } = props;
  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, footerPlain && styles.footerPlain]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

// onPress を渡すと押せるカードになり、押している間だけ小さく沈む
export function Card(props: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const { children, style, onPress, testID, accessibilityLabel } = props;
  if (!onPress) return <View testID={testID} style={[styles.card, style]}>{children}</View>;
  return (
    <SinkPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.card, styles.cardPressable, style]}
    >
      {children}
    </SinkPressable>
  );
}

export function Title(props: { children: ReactNode }) {
  return <Text style={styles.title}>{props.children}</Text>;
}

export function Label(props: { children: ReactNode }) {
  return <Text style={styles.label}>{props.children}</Text>;
}

export function ErrorLine(props: { text: string | null }) {
  if (!props.text) return null;
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {props.text}
    </Text>
  );
}

// 重みの低い操作（目標を足す など）。枠も厚みも無い、下線つきの文字だけのボタン。
export function TextLink(props: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={() => {
        tap();
        props.onPress();
      }}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.5 }]}
    >
      <Text style={styles.linkText}>{props.label}</Text>
    </Pressable>
  );
}

// 一覧が上から順に出る時の、1 つごとのずれ
export const STAGGER_MS = 60;
export const staggerDelay = (index: number): number => Math.max(0, index) * STAGGER_MS;

// 初めて描画された時だけ、下から薄く浮かんで出る。動きを減らす設定では、すぐ最終の状態
export function RiseIn(props: { children: ReactNode; delay?: number; duration?: number }) {
  const { children, delay = 0, duration = 300 } = props;
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return v.setValue(1);
    const anim = Animated.timing(v, { toValue: 1, duration, delay, useNativeDriver: NATIVE_DRIVER });
    anim.start();
    return () => anim.stop();
    // 初めての描画の時だけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return <Animated.View style={{ opacity: v, transform: [{ translateY }] }}>{children}</Animated.View>;
}

// AI が考えている間の点の動き。
export function ThinkingDots(props: { label?: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 3, duration: 1200, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  const dot = (i: number) => ({
    opacity: v.interpolate({ inputRange: [0, i, i + 0.5, i + 1, 3], outputRange: [0.25, 0.25, 1, 0.25, 0.25] }),
  });
  return (
    <View style={styles.thinking} accessible accessibilityLabel={props.label ?? '考え中'}>
      {props.label ? <Text style={styles.thinkingText}>{props.label}</Text> : null}
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={[styles.dot, dot(i)]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // 主ボタンはピル型（full）。下に厚み（lip）を残し、押すと沈む
  lip: { borderRadius: radius.full, paddingBottom: LIP },
  face: {
    minHeight: touch.big,
    borderRadius: radius.full,
    borderWidth: border.bold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  faceSmall: { minHeight: touch.min - LIP, paddingHorizontal: space.lg },
  faceText: { fontSize: font.large, fontWeight: '700' },
  faceTextSmall: { fontSize: font.body },
  link: { minHeight: touch.min, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: font.body, fontWeight: '700', color: color.primary, textDecorationLine: 'underline' },
  chip: {
    minHeight: touch.min,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    borderWidth: border.bold,
    borderColor: color.edge,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 複数行の札: 丸い縁に文字が触れないよう、丸みを小さくして上下に余白を足す
  chipMulti: { borderRadius: radius.box, paddingVertical: space.sm },
  chipOn: { borderColor: color.primary, backgroundColor: color.primarySoft },
  chipText: { fontSize: font.body, color: color.text, fontWeight: '600' },
  chipTextOn: { color: color.primary },
  label: { fontSize: font.small, color: color.muted, fontWeight: '700' },
  input: {
    minHeight: touch.min,
    borderWidth: border.bold,
    borderColor: color.edge,
    borderRadius: radius.box,
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: color.text,
  },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' },
  // マイクは欄の右。複数行の欄でも右下に揃う
  voiceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  voiceMic: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: color.bg },
  body: { padding: space.lg, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  footerPlain: { borderTopWidth: 0 },
  footer: {
    padding: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
    backgroundColor: color.bg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  // 表示だけのカード: 角 16・細い温かい枠・白い面
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: border.thin,
    borderColor: color.line,
    padding: space.lg,
    gap: space.md,
  },
  // 押せるカード: 縁を濃く太くし、下に厚みを付けて、表示だけのカードと見分ける
  cardPressable: { borderWidth: border.bold, borderColor: color.edge, borderBottomWidth: LIP },
  title: { fontSize: font.title, fontWeight: '800', color: color.text },
  error: { color: color.danger, fontSize: font.body, fontWeight: '600' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  thinkingText: { color: color.muted, fontSize: font.body, marginRight: space.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: color.primary },
});
