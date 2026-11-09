// 画面に出る言い回しを 1 か所にまとめる（言葉を変える時はここだけ直す）。
// 内部の値（small / medium・API の項目名）は変えない。ここは画面に出る文字だけ。

import { MASCOT_NAME } from './appName';

// 3/5 の主ボタン
export const COPY_START = '始める';
// 進行中の集中へ戻る主ボタン
export const COPY_CONTINUE = '続ける';
// AI の手助け（旧「AI に借りた分」）
export const COPY_AI_HELP = 'モルティの手助け';
// 手助けの度合い（small = ヒント・medium = やり方）
export const COPY_HELP_SMALL = 'ヒント';
export const COPY_HELP_MEDIUM = 'やり方';
// 友達がいま取り組んでいる
export const COPY_FRIEND_ACTIVE = '取り組み中';
// 友達の階数と連続日数（「12階・4日」）。0 の項目は出さない。両方 0 なら空。値が無い（古いサーバー）時は 0。
export function friendStatsText(floors?: number, streak?: number): string {
  const parts: string[] = [];
  if ((floors ?? 0) > 0) parts.push(`${floors}階`);
  if ((streak ?? 0) > 0) parts.push(`${streak}日`);
  return parts.join('・');
}

// ホームの一覧の見出し
export const COPY_GOALS_HEADING = '進めている目標';
// 取り込んだ課題（タスク・#261）の見出し。目標とは分けて並べる
export const COPY_TASKS_HEADING = '課題';
// ホームの一覧の「ほか N 件」と、たたんだ「終わった目標 N 件」
export const COPY_MORE_GOALS = 'ほか';
export const COPY_FINISHED_GOALS = '終わった目標';
// 上の帯の「＋ 目標」から出る 2 つの選択
export const COPY_ADD_GOAL = '＋ 目標';
export const COPY_ADD_WRITE = '書く';
export const COPY_ADD_IMPORT = '課題を取り込む';
// ホームの一番上の「今日の提案」のカード
export const COPY_TODAY_FAILED = '提案を取れませんでした';
export const COPY_RETRY = 'もう一度';
// 今日の提案を、本人の希望で組み直す（#222）。目標は変えず、並べ方と理由だけが変わる
export const COPY_TODAY_NOTE = '今日やりたいこと';
export const COPY_TODAY_NOTE_HINT = '例: 先に終わらせたい物、後回しにしたい物';
export const COPY_TODAY_NOTE_APPLY = 'この希望で組み直す';
export const COPY_TODAY_NOTE_APPLIED = '希望を反映しました';
export const COPY_TODAY_NOTE_UNDO = '元に戻す';
// 空の初回の、目標を手で書く薄いボタン
export const COPY_WRITE_GOAL = '目標を書く';
// 始める画面の薄いボタンと、5 分たった時の帯
export const COPY_SHORT_START = '5 分だけやる';
export const COPY_SHORT_START_PASSED = '5 分たちました。続ける？';
export const COPY_SHORT_START_KEEP = '続ける';
export const COPY_SHORT_START_STOP = 'ここまでにする';
// 始める画面の入力欄
export const COPY_TODAY_STEP = '今日の一歩';
// 道（進め方）がまだ無い目標
export const COPY_NO_ROAD = '進め方がまだ決まっていません';
// 友達の動き（ホームの 1 行の文・友達画面の見出し）
export const COPY_FRIEND_FEED = '友達の動き';
export const COPY_FRIEND_STARTED = '取り組みを始めました';
// ホームの友達の列の札（取り組み中の人）
export const COPY_FRIEND_ACTIVE_TAG = '取り組み中'; // 友達の様子は「取り組み」（11/9 本人）
// 表示名（友達・設定で共通）
export const COPY_DISPLAY_NAME = '表示名';
// 案
export const COPY_PLAN_MODE_LABEL = 'この案を';
export const COPY_REASON_NEEDED = '理由を 1 つ選ぶか、書いてください';
// 選んだ理由の札（複数選べる）
export const COPY_WHY_TAGS = [
  '期限に合う',
  '時間に合う',
  '自分のやり方に近い',
  '気になるところから始められる',
  'いちばん分かりやすい',
] as const;
export const COPY_WHY_FREE_LABEL = 'ひとこと足す';
// 案への希望（#223）
export const COPY_REMAKE_LABEL = '案への希望';
export const COPY_REMAKE_EXAMPLE = '例: もっと短く／実験から始めたい';
export const COPY_REMAKE_BUTTON = 'もう一度案を出す';
// 始める画面
export const COPY_ADD_CALENDAR = 'カレンダーに入れる';
// ホームの今日の提案から Google カレンダーに入れた後（#208）
export const COPY_CALENDAR_ADDED = '入れました';
export const COPY_OPEN_GOOGLE_CALENDAR = 'Google カレンダーで開く';
// 目標の期限とステップの日を Google カレンダーに入れる（#291）
export const COPY_GOAL_CALENDAR_REMOVE = 'カレンダーから外す';
export const copyGoalCalendarAdded = (n: number): string => `${n} 件入れました`;
export const copyGoalCalendarRemoved = (n: number): string => `${n} 件外しました`;
// 相談
export const COPY_ASK_AI = 'モルティに聞く';
// 集中の画面の、取り組み中の場面の札（#194）
export const COPY_CARD_STUCK = '手が止まった';
export const COPY_CARD_CHECK = '合ってるか確認';
export const COPY_CARD_MEMO = 'メモ';
export const COPY_HINT_STUCK = 'いまの考えを 1 行';
export const COPY_HINT_CHECK = 'いまの答えか、途中の式を書いてください';
export const COPY_HINT_MEMO = '忘れたくないことを 1 行';
// 候補の下の「ひとこと足す（任意）」の入力欄の薄い文字
export const COPY_OPTION_NOTE = 'ひとこと足す';
// 振り返り・建物の階: 考えを添えて聞いた回数（事実だけ）
export const copyThoughtLine = (asks: number, thoughtAsks: number) => `考えてから聞いた ${thoughtAsks}/${asks} 回`;
// 写真だけで「合ってるか確認」を送る時の本文（サーバーは本文 1 字以上が要る）
export const COPY_CHECK_PHOTO_ONLY = '写真の途中の式を見てください';
// 振り返り
export const COPY_PICK_PHOTO = '写真を選ぶ';
export const COPY_JUDGE = 'モルティに見てもらう';
export const COPY_DONE_MARK_LINE = 'できた、の目安';
export const COPY_ADD_SOURCE = '資料を足す';
// 階が積み上がる
export const COPY_TO_TODAY = '今日の画面へ';
// 振り返り: 集中の間に離れた回数（事実だけ）
export const copyLeaveLine = (n: number) => `集中の間に ${n} 回、画面を離れました`;
// 建物
export const COPY_TOWER_COLOR_NOTE = '集中した長さで色が変わります';
// 建物タブの考えポイント（総得点と目標ごとの内訳・#351）
export const COPY_POINTS_TOTAL = 'シェル';
export const COPY_POINTS_BY_GOAL = '目標ごと';
// 建物の上の「今週」のカード（#202）
export const COPY_WEEKLY_TITLE = '今週';
export const COPY_WEEKLY_MINUTES = '集中した分';
export const COPY_WEEKLY_FLOORS = '積んだ階';
export const COPY_WEEKLY_STREAK = '連続日数';
export const COPY_WEEKLY_FAILED = '今週のまとめを取れませんでした';
// ログイン
export const COPY_INVITE_CODE = '招待コード';
export const COPY_LOGIN = 'ログイン';
export const COPY_INVITE_LOGIN = '招待コードで入る'; // Google のボタンの下に小さく（#213）
// 利用の条件（決定 11/9）: Google Cloud の生成 AI の規約（Service Specific Terms §20(d)）に合わせる。課題の話では年齢を言わない
export const COPY_AGE_LIMIT = '18 歳以上の方が使えます。';
export const COPY_AGE_LIMIT_FULL =
  'このアプリは、18 歳以上の方が使えます。AI に使っている Google Cloud の生成 AI の利用規約に合わせています。';
// AI の 1 日の利用の上限（429・#225）
export const COPY_AI_LIMIT = '今日はモルティと話せる回数を使い切りました。明日また話せます';
// 端末への通知（#212・設定のスイッチ）
export const COPY_PUSH_LABEL = 'この端末に通知';
export const COPY_PUSH_HINT = '取り組みの合図を、夜 9 時までに 1 日 2 通まで';
export const COPY_PUSH_DENIED = 'ブラウザの設定で通知を許可してください';
export const COPY_PUSH_UNAVAILABLE = 'この端末では通知を使えません';
export const COPY_PUSH_IOS ='ホーム画面に追加すると、通知を使えます';
export const COPY_PUSH_TOO_MANY = '通知を受ける端末は 3 台までです';
export const COPY_PUSH_FAILED = '通知を設定できませんでした。もう一度';
// 集中中は他のアプリを開けなくする（#300・Android の設定のスイッチと、重ねる画面）
export const COPY_FOCUS_LOCK_LABEL = '集中中は他のアプリを開けなくする';
// 設定の小さな説明文
export const COPY_FOCUS_LOCK_WHY =
  '集中の間にほかのアプリが前に出たら、そっと声をかけます（電話はいつでも通ります）。そのために「使用状況へのアクセス」と「他のアプリの上に重ねる」を許可してください';
export const COPY_FOCUS_LOCK_OPEN = '許可の画面を開く';
export const COPY_FOCUS_LOCK_READY = '準備できました。次の集中から使えます';
export const COPY_FOCUS_LOCK_TITLE = '集中中です。続けますか？';
export const COPY_FOCUS_LOCK_BACK = '戻る';
export const COPY_FOCUS_LOCK_QUIT = '集中をやめる';
export const COPY_FOCUS_LOCK_NOTICE = '集中中です';
// 設定の「配色」（#363・チームで見比べて決めるため）
export const COPY_PALETTE_LABEL = '配色';
export const COPY_PALETTE_NAMES = { shrimp: 'エビ', sea: '海', deep: '深い海' } as const;
export const COPY_PALETTE_RESTART = 'アプリを開き直すと変わります';
export const COPY_PALETTE_FAILED = '配色を保存できませんでした。もう一度';
// AI（Vertex）側が混み合っている（503 upstream_busy・#226）。自分の使いすぎ（429）とは別
export const COPY_UPSTREAM_BUSY = 'いま混み合っています。少し待ってから、もう一度押してください';
// 通信失敗
export const COPY_OFFLINE = 'ネットにつながっていません。つながってから、もう一度';

// Android アプリの通知（#299）。モルティーが話す口調
export const COPY_NOTIFY_TITLE = MASCOT_NAME;
// 最初の目標を決めた直後に 1 回だけ聞く（「はい」の後で OS の許可の窓）
export const COPY_NOTIFY_ASK = '集中を離れた時と、毎日の声かけのために、通知を出してもいいですか？';
export const COPY_NOTIFY_ASK_YES = 'はい';
export const COPY_NOTIFY_ASK_LATER = 'あとで';
// 集中中にアプリを離れて 2 分
export const COPY_NOTIFY_FOCUS_LEAVE = `${MASCOT_NAME}です。集中が止まっています。戻りますか？`;
// 毎日 1 回（19:00）
export const COPY_NOTIFY_DAILY = '今日の分、5 分だけやりませんか？';

// ---- モルティ中心の画面（UI 刷新・11/9）----
// 集中の外でモルティに話しかける欄（POST /api/agent/chat・進め方だけ）
export const COPY_MOLTY_INPUT = 'モルティに話す';
export const COPY_MOLTY_INPUT_HINT = '例: 今日は何からやる？';
export const COPY_MOLTY_SEND = '送る';
// 画面の下の主役のマイクと、打ち込む欄を開く小さなボタン（#315）
export const COPY_VOICE_PRESS = '押して話す';
export const COPY_TYPE_OPEN = '打ち込む';
// 見せる（写真・ファイル・貼る）の丸の読み上げの名前（#315・絵だけのボタン）
export const COPY_SHOW_OPEN = '見せる（写真・ファイル・貼る）';
// ホームの「今日の一歩」のカード（#315）の見出し
export const COPY_CARD_GOAL = '目標';
export const COPY_CARD_STEP = '今日の一歩';
export const COPY_CARD_DEADLINE = '期限';
// ホームのカードの小さな横の道（押すと縦の道が開く・#315）
export const COPY_ROAD_OPEN = '道を見る';
export const COPY_OTHER_GOALS = 'ほかの目標';
// 「始める」のカード（#315）
export const COPY_REDO = '言い直す';
// 集中の中の大きなマイクの下（#315）
export const COPY_FOCUS_TALK = '詰まったら話す';
export const COPY_END = '終える';
export const COPY_SCENE_HOME = '今日';
export const COPY_SCENE_FOCUS = '集中';
export const COPY_SCENE_REFLECT = '振り返り';
// 道を決める画面の案のタブ（名前は下に全文で出す・11/9 本人）
export const copyPlanTab = (i: number): string => `案 ${i + 1}`;
// 準備のフロー（#315・目標を足す → 道を決める）の場面の札と、やめるリンク
export const COPY_SCENE_ADD = '足す';
export const COPY_SCENE_PLAN = '道を決める';
export const COPY_PREP_QUIT = 'やめる';
// 足す場面のカード
export const COPY_CARD_MATERIALS = '資料';
export const COPY_ADD_EMPTY = '話すとここに入ります';
export const COPY_ADD_MATERIALS_EMPTY = 'あればクリップから見せてください';
export const COPY_ADD_DEADLINE_PICK = '期限を選ぶ';
// 見せる物を選ぶ（足す場面）
export const COPY_SHOW_TASKS = '課題の一覧';
export const COPY_SHOW_TASKS_SUB = '授業のサイトの画面・お知らせ・カレンダー';
export const COPY_SHOW_MATERIALS = 'この目標の資料';
export const COPY_SHOW_MATERIALS_SUB = '試験範囲のプリント・教科書のページ';
export const COPY_CLOSE = '閉じる';
// 目標の資料の板（11/9・文字だけ残す）
export const COPY_DOCS_TITLE = 'この目標の資料';
export const COPY_DOCS_OPEN = '資料';
export const COPY_DOCS_ADD = '資料を足す';
export const COPY_DOCS_KEEP = 'これで残す';
export const COPY_DOCS_EDIT = '直す';
export const COPY_DOCS_REMOVE = '外す';
export const COPY_DOCS_REMOVE_ASK = 'この資料を外しますか？';
export const COPY_DOCS_EMPTY = 'まだありません。試験範囲や教科書のページを足すと、モルティが道づくりや相談で使います。';
export const COPY_DOCS_NOTE = '写真やファイルは文字にして捨て、文字だけを残します。';
// 振り返りのカード（#315）
export const COPY_REFLECT_DONE = 'できたこと';
export const COPY_REFLECT_DONE_EMPTY = '話すとここに入ります';
export const COPY_REFLECT_HINT_DONE = '例: 例題 3 問のうち 2 問は解けた';
export const COPY_REFLECT_HINT_NEXT = '例: 3 問目の続きから';
export const COPY_REFLECT_NEXT_EMPTY = '話すか、下から選んでください';
// 見てもらう前の 1 問（行き詰まり・P8・11/9 本人 A）。答えなくても進める
export const COPY_REFLECT_STUCK = '止まった所';
export const COPY_REFLECT_STUCK_EMPTY = 'なければ、そのまま見てもらえます';
export const COPY_REFLECT_HINT_STUCK = '例: 3 問目の式の立て方で止まった';
export const COPY_MOLTY_VIEW = 'モルティの見立て';
export const COPY_MY_VIEW = '自分では';
export const COPY_CARD_NEXT = '次の一歩';
export const COPY_DECIDE = 'これで決める';
export const COPY_VERDICT = 'モルティの見立て';
// モルティが返すボタン（AgentAction の kind ごと）。start は分を後ろに足す
export const COPY_ACTION_RESUME = '続ける';
export const COPY_ACTION_REFLECT = '振り返る';
export const COPY_ACTION_PLAN = '案を比べる';
export const COPY_ACTION_WRITE = '目標を書く';
export const COPY_ACTION_IMPORT = '課題を取り込む';
export const COPY_ACTION_TOWER = '建物を見る';
export const COPY_ACTION_FRIENDS = '友達を見る';
export const COPY_ACTION_SETTINGS = '設定を開く';
// 目標の一覧の見出し（たたむ）
export const COPY_GOALS_TOGGLE = '目標';
// ロードマップをモルティに頼んで直す（#262 の画面）。確定は「これで決める」だけ
export const COPY_ROADMAP_ASK = 'モルティに頼む';
export const COPY_ROADMAP_ASK_HINT = '例: 最初に過去問を 1 回解きたい';
export const COPY_ROADMAP_ASK_SEND = '頼む';
// ロードマップの見直し（#353・#359）。振り返りの最後に持ちかけ、押すと残りをモルティと直す
export const COPY_REVISE_OPEN = 'ロードマップを直す';
export const COPY_REVISE_APPLY = 'この形にする';
export const COPY_REVISE_KEEP = '今のまま';
export const COPY_REVISE_HINT = '例: 最後の 2 つを 1 つにまとめたい';
