// 契約（docs/api-contract.md・11/6 に変更点を本体へ反映済み）の形をそのまま型にした物。
// 契約に無い物を足す時は、先に契約の PR。

export type ISODate = string;

export type NudgeLevel = 'off' | 'friend_start' | 'strong';

export interface User {
  id: string;
  friendCode: string;
  displayName: string;
  nudgeLevel: NudgeLevel;
  // 連続記録の日数。サーバーは保存せず、読むたびに GET /api/tower の streak と同じ計算で埋める。
  streak: number;
  createdAt: ISODate;
}

export interface Goal {
  id: string;
  userId: string;
  text: string;
  deadline: ISODate;
  minutesPerDay: number | null; // null＝おまかせ（AI が案を出す時に決める）
  status: 'active' | 'done' | 'dropped';
  materials?: string; // 取り込んだ資料の文字（本人が直した物・2000 字まで）
  createdAt?: ISODate; // 作った時刻（一覧の並び順）
  archivedAt?: ISODate; // やめた時刻（無ければ続けている・#231）
  kind?: 'task' | 'goal'; // 取り込んだ課題＝task（#261）。無ければ goal（後方互換）
  docs?: GoalDoc[]; // 目標の資料（文字だけ・古い順・10 件まで・11/9 追加・契約 §3.3）
}

// 目標の資料（タスクの間ずっと残る・文字だけ）。from＝どの場面で足したか
export interface GoalDoc {
  id: string;
  title: string;
  text: string;
  from: 'goal' | 'plan' | 'focus' | 'reflect';
  addedAt: ISODate;
  updatedAt?: ISODate;
}

export type Achievement = 0 | 1 | 2 | 3;

export interface Checkpoint {
  id: string;
  order: number;
  title: string;
  doneMark: string;
  estimateMin: number;
  state: 'todo' | 'doing' | 'done';
  achievement: Achievement | null;
  aiAchievement?: Achievement | null;
  achievementReason?: string;
}

export type AxisValue = 1 | 2 | 3 | 4 | 5;

export interface Axis {
  key: string;
  label: string;
}

// AI の案のチェックポイント。採る前なので state・achievement は無い（Checkpoint とは別の形）。
export interface CandidateCheckpoint {
  id: string;
  order: number;
  title: string;
  doneMark: string;
  estimateMin: number;
}

export interface Candidate {
  id: string;
  label: string; // 案の短い名前（例: 小さく刻む）
  summary: string; // 1 行の説明
  checkpoints: CandidateCheckpoint[];
  axes: Record<string, AxisValue>;
}

// auto＝取り込んだタスクの既定の道（#261・AI なし・理由なし）。画面から送ることはない
export type RoadmapSource = 'candidate' | 'edited' | 'own' | 'auto';

// 案（candidates）は Roadmap に入らない。GET /api/goals/:id の candidates で取る。
export interface Roadmap {
  id: string;
  goalId: string;
  userId: string;
  adopted: RoadmapSource;
  editRatio?: number;
  why: string; // 選んだ理由（P1・必須）
  checkpoints: Checkpoint[];
  createdAt: ISODate;
}

export interface Session {
  id: string;
  userId: string;
  goalId: string;
  checkpointId: string;
  focusMin?: number;
  startedAt: ISODate;
  endedAt?: ISODate;
  oneLine: string;
  materials?: string; // この集中で使う資料の文字（本人が直した物・2000 字まで）
  leaveCount: number;
  stuckCause?: string;
  reflectedAt?: ISODate; // 振り返り済みの印
  // 以下は振り返りの後にサーバーが持つ（契約 §4.1）。画面は ReflectResult を使えばよい
  judgeable?: boolean;
  aiAchievement?: Achievement | null;
  achievement?: Achievement | null;
  achievementReason?: string;
  nextSteps?: string[];
  note?: string;
  aiUnavailable?: boolean;
  confirmedAt?: ISODate;
}

export interface FocusEvent {
  id: string;
  userId: string;
  sessionId: string;
  type: string;
  at: ISODate;
  meta?: Record<string, unknown>;
}

export type HelpLevel = 'none' | 'small' | 'medium';

export interface TutorMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'ai';
  kind: 'ask' | 'research';
  text: string;
  helpLevel: HelpLevel;
  at: ISODate;
  // 調べた時の出典（契約 §4.1）。無ければ本文の URL を拾う。
  sources?: { title?: string; url: string }[];
}

export interface HelpTotal {
  small: number;
  medium: number;
}

export interface Floor {
  id: string;
  userId: string;
  sessionId: string;
  focusMin: number;
  at: ISODate;
  timeScore: number;
  achievementScore: number;
  // この集中の判定（チェックポイントの値ではない）。null＝未判定。建物で階を押した時に両方見せる。
  achievement: Achievement | null;
  aiAchievement: Achievement | null;
  ownScore: number;
  floors: number;
  color: 'gold' | 'silver' | 'bronze';
  derivedFrom: string[];
  // その集中で得た考えポイント（集中＋振り返り・契約 §3.6b）。無ければ 0
  pt?: number;
  // この集中の相談の回数と、考え（thought）を付けた回数（#253・古いサーバーは無い＝0）
  asks?: number;
  thoughtAsks?: number;
}

export type PointKind = 'focus' | 'thought' | 'decide' | 'done' | 'streak';

export interface PointItem {
  at: ISODate;
  kind: PointKind;
  pt: number;
  label: string;
}

// 目標ごとの考えポイント（契約 §3.6b・#351）。連続の pt はどの目標にも入らない。pt 0 の目標は来ない。
// 並びは最後に pt が増えた時刻の新しい順（順位ではない）
export interface PointsByGoal {
  goalId: string;
  text: string; // 目標の文（画面で 1 行に切る）
  pt: number;
  archived: boolean; // やめた目標
}

// 考えポイント（契約 §3.6b）。保存せず毎回計算・減点なし
export interface PointsData {
  total: number;
  today: number;
  week: number;
  items: PointItem[];
  byGoal?: PointsByGoal[]; // 古いサーバーは無い（無ければ内訳を出さない）
}

export interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  status: 'pending' | 'accepted';
  notifyOnStart: boolean;
  createdAt?: ISODate;
}

export interface FriendEntry {
  friendship: Friendship;
  user: { id: string; displayName: string };
  activeNow: boolean;
  /** 積んだ階の数（承認済みの友達だけ・それ以外は 0） */
  floors: number;
  /** 連続日数（承認済みの友達だけ・それ以外は 0） */
  streak: number;
  /** 今日（日本時間）積んだ階（古い順・最大 5・11/9 追加・契約 §3.7） */
  today?: TodayFloor[];
}

export interface TodayFloor {
  id: string; // <sessionId>:<i>
  color: 'gold' | 'silver' | 'bronze';
}

// ホームの一番上の友達の列（11/9 追加・契約 §3.9）
export interface HomeFriend {
  userId: string;
  displayName: string;
  activeNow: boolean;
  today: TodayFloor[];
}

export interface FeedItem {
  userId: string;
  displayName: string;
  oneLine: string;
  at: ISODate;
}

export type StuckCause = 'unclear_goal' | 'missing_knowledge' | 'too_big' | 'tired' | 'distracted' | 'other';

// 相談の送信。images は ask の時だけ・0〜2 枚（契約 §3.5）。サーバーは保存しない。
export interface TutorRequest {
  // 省略可（サーバーが AI の判断で調べる）。当面アプリは lib/tutorPhotos.ts の 1 か所で 'ask' を付けて送る。
  kind?: 'ask' | 'research';
  text: string;
  images?: ReflectImage[];
  // 取り組み中の場面（#194）。省略可＝自由に聞く。stuck＝手が止まった／check＝合ってるか確認
  intent?: TutorIntent;
  // 本人が候補から選んだ「いまの考え」（#253・省略可・0〜300 字）。ask の時だけ
  thought?: string;
}

export interface StuckOption {
  id: string;
  label: string;
}

export interface StuckOptionsResult {
  options: StuckOption[];
  source: 'ai' | 'fixed';
}

export type TutorIntent = 'stuck' | 'check';

export interface ReflectImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  dataBase64: string;
}

// 資料のファイル（契約 §3.7b・#201）。PDF は 4,000,000 バイト・テキストは 200,000 バイトまで
export interface MaterialFile {
  mimeType: 'application/pdf' | 'text/plain';
  dataBase64: string;
}

export interface ReflectAudio {
  mimeType: 'audio/webm' | 'audio/mp4' | 'audio/mpeg' | 'audio/wav';
  dataBase64: string;
}

export interface ReflectRequest {
  note: string;
  done: boolean;
  images: ReflectImage[];
  audio?: ReflectAudio; // 声の振り返り（Web・20 秒・契約 §3.8）
  materials: string;
  stuck?: { cause: StuckCause; note: string };
}

export interface ReflectResult {
  judgeable: boolean;
  aiAchievement: Achievement | null;
  achievement: Achievement | null;
  reason: string;
  nextSteps: string[];
  floor: Floor;
}

export interface ConfirmResult {
  achievement: Achievement;
  aiAchievement: Achievement | null;
  floor: Floor;
}

export interface HomeData {
  me: User;
  goals: { goal: Goal; roadmap: Roadmap | null }[];
  active: Session | null;
  tower: { totalFloors: number; streak: number };
  feed: FeedItem[];
  // 終えたがまだ振り返っていない集中（新しい順・最大 3）。振り返りの入口。
  toReflect: Session[];
  // ホームの一番上の友達の列（承認済み・取り組み中 → 今日積んだ新しい順・11/9 追加）
  friends?: HomeFriend[];
  // 考えポイントの今日と合計（無ければ出さない・契約 §3.6b）
  points?: { today: number; total: number };
}

export interface GoalDetail {
  goal: Goal;
  roadmap: Roadmap | null;
  candidates: Candidate[];
  axes: Axis[]; // レーダーの軸（契約 §3.3 で必ず返る）
  // 進み具合（11/9 追加・#353・後方互換）。古いサーバーは無い（無ければ見直しを持ちかけない）
  pace?: RoadmapPace;
}

// ロードマップの進み具合（契約 §3.3）。サーバーが決まった規則で出す。null＝判定しない（道が無い・期限を過ぎた など）
export type RoadmapPace = 'behind' | 'ahead' | 'ok' | null;

// ロードマップの見直し（契約 §3.3 POST /api/goals/:id/roadmap/revise・#353）。保存しない・確定しない
export interface RoadmapReviseRequest {
  message?: string; // 1〜300 字。最初の 1 回は無し（モルティが pace に合わせた案を出す）
  draft?: CheckpointInput[]; // 0〜8 件（今の下書き。無ければ今の残り）
  history?: AgentTurn[]; // 0〜6 件・古い順
}
export interface RoadmapReviseResult {
  reply: string; // 1〜200 字
  draft: Required<CheckpointInput>[]; // 1〜8 件
  pace: RoadmapPace;
}

// ロードマップをモルティと話して直す（契約 §3.3 POST /api/goals/:id/roadmap/chat・#262）。確定はしない・何も保存しない
// 取り込んだ課題をタスクとして作る（契約 §3.3 POST /api/goals/import・#261）。目標の文も理由も要らない・AI なし
export interface ImportTaskItem {
  title: string; // 1〜200 字
  deadline: ISODate | null;
  minutes?: number | null; // 5〜600
  notes?: string; // 0〜500 字
}

export interface RoadmapChatRequest {
  message: string; // 1〜300 字
  draft?: CheckpointInput[]; // 0〜8 件（いまの編集欄の中身）
  history?: AgentTurn[]; // 0〜6 件・古い順
}
export interface RoadmapChatResult {
  reply: string; // 1〜200 字
  draft: Required<CheckpointInput>[]; // 3〜6 件
}

export interface CheckpointInput {
  title: string;
  doneMark: string;
  // 省略可（#268）。本人には聞かない。案から来た行だけ元の分を付け、無い行はサーバー（Gemini）が決める
  estimateMin?: number;
}

export interface RoadmapRequest {
  source: RoadmapSource;
  candidateId?: string;
  why: string;
  checkpoints: CheckpointInput[];
}

export interface TutorResult {
  messages: TutorMessage[];
  helpTotal: HelpTotal;
}

// 課題の取り込み（契約 §3.3 POST /api/goals/extract）。何も保存しない。候補を本人が選んで POST /api/goals で作る。
export interface ExtractRequest {
  text?: string; // 0〜6000 字
  images?: ReflectImage[]; // 0〜3 枚（text か images の少なくとも 1 つ）
}

export interface ExtractCandidate {
  text: string; // 1〜200 字
  deadline: ISODate | null; // 読み取れた時だけ（その日の日本時間 23:59）
  note?: string; // 0〜120 字・空なら付かない
}

// 今日の提案（契約 §3 POST /api/today）。何も保存しない。採るかは本人が決める。
export type TodayMinutes = 15 | 30 | 60 | 120;

export interface TodayProposalItem {
  goalId: string;
  checkpointId: string;
  title: string; // チェックポイントの title
  minutes: number; // チェックポイントの estimateMin
  reason: string; // 1〜80 字
}

export interface TodayResult {
  greeting: string; // 0〜80 字
  minutes: number;
  proposals: TodayProposalItem[]; // 0〜3 件
  totalMinutes: number;
  source: 'ai' | 'rules';
}

// モルティと話す（集中の外・契約 §3.12 POST /api/agent/chat・11/9）。進め方だけに答え、中身は集中へ誘導する。何も保存しない
export type AgentScreen = 'home' | 'tower' | 'friends' | 'settings' | 'plan' | 'start' | 'reflect';
export type AgentAction =
  | { kind: 'start'; goalId: string; checkpointId: string }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'reflect'; sessionId: string }
  | { kind: 'plan'; goalId: string }
  | { kind: 'write' }
  | { kind: 'import' }
  | { kind: 'tower' }
  | { kind: 'friends' }
  | { kind: 'settings' };
export interface AgentTurn {
  from: 'me' | 'agent';
  text: string; // 1〜300 字
}
export interface AgentChatRequest {
  screen: AgentScreen;
  goalId?: string;
  message: string; // 1〜300 字
  history?: AgentTurn[]; // 0〜6 件・古い順
}
export interface AgentChatResult {
  reply: string; // 1〜200 字
  actions: AgentAction[]; // 0〜3 件
  topic: 'plan' | 'content' | 'app';
  source: 'ai' | 'rules';
}

// 週のまとめ（契約 §3.11 GET /api/weekly）。数字はサーバーが計算し、文だけを AI が書く。何も保存しない。
export interface WeeklyStats {
  focusMinutes: number;
  sessions: number;
  floorsAdded: number;
  streak: number;
  helpSmall: number;
  helpMedium: number;
  selfDecided: number | null; // 階の「自分で決めた度」の平均。階が無ければ null
}

export interface WeeklyResult {
  from: ISODate; // 今日を含む直近 7 日の始まり
  to: ISODate;
  stats: WeeklyStats;
  summary: string | null; // 0〜240 字・3 行以内。集中が 0 件の週は null
  source: 'ai' | 'rules';
}

// 公開の設定（契約 §3.1b GET /api/config）
export interface PublicConfig {
  googleClientId: string | null;
}

// 画面から使う窓口。real と mock の両方がこれを満たす。
export interface Api {
  // auth は契約 §3.1 で必ず返る（mock は 'fake'）。任意にしているのは古いサーバー向け。loginRequired は invite の時だけ
  // demoSeed は DEMO_SEED=on のデモ用サーバーだけが true を付ける
  health(): Promise<{ ok: boolean; auth?: 'invite' | 'fake' | 'real'; loginRequired?: boolean; demoSeed?: boolean }>;
  // 画面が使う公開の設定（契約 §3.1b・認証なし）。googleClientId が null なら Google カレンダーのボタンを出さない
  config(): Promise<PublicConfig>;
  // デモ用の見本を入れる（DEMO_SEED=on のサーバーだけ。目標がある人には 409）
  demoSeed(): Promise<{ goalId: string; floors: number }>;
  home(): Promise<HomeData>;
  me(): Promise<User>;
  updateMe(body: { displayName?: string; nudgeLevel?: NudgeLevel }): Promise<User>;

  createGoal(body: { text: string; deadline: ISODate; minutesPerDay?: number | null; materials?: string }): Promise<Goal>;
  // 貼った文・写真から課題の候補を出す（最大 10 件・保存しない）
  extractGoals(body: ExtractRequest): Promise<{ candidates: ExtractCandidate[] }>;
  listGoals(): Promise<{ goals: Goal[] }>;
  getGoal(id: string): Promise<GoalDetail>;
  // 直す・やめる・戻す（#231）。AI は呼ばない
  updateGoal(id: string, body: { text?: string; deadline?: ISODate; minutesPerDay?: number | null }): Promise<Goal>;
  archiveGoal(id: string): Promise<Goal>;
  // 目標の資料（11/9・文字だけ・AI は呼ばない）
  addGoalDoc(goalId: string, body: { text: string; title?: string; from: GoalDoc['from'] }): Promise<GoalDoc>;
  updateGoalDoc(goalId: string, docId: string, body: { text?: string; title?: string }): Promise<GoalDoc>;
  deleteGoalDoc(goalId: string, docId: string): Promise<void>;
  restoreGoal(id: string): Promise<Goal>;
  // note: 案への本人の希望（#223・省略可・0〜200 字）。空なら送らない
  makeCandidates(goalId: string, note?: string): Promise<{ axes: Axis[]; candidates: Candidate[] }>;
  decideRoadmap(goalId: string, body: RoadmapRequest): Promise<Roadmap>;
  // 取り込んだ課題をタスクとして作る（1〜10 件・#261）。各件に「終わった」の 1 歩の道が付く
  importTasks(items: ImportTaskItem[]): Promise<{ goals: Goal[] }>;
  // モルティと話して道の下書きを直す（#262）。確定は decideRoadmap だけ（P1）
  roadmapChat(goalId: string, body: RoadmapChatRequest): Promise<RoadmapChatResult>;
  // 確定したロードマップの残りの直しの下書き（#353・保存しない）。決めるのは replaceRemaining だけ（P1）
  reviseRoadmap(goalId: string, body: RoadmapReviseRequest): Promise<RoadmapReviseResult>;
  // 未完了のチェックポイントを、この並びで置き換える（終わった物は前に残る・1〜8 件）
  replaceRemaining(goalId: string, checkpoints: CheckpointInput[]): Promise<Roadmap>;

  startSession(body: { goalId: string; checkpointId: string; oneLine: string; materials?: string }): Promise<Session>;
  // 手元の紙の写真・PDF・テキストを文字にする（保存しない・写真 0〜3 枚＋ファイル 0〜2 件・どちらか 1 つは要る）
  readMaterials(images: ReflectImage[], files?: MaterialFile[]): Promise<{ text: string }>;
  // 話した声を文字にする（契約 §3.7c・保存しない・1,500,000 バイト・約 60 秒まで。超えたら 413）
  transcribe(audio: { mimeType: string; dataBase64: string }): Promise<{ text: string }>;
  activeSession(): Promise<{ session: Session | null }>;
  sendEvent(sessionId: string, type: 'leave' | 'return'): Promise<FocusEvent>;
  endSession(sessionId: string): Promise<{ session: Session; floor: Floor }>;

  tutorHistory(sessionId: string): Promise<TutorResult>;
  tutor(sessionId: string, body: TutorRequest): Promise<TutorResult>;
  // 「手が止まった」「合ってるか確認」の候補（契約 §3.5・#253）。失敗時はサーバーが固定の候補を返す
  stuckOptions(sessionId: string, intent: TutorIntent): Promise<StuckOptionsResult>;

  reflect(sessionId: string, body: ReflectRequest): Promise<ReflectResult>;
  confirmReflect(sessionId: string, achievement: Achievement): Promise<ConfirmResult>;

  tower(): Promise<{ floors: Floor[]; totalFloors: number; streak: number }>;
  points(): Promise<PointsData>;

  // 今日使える時間から、次の一歩の提案（0〜3 件）とあいさつ
  // note: 本人の今日の希望（0〜200 字・省略可・#222）。空なら送らない
  today(minutes?: TodayMinutes, note?: string): Promise<TodayResult>; // minutes 省略時は合計の目安 60 分（#265）
  // 直近 7 日の積み上げと、やり方の変化の短い文
  weekly(): Promise<WeeklyResult>;
  // 集中の外でモルティに進め方を相談する（§3.12）
  agentChat(body: AgentChatRequest): Promise<AgentChatResult>;

  addFriend(code: string): Promise<Friendship>;
  acceptFriend(friendshipId: string): Promise<Friendship>;
  friends(): Promise<{ friends: FriendEntry[] }>;
  feed(): Promise<{ items: FeedItem[] }>;

  // 端末への通知（Web Push・契約 §3.7c）。サーバーに鍵が無い時は 3 つとも 404
  pushKey(): Promise<{ publicKey: string }>;
  pushSubscribe(body: PushSubscriptionBody): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;

  // Android アプリの FCM トークン（#299・POST|DELETE /api/push/device → 204）。サーバーは別 Issue
  registerDevice(token: string): Promise<void>;
  unregisterDevice(token: string): Promise<void>;
}

export interface DeviceTokenBody {
  token: string;
  platform: 'android';
}

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
