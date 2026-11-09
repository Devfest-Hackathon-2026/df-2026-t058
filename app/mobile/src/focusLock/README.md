# focusLock（他のアプリの制限）

今は `noopFocusLock`（何もしない）だけ。画面は `focusLock.isAvailable / start / stop` だけを呼ぶので、
ネイティブの実装ができたら `index.ts` の `focusLock` を差し替える。

## 方針
- Android: 利用状況アクセス（UsageStatsManager）で前面のアプリを見て、選んだアプリが前に来たらオーバーレイ（SYSTEM_ALERT_WINDOW）でこのアプリへ戻す。どちらも本人が設定画面で許可する権限。Expo の config plugin とネイティブモジュール（development build）が要る。Expo Go では動かない。
- iOS: Family Controls（Screen Time API の FamilyControls / ManagedSettings / DeviceActivity）。使うには Apple の承認（entitlement）が要るので、承認が出るまで作らない（決定 11/5）。アプリの一覧はアプリ自身が見ない方式（P10）。
- Web: 制限できない。`isAvailable()` は false のまま。
