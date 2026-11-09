// アプリの入口（#363）。画面の StyleSheet.create は読み込み時に色を固めるので、
// 保存した配色の組を「画面のファイルより先に」globalThis.__MOLT_PALETTE に置いてから、
// expo-router の本体を require する（import で先に読まない）。値の検査は src/theme.ts（lib/palette.ts）がする。
/* eslint-disable @typescript-eslint/no-require-imports */

const KEY = 'moltower.palette';
const { Platform } = require('react-native');

function put(v) {
  if (typeof v === 'string') globalThis.__MOLT_PALETTE = v;
}

if (Platform.OS === 'web') {
  // Web は localStorage を同期で読めるので、読んでからそのまま本体へ
  try {
    put(globalThis.localStorage && globalThis.localStorage.getItem(KEY));
  } catch {
    // 読めない（プライベートモード等）は既定の組
  }
  require('expo-router/entry');
} else {
  // 端末の AsyncStorage は非同期。登録（registerRootComponent）は起動の時点で済ませる必要があるので、
  // 先に小さな入口を登録し、保存値を読み終えてから本体（expo-router の App）を require して描く
  require('@expo/metro-runtime');
  const React = require('react');
  const { registerRootComponent } = require('expo');
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  function Boot() {
    const [App, setApp] = React.useState(null);
    React.useEffect(() => {
      let alive = true;
      Promise.resolve()
        .then(() => AsyncStorage.getItem(KEY))
        .catch(() => null)
        .then((v) => {
          put(v);
          const { App: Root } = require('expo-router/build/qualified-entry');
          if (alive) setApp(() => Root);
        });
      return () => {
        alive = false;
      };
    }, []);
    return App ? React.createElement(App) : null;
  }

  registerRootComponent(Boot);
}
