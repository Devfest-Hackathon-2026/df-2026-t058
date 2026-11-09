// 招待コードで入る（サーバーが AUTH_MODE=invite の時）。名前とコードの 2 欄、ボタン 1 つ。
// Web でサーバーが googleClientId を返した時だけ、上に Google のボタン（#213）。招待コードはその下に残す。

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { api, session } from '../api';
import { checkLoginInput, loginErrorText, NAME_MAX } from '../api/auth';
import { AgentSays } from '../components/AgentSays';
import { BigButton, ErrorLine, Field, Title } from '../components/ui';
import { AGENT_LINES } from '../lib/agentLines';
import { COPY_AGE_LIMIT, COPY_INVITE_CODE, COPY_INVITE_LOGIN, COPY_LOGIN } from '../lib/copy';
import { renderSignInButton, showGoogleSignIn } from '../lib/googleSignIn';
import { codeFromHash } from '../lib/inviteHash';
import { APP_SUBTITLE, DEFAULT_APP_NAME } from '../lib/appName';
import { useTabTitle } from '../lib/tabTitle';
import { color, font, space } from '../theme';

declare const document: any; // Web だけ（Google のボタンを描く場所を探す）

const APP_NAME = DEFAULT_APP_NAME; // expo.name は英字（MolTower）なので、見出しは日本語の定数

export default function Login() {
  useTabTitle('ログイン');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Web: URL の #code=... を欄に入れ、すぐ URL から # 以降を消す（ネイティブは何もしない）
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const { hash, pathname, search } = window.location;
    if (!hash) return;
    const fromUrl = codeFromHash(hash);
    if (fromUrl) setCode(fromUrl);
    window.history.replaceState(null, '', pathname + search);
  }, []);

  // Google のボタン: 公開の設定から ID を取り、Web の時だけ描く（読めない時は出さない）
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleShown, setGoogleShown] = useState(false);
  useEffect(() => {
    let alive = true;
    api.config().then((c) => alive && setGoogleClientId(c.googleClientId), () => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!showGoogleSignIn(Platform.OS, googleClientId) || typeof document === 'undefined') return;
    const el = document.getElementById('login-google');
    renderSignInButton(googleClientId as string, el, onGoogleCredential).then(setGoogleShown);
  }, [googleClientId]);

  async function onGoogleCredential(credential: string) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await session.loginGoogle(credential);
      router.replace('/');
    } catch (e) {
      setError(loginErrorText(e));
      setBusy(false);
    }
  }

  const input = checkLoginInput(name, code);

  async function submit() {
    const v = checkLoginInput(name, code);
    if (!v.ok || !session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.login(v.name, v.code);
      router.replace('/');
    } catch (e) {
      setError(loginErrorText(e));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Svg width={56} height={56} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no" testID="login-mark">
          <Rect x={8} y={42} width={48} height={14} rx={4} fill={color.bronze} />
          <Rect x={8} y={25} width={48} height={14} rx={4} fill={color.silver} />
          <Rect x={8} y={8} width={48} height={14} rx={4} fill={color.gold} />
        </Svg>
        <Text accessibilityRole="header" style={styles.appName} testID="login-app-name">
          {APP_NAME}
        </Text>
        <Text style={styles.invite} testID="login-subtitle">
          {APP_SUBTITLE}
        </Text>
        <Title>ログイン</Title>
        <AgentSays {...AGENT_LINES.login} testID="login-agent" />
        {showGoogleSignIn(Platform.OS, googleClientId) ? <View nativeID="login-google" testID="login-google" style={styles.google} /> : null}
        {googleShown ? <Text style={styles.invite}>{COPY_INVITE_LOGIN}</Text> : null}
        <Field
          label="名前"
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          placeholder="例: ゆうき"
          autoCorrect={false}
          returnKeyType="next"
          testID="login-name"
        />
        <Field
          label={COPY_INVITE_CODE}
          value={code}
          onChangeText={setCode}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="login-code"
        />
        <ErrorLine text={error} />
        <BigButton label={COPY_LOGIN}onPress={submit} busy={busy} disabled={!input.ok} testID="login-submit" />
        <Text style={styles.invite} testID="login-age">
          {COPY_AGE_LIMIT}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  google: { minHeight: 44, alignItems: 'flex-start' },
  invite: { fontSize: font.small, color: color.muted },
  appName: { fontSize: font.hero, fontWeight: '800', color: color.primary },
  subtitle: { fontSize: font.small, color: color.muted },
  body: { padding: space.lg, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1, justifyContent: 'center' },
});
