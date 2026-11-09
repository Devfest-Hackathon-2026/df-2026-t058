import { Stack, router, usePathname, type NativeStackHeaderProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '../api';
import { Platform } from 'react-native';
import { nativeNotify, setNotificationsModule } from '../lib/nativeNotify';
import { AuthGate } from '../components/AuthGate';
import { ColumnHeader } from '../components/ColumnHeader';
import { COPY_ASK_AI } from '../lib/copy';
import { showBackFor } from '../lib/navLayout';
import { isPublicPath, PRIVACY_TITLE } from '../lib/privacyText';
import { backAction } from '../lib/settingsForm';
import { setupWebHead } from '../lib/webHead';
import { color } from '../theme';

// 戻る矢印を押した時。履歴があれば 1 つ戻る。URL で直接開いて履歴が無い時はホームへ
function goBack() {
  if (backAction(router.canGoBack()) === 'back') router.back();
  else router.replace('/');
}

// 流れの画面の上の帯は、すべて本文の列にそろえた共通の帯にする（各画面の中身は触らない）
function columnHeader({ options, route }: NativeStackHeaderProps) {
  const hasHeaderLeft = options.headerLeft !== undefined;
  const back = showBackFor({ hideBack: options.headerBackVisible === false, hasHeaderLeft });
  const sideProps = { tintColor: color.primary, canGoBack: back };
  return (
    <ColumnHeader
      title={options.title ?? route.name}
      onBack={back ? goBack : null}
      left={hasHeaderLeft ? options.headerLeft?.(sideProps) : null}
      right={options.headerRight?.(sideProps)}
    />
  );
}

setupWebHead(); // Web の起動時に 1 回（アイコン・テーマ色・lang）

// Android の時だけ、通知の部品をアプリへ渡す（Web・試験では何もしない）
declare const require: (name: string) => any;
if (Platform.OS === 'android') {
  try {
    setNotificationsModule(require('expo-notifications'));
  } catch {
    // 入っていない・読めない時は通知なしで続ける
  }
}

export default function RootLayout() {
  // ログイン前に誰でも読む画面（/privacy）では、ログインへ飛ばす見張りを置かない
  const isPublic = isPublicPath(usePathname());
  // Android の通知: タップでアプリ内の画面へ・トークンが変わったら登録し直す（Web・iOS は何もしない）
  useEffect(() => nativeNotify.start((path) => router.push(path as never), api), []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {isPublic ? null : <AuthGate />}
      <Stack
        screenOptions={{
          header: columnHeader,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: color.bg },
        }}
      >
        {/* 今日・建物・友達は下タブ（PC 幅では左のレール）。URL は / ・ /tower ・ /friends のまま */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'ログイン', headerShown: false, gestureEnabled: false }} />
        {/* 準備のフロー（足す → 道を決める）は、上の帯（SceneTop）で場面を見せる（#315・見出しの番号は使わない） */}
        <Stack.Screen name="goal/new" options={{ title: '足す', animation: 'fade', headerShown: false }} />
        <Stack.Screen name="goal/import" options={{ title: '課題を取り込む', animation: 'fade', headerShown: false }} />
        <Stack.Screen name="plan/[goalId]" options={{ title: '道を決める', animation: 'fade', headerShown: false }} />
        <Stack.Screen name="start/[goalId]/[checkpointId]" options={{ title: '始める', animation: 'fade', headerShown: false }} />
        <Stack.Screen name="focus/[sessionId]" options={{ title: '集中', animation: 'fade', headerShown: false, headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
        <Stack.Screen name="tutor/[sessionId]" options={{ title: COPY_ASK_AI }} />
        <Stack.Screen name="reflect/[sessionId]" options={{ title: '5/5　振り返る', headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
        <Stack.Screen name="settings" options={{ title: '設定' }} />
        <Stack.Screen name="privacy" options={{ title: PRIVACY_TITLE }} />
      </Stack>
    </SafeAreaProvider>
  );
}
