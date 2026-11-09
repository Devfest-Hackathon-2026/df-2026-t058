# 依存パッケージ（app/mobile）

版はすべて固定（範囲指定なし）。基準は Expo SDK 58 の `expo@58.0.17`（2026-10-21 公開）。
SDK 58 の各パッケージの版は、この `expo` に入っている `bundledNativeModules.json` の値に合わせた（公開から 2 週間以上たった版だけ）。
TypeScript と `@types/react` は SDK 58 の公式テンプレート（`expo-template-blank-typescript@sdk-58`）と同じ版。

`npx expo install --check` は、最新の SDK 58 の版（`expo@58.0.23` 系）と比べて「古い」と出る。これは 2 週間の規則で新しい版を避けたため。上げる時は `expo` を先に上げてから `npx expo install --fix`。

## 実行時（dependencies）

| 名前 | 版 | 理由 | 代替 |
|---|---|---|---|
| expo | 58.0.17 | 土台（SDK 58）。指定どおり | なし（React Native を素で使う＝ネイティブの設定を全部自分で持つ） |
| react | 19.3.0 | 画面の部品。SDK 58 が決める版 | なし |
| react-native | 0.88.0 | 画面の部品。SDK 58 が決める版 | なし |
| expo-router | 58.0.25 | 画面の行き来（ファイルの置き場所が道順になる）。指定どおり | @react-navigation/native を直接使う（設定が増える） |
| react-native-safe-area-context | 5.10.1 | expo-router が要る。ノッチを避ける | なし（expo-router の必須） |
| react-native-screens | 4.30.0 | expo-router が要る | なし（expo-router の必須） |
| expo-linking | 58.0.14 | expo-router が要る（出典の URL は開かない＝外のブラウザに出ると時計が止まるため。アプリの中で開くなら expo-web-browser か react-native-webview の追加が要る・未決） | なし（expo-router の必須） |
| expo-constants | 58.0.13 | expo-router が要る | なし（expo-router の必須） |
| expo-status-bar | 58.0.4 | 上の帯の色。公式の expo-router の手順に入っている | 使わない（帯の文字色が端末任せになる） |
| react-dom | 19.3.0 | Web で表示する。指定どおり | なし |
| react-native-web | 0.21.4 | Web で表示する。指定どおり | なし |
| @expo/metro-runtime | 58.0.15 | Web で表示する。指定どおり | なし |
| react-native-svg | 15.16.0 | レーダーチャート。指定どおり | 図のライブラリ（victory-native など）＝重い。View を回して描く＝多角形が描けない |
| expo-haptics | 58.0.7 | 押した感触。指定どおり | 使わない（感触なし） |
| expo-image-picker | 58.0.10 | ノートの写真を撮る／選ぶ。指定どおり | expo-camera（撮るだけ・画面を自作） |
| expo-image-manipulator | 58.0.15 | 写真を縮めて JPEG にする（1 枚 1.4MiB 以下） | image-picker の quality だけで縮める（大きさの上限を守れない） |
| @react-native-async-storage/async-storage | 2.2.0 | 端末の ID（x-dev-user）、次の一歩、集中と目標の対応を端末に残す。Web では localStorage | expo-secure-store（Web で動かない）／保存しない（開き直すたびに別人になる） |
| expo-crypto | 58.0.7 | 端末の ID を乱数で作る（randomUUID） | Math.random（予測できる。仮の本人確認にも弱い） |

## 開発用（devDependencies）

| 名前 | 版 | 理由 | 代替 |
|---|---|---|---|
| typescript | 6.0.3 | 型の検査（`npx tsc --noEmit`）。SDK 58 のテンプレートの版 | なし |
| @types/react | 19.3.0 | React の型。SDK 58 のテンプレートの版 | なし |
| jest-expo | 58.0.12 | 試験。指定どおり。SDK 58 が決める版 | node:test（Expo の部品を読み込めない） |
| jest | 30.5.2 | jest-expo が要る | なし（jest-expo の必須） |
| @types/jest | 30.0.0 | 試験の型。TypeScript 6 は `@types` を自動で読まないので `tsconfig.json` の `types` に入れた | なし |

## 入れなかった物
- アイコンのライブラリ（@expo/vector-icons など）: ⏸ ▶ ✓ などの文字で足りる。
- 日付の選択部品: 期限は「3 日後／1 週間後…」の札で選ぶ。
- 状態管理のライブラリ: 画面ごとの state と `src/api/` で足りる。
- Firebase の SDK: 本物のログインと通知は後で（契約 §1・§3.7）。

## 入れる時の注意
- `npm install` の時に「`@parcel/watcher@2.6.0` の install スクリプトが allowScripts に入っていない」と警告が出る。許可はしていない。`npx expo export --platform web` と jest はこの状態で通った。
