// 設定: 通知（端末への知らせ）・アカウント（ログアウト）。焦りの強さは全員「強め」固定（11/9）。名前は友達タブの 1 か所だけで変える。

import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PALETTE_NAMES, afterPaletteSave, savePalette, type PaletteName, type PaletteStore } from '../lib/palette';
import { focusLockApi } from '../lib/focusLock';
import { api, errorText, session } from '../api';
import type { User } from '../api/types';
import { ErrorBox, Skeleton } from '../components/State';
import { BigButton, Chip, Label, Screen } from '../components/ui';
import {
  COPY_FOCUS_LOCK_LABEL,
  COPY_FOCUS_LOCK_OPEN,
  COPY_FOCUS_LOCK_READY,
  COPY_FOCUS_LOCK_WHY,
  COPY_PALETTE_FAILED,
  COPY_PALETTE_LABEL,
  COPY_PALETTE_NAMES,
  COPY_PALETTE_RESTART,
  COPY_PUSH_DENIED,
  COPY_PUSH_FAILED,
  COPY_PUSH_HINT,
  COPY_PUSH_IOS,
  COPY_PUSH_LABEL,
  COPY_PUSH_TOO_MANY,
  COPY_PUSH_UNAVAILABLE,
} from '../lib/copy';
import {
  browserPush,
  classifyPushError,
  disablePush,
  enablePush,
  readPushEnv,
  readPushState,
  type PushState,
} from '../lib/push';
import { useLoad } from '../lib/useLoad';
import { PALETTES, border, color, font, paletteName, radius, space, touch } from '../theme';

import { useTabTitle } from '../lib/tabTitle';

export default function Settings() {
  useTabTitle('設定');
  const { data: me, error, loading, reload, setData } = useLoad<User>(() => api.me());
  const [fail, setFail] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);

  // 端末への通知（Web だけ）。開いた時は状態を見るだけで、許可の窓は出さない
  const [push, setPush] = useState<PushState>('hidden');
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const nudgeNow = me?.nudgeLevel;
  useEffect(() => {
    if (Platform.OS !== 'web' || !nudgeNow) return;
    let alive = true;
    readPushState(readPushEnv(), browserPush(), api, nudgeNow)
      .then((s) => alive && setPush(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [nudgeNow]);

  // 集中中は他のアプリを開けなくする（#300・Android でモジュールがある時だけ出す。既定 OFF）
  const lock = focusLockApi();
  const [lockOn, setLockOn] = useState(false);
  const [lockMissing, setLockMissing] = useState(0);
  useEffect(() => {
    if (!lock.supported()) return;
    const check = () => setLockMissing(lock.missing().length);
    void lock.isEnabled().then(setLockOn);
    check();
    // OS の設定画面から戻った時に、許可を見直す
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [lock]);

  function toggleLock(on: boolean) {
    setLockOn(on);
    void lock.setEnabled(on);
  }

  // 配色（#363）。保存して、Web はその場で読み直す。端末は開き直しで変わる
  const [paletteNote, setPaletteNote] = useState<string | null>(null);
  async function pickPalette(name: PaletteName) {
    const ok = await savePalette(paletteStore(), name);
    if (!ok) return setPaletteNote(COPY_PALETTE_FAILED);
    if (afterPaletteSave(Platform.OS) === 'reload') {
      if (name !== paletteName) window.location.reload();
    } else {
      setPaletteNote(name === paletteName ? null : COPY_PALETTE_RESTART);
    }
  }

  async function togglePush(on: boolean) {
    const b = browserPush();
    if (!me || !b || pushBusy) return;
    setPushBusy(true);
    setPushNote(null);
    try {
      if (on) {
        await enablePush(b, api);
        setPush('on');
      } else {
        await disablePush(b, api);
        setPush('off');
      }
    } catch (e) {
      const k = classifyPushError(e);
      if (k === 'denied') setPush('denied');
      else if (k === 'unavailable') setPush('hidden');
      else setPushNote(k === 'too_many' ? COPY_PUSH_TOO_MANY : COPY_PUSH_FAILED);
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <Screen>
      <ErrorBox text={error ?? fail} onRetry={error ? () => void reload() : undefined} />
      {me ? (
        <>
          <View style={styles.block}>
            <Label>通知</Label>
            {push === 'hidden' ? (
              <Text style={styles.hint} testID="push-unavailable">
                {COPY_PUSH_UNAVAILABLE}
              </Text>
            ) : push === 'ios_home' ? (
              <Text style={styles.hint} testID="push-ios">
                {COPY_PUSH_IOS}
              </Text>
            ) : (
              <View testID="push-row">
                <View style={styles.pushLine}>
                  <Text style={styles.pushLabel}>{COPY_PUSH_LABEL}</Text>
                  <Switch
                    value={push === 'on'}
                    disabled={pushBusy}
                    onValueChange={(v) => void togglePush(v)}
                    testID="push-switch"
                  />
                </View>
                <Text style={styles.hint} testID="push-hint">
                  {push === 'denied' ? COPY_PUSH_DENIED : pushNote ?? COPY_PUSH_HINT}
                </Text>
              </View>
            )}
          </View>
          {Platform.OS === 'android' && lock.supported() ? (
            <View style={styles.block} testID="focus-lock-row">
              <View style={styles.pushLine}>
                <Text style={styles.pushLabel}>{COPY_FOCUS_LOCK_LABEL}</Text>
                <Switch value={lockOn} onValueChange={toggleLock} testID="focus-lock-switch" />
              </View>
              {lockOn && lockMissing > 0 ? (
                <>
                  <Text style={styles.hint} testID="focus-lock-why">
                    {COPY_FOCUS_LOCK_WHY}
                  </Text>
                  <BigButton
                    label={COPY_FOCUS_LOCK_OPEN}
                    variant="plain"
                    size="small"
                    onPress={() => lock.openNextSettings()}
                    testID="focus-lock-open"
                  />
                </>
              ) : lockOn ? (
                <Text style={styles.hint}>{COPY_FOCUS_LOCK_READY}</Text>
              ) : null}
            </View>
          ) : null}
          {session?.hasToken() ? (
            <View style={styles.block}>
              <Label>アカウント</Label>
              {confirmOut ? (
                <>
                  <BigButton label="ログアウト" variant="danger" onPress={() => void session?.signOut()} testID="logout-confirm" />
                  <BigButton label="やめる" variant="plain" onPress={() => setConfirmOut(false)} testID="logout-cancel" />
                </>
              ) : (
                <BigButton label="ログアウト" variant="danger" onPress={() => setConfirmOut(true)} testID="logout" />
              )}
            </View>
          ) : null}
        </>
      ) : null}
      <View style={styles.block} testID="palette-row">
        <Label>{COPY_PALETTE_LABEL}</Label>
        <View style={styles.chips}>
          {PALETTE_NAMES.map((name) => {
            const p = PALETTES[name];
            const on = name === paletteName;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={COPY_PALETTE_NAMES[name]}
                accessibilityState={{ selected: on }}
                onPress={() => void pickPalette(name)}
                style={[styles.palette, on && styles.paletteOn]}
                testID={`palette-${name}`}
              >
                <View style={styles.dots}>
                  {[p.bg, p.primary, p.text].map((c, i) => (
                    <View key={i} style={[styles.dot, { backgroundColor: c }]} />
                  ))}
                </View>
                <Text style={styles.pushLabel}>
                  {on ? '✓ ' : ''}
                  {COPY_PALETTE_NAMES[name]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {paletteNote ? (
          <Text style={styles.hint} testID="palette-note">
            {paletteNote}
          </Text>
        ) : null}
      </View>
      {!me && !error && loading ? (
        <View style={styles.block} testID="settings-loading">
          <Skeleton width={80} height={16} />
          <View style={styles.chips}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width={88} height={44} radius={radius.full} />
            ))}
          </View>
          <Skeleton width={220} height={16} />
        </View>
      ) : null}
    </Screen>
  );
}

// 配色の保存先（Web は起動の入口が同期で読めるよう localStorage、端末は AsyncStorage）
function paletteStore(): PaletteStore | null {
  if (Platform.OS !== 'web') return AsyncStorage;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  palette: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    borderWidth: border.bold,
    borderColor: color.edge,
    backgroundColor: color.surface,
  },
  paletteOn: { borderColor: color.primary, backgroundColor: color.primarySoft },
  dots: { flexDirection: 'row', gap: space.xs },
  dot: { width: 14, height: 14, borderRadius: radius.full, borderWidth: 1, borderColor: color.edge },
  hint: { fontSize: font.small, color: color.muted, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pushLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  pushLabel: { fontSize: font.body, color: color.text, fontWeight: '700' },
});
