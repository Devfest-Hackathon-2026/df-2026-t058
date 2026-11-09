# スマホ側（app/mobile）

Expo SDK 58・TypeScript・expo-router。iOS・Android・Web で同じコードが動く。
依存の一覧と理由は `DEPENDENCIES.md`。

## 動かし方

```sh
cd app/mobile
npm ci            # package-lock.json どおりに入れる
```

### mock（サーバーなし）
端末の中の偽データで、流れが全部通る。AI の返事と判定も偽物。データはメモリだけなので、再読み込みで消える。

```sh
npm run web:mock                                   # = EXPO_PUBLIC_API_MODE=mock expo start --web
EXPO_PUBLIC_API_MODE=mock EXPO_PUBLIC_MOCK_SPEED=60 npx expo start --web   # 1 秒を 1 分として数える（階を早く見る）
```

`EXPO_PUBLIC_MOCK_SPEED` は mock の作業時間の計算にだけ効く。画面の時計は実際の秒で進む。

### real（サーバーにつなぐ）
**いまは real で一通りは通らない（サーバーの追随待ち・2026-11-05 時点）。** スマホ側は `docs/contract-changes-2026-11-05.md` に合わせてあるが、`app/api` はまだ古い契約のまま:
- `GET /api/home` と `POST /api/sessions/:id/reflect/confirm` が無い（ホームが「見つかりません」で止まる）。
- 相談の `kind: "ask"` が 400 になる。GET の応答に `helpTotal` が無い（画面は 0 として出す）。
- 振り返りは `selfReport` が必須のまま、本文の上限も 64KB のまま（写真つきは 413）。
- CORS（別の origin からの呼び出しの許可）が無い。Web の開発サーバー（:8081）からサーバー（:8080）へは `x-dev-user` を付けるので、ブラウザが先に OPTIONS を送り、それが 404 になって全部「つながりません」になる。サーバーが `AUTH_MODE=fake` の時だけ OPTIONS に応えて `Access-Control-Allow-Origin` と `Access-Control-Allow-Headers: x-dev-user, content-type` を返すか、Web の書き出しをサーバーと同じ origin から配る必要がある。

デモと流れの確認は、それまで mock で行う。

```sh
EXPO_PUBLIC_API_URL=http://localhost:8080 npx expo start --web   # サーバー側の CORS が入ってから
```
- 既定の URL は `http://localhost:8080`。
- 認証は仮で、ヘッダ `x-dev-user: <端末で一度だけ作った乱数の ID>` を送る。サーバーは `AUTH_MODE=fake` で動かす（契約 §1）。本物のログインは `src/api/http.ts` のヘッダの所だけを差し替える。
- 実機から手元のサーバーへつなぐ時は、`localhost` でなく Mac の LAN の IP を書く。
- `EXPO_PUBLIC_` の変数は書き出しの時に値が埋め込まれる。秘密は置かない。

### Web の書き出し
```sh
npx expo export --platform web                     # dist/ に出る（1 枚の index.html で全部の画面）
EXPO_PUBLIC_API_MODE=mock npx expo export --platform web
```

### 確かめ
```sh
npx tsc --noEmit
npx jest
```
試験は純粋な処理だけ（`src/__tests__/`）: レーダーの座標、直した割合、時計の一時停止、集中の見張り（送り直し・起動し直し）、mock の流れ、API のエラーの扱い、写真の縮め方、本文の大きさ、出典、ロードマップの欄。

## 作り

```
src/
  app/            画面（expo-router。ファイルの場所が道順）
    index.tsx       ホーム: 連続記録・建物の階数・チェックポイントの道・友達の知らせ
    goal/new.tsx    目標を書く
    plan/[goalId]   進め方を比べる（レーダー・直す・自分で作る・理由）
    start/...       始める前の一行
    focus/[id]      集中（⏸ / ▶）
    tutor/[id]      相談（聞く／調べる・小／中の印）
    reflect/[id]    振り返り（写真・判定・決め直し・次の一歩・3 つの点・階）
    tower.tsx       建物（階を押すとその日の記録）
    friends.tsx     友達（コード・承認・集中中・知らせ・通知の強さ）
  api/            API の窓口（ここ 1 か所）
    index.ts        モードを選んで `api` を出す
    http.ts         real
    mock.ts         mock（契約の形どおりの応答）
    types.ts        契約の型
    errors.ts       エラーの形と画面の文
  components/     共通の部品（大きなボタン・レーダー・道・建物）
  focusLock/      他のアプリの制限の窓口（今は何もしない）
  lib/            純粋な処理（座標・割合・時計・写真）と端末の覚え書き
  theme.ts        色・大きさ（ここ 1 か所）
```

## 決めごと
- 時間と点はサーバーが決める。画面の時計と「直した割合」は表示用の概算。
- 集中中にアプリが裏に回ったら `leave`、戻ったら `return` を送る（`src/lib/focusTracker.ts`）。見張りは画面の外にあり、集中の画面を閉じても集中が終わるまで続く。送れなかった物は送り直し、送り残しがあると「終える」を止める。時計と「離れているか」は端末に書き、起動し直した時は `return` を 1 回送る（409 は捨てる）。
- 時計は ⏸ と ▶ のマークだけが変わる（色は変えない・説明の文も出さない）。
- 写真は送る前に縮めて JPEG にし、1 枚 1.4MiB 以下にする（`src/lib/photo.ts`）。最大 3 枚。契約の 1 枚 1.5MB だと 3 枚で本文の上限 6MB を超えるため。送る前に本文全体も数える（`src/lib/bodySize.ts`）。
- 相談の出典は押せない文字で、出典名かドメイン名だけ出す（外のブラウザが開くと時計が止まるため）。
- ロードマップの欄の範囲は `src/lib/roadmapLimits.ts`（いまのサーバーに合わせた仮の値。契約に範囲が無い）。
- 振り返りでは「完了した／まだ」を聞かない。どこまでできたかは判定（AI か本人の決め直し）で決まる。
- 色は `src/theme.ts` だけ。主色は濃い青、階は金・銀・銅。Duolingo の緑・字形・キャラクターは使わない。

## 他のアプリの制限（focusLock）
`src/focusLock/index.ts` に `isAvailable / start / stop` の窓口と、何もしない仮の実装だけを置いた。ネイティブの実装はまだ無い。
- Android: 利用状況アクセス（前面のアプリを見る）＋オーバーレイ（選んだアプリが前に来たらこのアプリへ戻す）。development build と config plugin が要る。
- iOS: Family Controls（Screen Time API）。Apple の承認待ち。
- 詳しくは `src/focusLock/README.md`。

## まだ無い物
- 本物のログイン（Firebase Authentication）と端末への通知（FCM）。
- 写真の「撮る」は iOS・Android だけ。Web は「選ぶ」だけ。
