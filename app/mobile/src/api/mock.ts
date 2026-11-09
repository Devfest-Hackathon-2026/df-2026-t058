// mock モード: サーバーなしで端末の中だけで流れを通す（EXPO_PUBLIC_API_MODE=mock）。
// 応答は契約の形どおり。AI の返事と判定は決め打ちの偽物。データはメモリだけ（再読み込みで消える）。

import { ApiError } from './errors';
import type {
  AgentAction,
  Achievement,
  Api,
  Axis,
  AxisValue,
  Candidate,
  CandidateCheckpoint,
  Checkpoint,
  CheckpointInput,
  ExtractCandidate,
  FeedItem,
  Floor,
  FocusEvent,
  Friendship,
  Goal,
  HelpLevel,
  NudgeLevel,
  PointItem,
  PointsData,
  ReflectImage,
  ReflectRequest,
  Roadmap,
  RoadmapSource,
  Session,
  StuckCause,
  StuckOptionsResult,
  TutorMessage,
  User,
  TodayFloor,
  HomeFriend,
  GoalDoc,
} from './types';
import { DEFAULT_AXES } from '../lib/axes';
import { MAX_REFLECT_BODY_BYTES, reflectBodyBytes } from '../lib/bodySize';
import { editRatio } from '../lib/editRatio';
import { MATERIAL_FILE_LIMITS, MAX_MATERIAL_FILES } from '../lib/materialsState';
import { REMAKE_NOTE_MAX } from '../lib/planView';
import { stepsProblem } from '../lib/roadmapLimits';
import { fakeRevise, normalizeDraft, paceOf, remainingDraft, REVISE_DRAFT_MAX, REVISE_TOTAL_MAX, REVISE_TOTAL_MIN } from '../lib/roadmapRevise';
import { colorFor, floorsFor, focusMinutes, ownScore } from '../lib/score';
import { MAX_AUDIO_BYTES } from '../lib/voice';

export interface MockOptions {
  now?: () => number;
  // AI を呼んだ時の待ち時間（ミリ秒）。試験では 0。
  aiDelayMs?: number;
  // 作業時間の倍率。60 なら 1 秒を 1 分として数える（デモで階を早く見る用）。
  speed?: number;
}

// サーバーの app/api/src/roadmap/axes.js と同じ軸（11/9 に決めた 5 本）。
const AXES: Axis[] = DEFAULT_AXES;

const PLANS: { label: string; summary: string; axes: Record<string, AxisValue>; steps: [string, string, number][] }[] = [
  {
    label: '問題から入る',
    summary: '例題と練習問題を解き進める案（偽のデータ）',
    axes: { amount: 3, difficulty: 3, approachability: 4, growth: 3, steady: 4 },
    steps: [
      ['例題を 3 問解く', '例題を 3 問、正しく解けた', 30],
      ['練習問題を 5 問解く', '5 問中 4 問を正しく解けた', 30],
      ['過去の小テストを解く', '時間内に全部解けた', 30],
      ['間違えた所を解き直す', '間違えた問題を何も見ずに解けた', 20],
    ],
  },
  {
    label: '先にまとめる',
    summary: '要点をまとめてから数をこなす案（偽のデータ）',
    axes: { amount: 4, difficulty: 2, approachability: 5, growth: 2, steady: 2 },
    steps: [
      ['要点を 1 枚にまとめる', '公式とやり方を何も見ずに書けた', 40],
      ['練習問題を 10 問解く', '10 問中 8 問を正しく解けた', 60],
      ['間違えた所を解き直す', '間違えた問題を何も見ずに解けた', 30],
    ],
  },
  {
    label: '小テストから',
    summary: '先に小テストを解いて弱い所を探す案（偽のデータ）',
    axes: { amount: 2, difficulty: 4, approachability: 2, growth: 5, steady: 3 },
    steps: [
      ['過去の小テストを先に解く', '解けた所と解けない所を分けられた', 30],
      ['解けなかった所の例題を読む', 'やり方を自分の言葉で書けた', 30],
      ['同じ形の問題を 3 問解く', '3 問とも正しく解けた', 30],
      ['小テストをもう一度解く', '前より多く正しく解けた', 30],
    ],
  },
];

const NEXT_STEPS: Record<StuckCause, string[]> = {
  unclear_goal: ['完了の目印を 1 行で書き直す', '最初の 1 問だけ決める'],
  missing_knowledge: ['例題を 1 問だけ読む', '分からない言葉を 1 つ調べる', '教科書の該当ページを開く'],
  too_big: ['1 問だけ解く', '10 分で終わる所まで切る'],
  tired: ['5 分だけ続ける', '明日の最初にやる 1 問を決める'],
  distracted: ['通知を切って 10 分だけ', '机の上を 1 つ片づけてから始める'],
  other: ['次にやる 1 つを書く', '詰まった所を 1 行で書く'],
};

// サーバーと同じ上限（app/api/src/reflect/routes.js・roadmap/limits.js・friends/routes.js）
const IMAGE_TYPES: string[] = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 1_500_000; // 1 枚（base64 を戻した後）
const MAX_GOALS_PER_USER = 20;
const FRIEND_REQUESTS_PER_DAY = 20;
const FRIEND_MISSES_PER_DAY = 5;
const FEED_WINDOW_MS = 24 * 60 * 60 * 1000;

// base64 を戻した後のバイト数（全体を戻さずに長さで出す）
const base64Bytes = (s: string) => {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor(s.length / 4) * 3 - pad;
};

interface Person {
  id: string;
  displayName: string;
  friendCode: string;
}

export function createMockApi(opts: MockOptions = {}): Api {
  const now = opts.now ?? (() => Date.now());
  const aiDelay = opts.aiDelayMs ?? 900;
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const iso = () => new Date(now()).toISOString();
  let seq = 0;
  const newId = (p: string) => `${p}-${++seq}`;
  const wait = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
  const fail = (status: number, code: string, message = ''): never => {
    throw new ApiError(status, code, message);
  };
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  const me: User = {
    id: 'me',
    friendCode: 'K7Q2MX',
    displayName: '', // サーバーと同じ初期値（名前は友達の画面で本人が付ける）
    nudgeLevel: 'strong', // 11/9 から全員 strong 固定（サーバーと同じ）
    streak: 0,
    createdAt: iso(),
  };
  const people: Person[] = [
    { id: 'u-taro', displayName: 'たろう', friendCode: 'TARO01' },
    { id: 'u-hana', displayName: 'はなこ', friendCode: 'HANA02' },
    { id: 'u-ken', displayName: 'けん', friendCode: 'KEN003' },
    { id: 'u-mio', displayName: 'みお', friendCode: 'MIO004' },
    { id: 'u-sota', displayName: 'そうた', friendCode: 'SOTA05' },
  ];
  const activeFriends = new Set(['u-taro']);
  // 友達の階数と連続日数（承認済みの時だけ返す・サーバーと同じ）
  const friendStats: Record<string, { floors: number; streak: number }> = {
    'u-taro': { floors: 12, streak: 4 },
    'u-hana': { floors: 6, streak: 2 },
    'u-ken': { floors: 3, streak: 1 },
  };
  const friendships: Friendship[] = [
    { id: 'f-taro', userId: 'me', friendId: 'u-taro', status: 'accepted', notifyOnStart: true },
    { id: 'f-hana', userId: 'u-hana', friendId: 'me', status: 'pending', notifyOnStart: true },
    { id: 'f-mio', userId: 'u-mio', friendId: 'me', status: 'accepted', notifyOnStart: true },
    { id: 'f-sota', userId: 'me', friendId: 'u-sota', status: 'accepted', notifyOnStart: true },
  ];
  // 友達が今日積んだ階（ホームの一番上の列の見本・11/9）。承認済みの時だけ返す（サーバーと同じ）
  const friendToday: Record<string, TodayFloor[]> = {
    'u-taro': [{ id: 'mock-taro:0', color: 'silver' }],
    'u-hana': [{ id: 'mock-hana:0', color: 'bronze' }, { id: 'mock-hana:1', color: 'gold' }],
    'u-ken': [{ id: 'mock-ken:0', color: 'silver' }],
    'u-mio': [{ id: 'mock-mio:0', color: 'bronze' }, { id: 'mock-mio:1', color: 'gold' }],
    'u-sota': [],
  };
  const feedItems: FeedItem[] = [
    { userId: 'u-taro', displayName: 'たろう', oneLine: '英単語 30 個', at: new Date(now() - 20 * 60000).toISOString() },
  ];

  const goals: Goal[] = [];
  const roadmaps = new Map<string, Roadmap>(); // goalId →
  const candidates = new Map<string, Candidate[]>(); // goalId →
  const sessions: Session[] = [];
  const events = new Map<string, FocusEvent[]>(); // sessionId →
  const away = new Set<string>(); // いま離れている集中（サーバーと同じく、二重の leave と leave の無い return は 409）
  const tutor = new Map<string, TutorMessage[]>();
  const floors: Floor[] = [];
  // 相談の回数と、考え（thought）を付けた回数（集中ごと・サーバーの asks / thoughtAsks と同じ意味）
  const askCounts = new Map<string, { asks: number; thoughtAsks: number }>();
  // 判定は集中ごとに持つ（サーバーと同じ）。seq は振り返った順（チェックポイントへ写すのは最後の物）。
  interface Judged {
    judgeable: boolean;
    ai: Achievement | null;
    mine: Achievement | null; // 最終の判定（confirm で本人が決め直す。初めは ai と同じ）
    reason: string;
    nextSteps: string[];
    seq: number;
  }
  const achievements = new Map<string, Judged>();
  let reflectSeq = 0;

  const goalOf = (id: string) => goals.find((g) => g.id === id) ?? fail(404, 'not_found');
  const sessionOf = (id: string) => sessions.find((s) => s.id === id) ?? fail(404, 'not_found');
  const activeOf = () => sessions.find((s) => !s.endedAt) ?? null;
  const checkpointOf = (s: Session): Checkpoint | undefined =>
    roadmaps.get(s.goalId)?.checkpoints.find((c) => c.id === s.checkpointId);

  const helpTotal = (sessionId: string) => {
    const list = tutor.get(sessionId) ?? [];
    return {
      small: list.filter((m) => m.helpLevel === 'small').length,
      medium: list.filter((m) => m.helpLevel === 'medium').length,
    };
  };

  const toCandidateCheckpoints = (steps: CheckpointInput[]): CandidateCheckpoint[] =>
    steps.map((s, i) => ({ id: newId('ccp'), order: i + 1, title: s.title, doneMark: s.doneMark, estimateMin: s.estimateMin ?? 30 }));

  const toCheckpoints = (steps: CheckpointInput[]): Checkpoint[] =>
    steps.map((s, i) => ({
      id: newId('cp'),
      order: i + 1,
      title: s.title,
      doneMark: s.doneMark,
      estimateMin: s.estimateMin ?? 30, // 省略した行（#268）は見本では 30 分
      state: 'todo',
      achievement: null,
    }));

  // 連続記録はサーバーの score/streak.js と同じ規則: 集中を終えた日（階が 0 でもよい）を JST の暦日で数え、
  // 今日がまだでも昨日まで続いていれば切れない。
  const JST_MS = 9 * 3600000;
  const dayKey = (t: number) => new Date(t + JST_MS).toISOString().slice(0, 10);
  const streak = () => {
    const days = new Set(sessions.filter((x) => x.endedAt).map((x) => dayKey(Date.parse(x.endedAt!))));
    let t = now();
    if (!days.has(dayKey(t))) t -= 86400000;
    let n = 0;
    for (; days.has(dayKey(t)); t -= 86400000) n++;
    return n;
  };
  const totalFloors = () => floors.reduce((a, f) => a + f.floors, 0);

  // 点と色に使う達成度（サーバーの score/rules.js の scoredAchievement と同じ・契約 §3.6）:
  // 本人の判定と AI の判定の低い方。本人が null なら 0、AI が null なら本人の値。
  const scored = (mine: Achievement | null, ai: Achievement | null): number =>
    ai === null ? mine ?? 0 : Math.min(mine ?? 0, ai);
  const donePt = (f: Floor) => [0, 5, 10, 15][scored(f.achievement, f.aiAchievement ?? null)] ?? 0;

  // 考えポイント（仮の簡易版・規則の正典は docs/points.md）。集中 5 分ごとに 1（1 回 12 まで）＋振り返りの達成度 5／10／15。
  // 減点は無い。記録から毎回計算する（保存しない）。
  const pointsNow = (): PointsData => {
    const items: PointItem[] = [];
    // 目標ごとの内訳（#351）: 階の集中の目標に足す。並びは最後に増えた時刻の新しい順
    const perGoal = new Map<string, { pt: number; lastAt: number }>();
    for (const f of floors) {
      const focus = Math.min(12, Math.floor(Math.max(0, f.focusMin) / 5));
      if (focus > 0) items.push({ at: f.at, kind: 'focus', pt: focus, label: `${f.focusMin} 分集中した` });
      const done = donePt(f);
      if (done > 0) items.push({ at: f.at, kind: 'done', pt: done, label: 'チェックポイントを終えた' });
      const goalId = sessions.find((s) => s.id === f.sessionId)?.goalId;
      if (goalId && focus + done > 0) {
        const cur = perGoal.get(goalId) ?? { pt: 0, lastAt: 0 };
        perGoal.set(goalId, { pt: cur.pt + focus + done, lastAt: Math.max(cur.lastAt, Date.parse(f.at)) });
      }
    }
    items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const sum = (xs: PointItem[]) => xs.reduce((a, x) => a + x.pt, 0);
    const today = dayKey(now());
    const byGoal = [...perGoal]
      .sort(([, a], [, b]) => b.lastAt - a.lastAt)
      .flatMap(([goalId, { pt }]) => {
        const g = goals.find((x) => x.id === goalId);
        return g ? [{ goalId, text: g.text, pt, archived: Boolean(g.archivedAt) }] : [];
      });
    return {
      total: sum(items),
      today: sum(items.filter((x) => dayKey(Date.parse(x.at)) === today)),
      week: sum(items.filter((x) => Date.parse(x.at) > now() - 7 * 86400000)),
      items: items.slice(0, 50),
      byGoal,
    };
  };

  // 階を（作り直して）出す。元の記録（events・相談・達成度）から毎回計算する（P5）。
  function computeFloor(s: Session): Floor {
    const rm = roadmaps.get(s.goalId);
    const help = helpTotal(s.id);
    const ach = achievements.get(s.id);
    const achievement = ach ? ach.mine : null;
    const own = ownScore(rm?.adopted ?? 'candidate', rm?.editRatio, help.small, help.medium);
    const focusMin = s.focusMin ?? 0;
    const existing = floors.find((f) => f.sessionId === s.id);
    const floor: Floor = {
      id: existing?.id ?? newId('fl'),
      userId: me.id,
      sessionId: s.id,
      focusMin,
      at: existing?.at ?? s.endedAt ?? iso(),
      timeScore: focusMin,
      achievementScore: achievement ?? 0,
      achievement,
      aiAchievement: ach ? ach.ai : null,
      ownScore: own,
      floors: floorsFor(focusMin),
      color: colorFor(own, scored(achievement, ach ? ach.ai : null) as Achievement),
      derivedFrom: (events.get(s.id) ?? []).map((e) => e.id),
      // pt・home.points は、見本の形（contract-shapes.json）に入るまで返さない（契約 §3.6b・asks と同じ扱い）。
      // 入ったら、ここに pt（集中＋達成）を足す
      ...(askCounts.get(s.id) ?? { asks: 0, thoughtAsks: 0 }),
    };
    if (existing) floors.splice(floors.indexOf(existing), 1, floor);
    else floors.push(floor);
    me.streak = streak();
    return floor;
  }

  function addEvent(sessionId: string, type: string): FocusEvent {
    const ev: FocusEvent = { id: newId('ev'), userId: me.id, sessionId, type, at: iso() };
    const list = events.get(sessionId) ?? [];
    list.push(ev);
    events.set(sessionId, list);
    return ev;
  }

  function aiReply(
    kind: 'ask' | 'research',
    text: string,
  ): { text: string; helpLevel: HelpLevel; sources?: TutorMessage['sources'] } {
    if (kind === 'research') {
      const q = text.trim().slice(0, 40);
      return {
        text: `「${q}」の要点です（偽のデータ）。`,
        helpLevel: 'small', // サーバーと同じく、AI の返事は必ず small か medium（調べた事実だけ＝small）
        sources: [{ title: 'ja.wikipedia.org', url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(q)}` }],
      };
    }
    if (/答え|こたえ|正解/.test(text)) {
      return { text: '答えは言えないんです。まずは、式のどこから手を付けるか考えてみてください。', helpLevel: 'small' };
    }
    if (/教えて|やり方|方法|どうやって|どうすれば|解き方/.test(text)) {
      return {
        text: 'まずは問題を小さく分けてみてください。分けた 1 つ目を解いて、その結果を次に使います。どこまで分けられそうですか。',
        helpLevel: 'medium',
      };
    }
    return { text: 'そう考えた理由を 1 つ書いてください。', helpLevel: 'small' };
  }

  // そのチェックポイントで最後に振り返った集中（サーバーの latestReflected と同じ）
  const latestReflected = (s: Session): Session | null => {
    let best: Session | null = null;
    for (const x of sessions) {
      if (x.goalId !== s.goalId || x.checkpointId !== s.checkpointId) continue;
      const j = achievements.get(x.id);
      if (j && (!best || j.seq > achievements.get(best.id)!.seq)) best = x;
    }
    return best;
  };
  // チェックポイントの達成度・状態を、最後に振り返った集中から写す。完了は最終の判定が 3 の時だけ
  const syncCheckpoint = (s: Session) => {
    const cp = checkpointOf(s);
    const latest = latestReflected(s);
    const j = latest ? achievements.get(latest.id) : undefined;
    if (!cp || !j) return;
    cp.achievement = j.mine;
    cp.aiAchievement = j.ai;
    cp.achievementReason = j.reason;
    cp.state = j.mine === 3 ? 'done' : 'doing';
  };

  const checkLen = (v: unknown, min: number, max: number) =>
    typeof v === 'string' && v.trim().length >= min && v.length <= max;

  // 写真の検査（サーバーの reflect/routes.js の parseImages と同じ規則）。本文全体の 6MB 超えは 413、
  // 1 枚の大きさ・枚数・形式の違いは 400（サーバーは本文を読む段階で 413、中身の検査で 400 を返す）。
  // 先頭のバイトの検査はしない（試験の見本の写真が通らなくなるため・本物との差は docs/contract-audit-2026-11-07.md）。
  const checkImages = (body: { images: ReflectImage[] }, max: number) => {
    if (!Array.isArray(body.images)) fail(400, 'invalid_argument', '写真の形が違います');
    if (reflectBodyBytes(body) > MAX_REFLECT_BODY_BYTES) fail(413, 'too_large', '写真が大きすぎます');
    if (body.images.length > max) fail(400, 'invalid_argument', `写真は ${max} 枚まで`);
    for (const img of body.images) {
      if (!IMAGE_TYPES.includes(img.mimeType)) fail(400, 'invalid_argument', '写真の形式が違います');
      if (base64Bytes(img.dataBase64) > MAX_IMAGE_BYTES) fail(400, 'invalid_argument', '写真が大きすぎます');
    }
  };

  // 友達申請の回数（サーバーの FRIEND_REQUEST_LIMIT と同じ・日の区切りは UTC）
  const friendTries = new Map<string, { sent: number; misses: number }>();
  const triesToday = () => {
    const day = new Date(now()).toISOString().slice(0, 10);
    const t = friendTries.get(day) ?? { sent: 0, misses: 0 };
    friendTries.set(day, t);
    return t;
  };

  // 友達の知らせ（サーバーと同じ: 11/9 から強め固定で常に出す・過去 24 時間・新しい順・50 件まで）
  const feedNow = (): FeedItem[] =>
    feedItems
      .filter((x) => Date.parse(x.at) >= now() - FEED_WINDOW_MS)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 50);
  // ホームの一番上の友達の列（サーバーと同じ並び: 取り組み中 → 今日積んだ人 → それ以外）
  const homeFriendsNow = (): HomeFriend[] =>
    friendships
      .filter((f) => f.status === 'accepted' && (f.userId === me.id || f.friendId === me.id))
      .map((f) => {
        const id = f.userId === me.id ? f.friendId : f.userId;
        return { userId: id, displayName: people.find((x) => x.id === id)?.displayName ?? '', activeNow: activeFriends.has(id), today: friendToday[id] ?? [] };
      })
      .sort((a, b) => Number(b.activeNow) - Number(a.activeNow) || b.today.length - a.today.length);

  return {
    async health() {
      return { ok: true, auth: 'fake' as const };
    },

    // mock では Google カレンダーを使わない（ボタンを出さない）
    async config() {
      return { googleClientId: null };
    },

    async demoSeed() {
      throw new ApiError(404, 'not_found', '');
    },

    async home() {
      me.streak = streak();
      return copy({
        me,
        goals: goals.filter((g) => !g.archivedAt).map((goal) => ({ goal, roadmap: roadmaps.get(goal.id) ?? null })),
        active: activeOf(),
        tower: { totalFloors: totalFloors(), streak: streak() },
        feed: feedNow(),
        friends: homeFriendsNow(),
        toReflect: sessions
          .filter((x) => x.endedAt && !x.reflectedAt)
          .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))
          .slice(0, 3),
      });
    },

    async points() {
      return copy(pointsNow());
    },

    async me() {
      me.streak = streak();
      return copy(me);
    },

    async updateMe(b: { displayName?: string; nudgeLevel?: NudgeLevel }) {
      if (b.displayName !== undefined) {
        if (!checkLen(b.displayName, 1, 30)) fail(400, 'invalid_argument', '表示名は 1〜30 文字');
        me.displayName = b.displayName.trim();
      }
      if (b.nudgeLevel !== undefined) {
        // 型だけ確かめて保存しない（11/9 から全員 strong 固定・サーバーと同じ）
        if (!['off', 'friend_start', 'strong'].includes(b.nudgeLevel)) fail(400, 'invalid_argument');
      }
      return copy(me);
    },

    async createGoal(b) {
      if (!checkLen(b.text, 1, 500)) fail(400, 'invalid_argument', '目標は 1〜500 文字');
      if (Number.isNaN(Date.parse(b.deadline))) fail(400, 'invalid_argument', '期限が不正');
      const minutesPerDay = b.minutesPerDay ?? null; // 省略・null はおまかせ
      if (minutesPerDay !== null && !(typeof minutesPerDay === 'number' && minutesPerDay >= 5 && minutesPerDay <= 600)) {
        fail(400, 'invalid_argument', '1 日の時間は 5〜600 分');
      }
      if (b.materials !== undefined && (typeof b.materials !== 'string' || b.materials.length > 2000)) {
        fail(400, 'invalid_argument', '資料は 2000 文字まで');
      }
      if (goals.length >= MAX_GOALS_PER_USER) fail(409, 'conflict', `目標は ${MAX_GOALS_PER_USER} 件までです`);
      const goal: Goal = {
        id: newId('goal'),
        userId: me.id,
        text: b.text.trim(),
        deadline: new Date(b.deadline).toISOString(),
        minutesPerDay,
        status: 'active',
        ...(b.materials !== undefined ? { materials: b.materials.trim() } : {}),
        createdAt: iso(),
      };
      goals.push(goal);
      return copy(goal);
    },

    async extractGoals(b) {
      // 検査はサーバー（import/routes.js）と同じ: text は 0〜6000 字、写真は 0〜3 枚、どちらかは要る
      const text = b.text ?? '';
      if (typeof text !== 'string' || text.length > 6000) fail(400, 'invalid_argument', '文は 6000 文字まで');
      const images = b.images ?? [];
      checkImages({ images }, 3);
      if (text.trim() === '' && images.length === 0) fail(400, 'invalid_argument', '文か写真が要ります');
      await wait(aiDelay);
      // 保存しない。決まった偽の候補 3 件（期限は日本時間のその日の 23:59・1 件は期限なし）
      const jstDay = (days: number) =>
        `${new Date(now() + days * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10)}T14:59:00.000Z`;
      const candidates: ExtractCandidate[] = [
        { text: '【偽】数学 レポート（二次関数のグラフ）', deadline: jstDay(3), note: 'LMS に PDF で提出' },
        { text: '【偽】英語 単語の小テスト（Unit 5）', deadline: jstDay(10) },
        { text: '【偽】情報 プログラミング課題 第 3 回', deadline: null },
      ];
      return copy({ candidates });
    },

    async listGoals() {
      return copy({ goals });
    },

    // 直す（題・期限・1 日の時間）。検査は createGoal と同じ。道は変えない
    async updateGoal(id, b) {
      const goal = goalOf(id);
      if (b.text === undefined && b.deadline === undefined && b.minutesPerDay === undefined) fail(400, 'invalid_argument');
      if (b.text !== undefined && !checkLen(b.text, 1, 500)) fail(400, 'invalid_argument', '目標は 1〜500 文字');
      if (b.deadline !== undefined && Number.isNaN(Date.parse(b.deadline))) fail(400, 'invalid_argument', '期限が不正');
      const m = b.minutesPerDay;
      if (m !== undefined && m !== null && !(typeof m === 'number' && m >= 5 && m <= 600)) {
        fail(400, 'invalid_argument', '1 日の時間は 5〜600 分');
      }
      if (b.text !== undefined) goal.text = b.text.trim();
      if (b.deadline !== undefined) goal.deadline = new Date(b.deadline).toISOString();
      if (m !== undefined) goal.minutesPerDay = m;
      return copy(goal);
    },

    // 目標の資料（サーバーと同じ: 文字 1〜2000・題 1〜40・10 件まで）
    async addGoalDoc(id, b) {
      const goal = goalOf(id);
      if (!checkLen(b.text ?? '', 1, 2000)) fail(400, 'invalid_argument');
      if (!['goal', 'plan', 'focus', 'reflect'].includes(b.from)) fail(400, 'invalid_argument');
      const docs = goal.docs ?? [];
      if (docs.length >= 10) fail(409, 'conflict', '資料は 10 件までです');
      const first = b.text.split('\n').map((x) => x.trim()).find(Boolean) ?? '資料';
      const doc: GoalDoc = { id: `doc-${docs.length + 1}-${Date.now()}`, title: (b.title ?? [...first].slice(0, 40).join('')), text: b.text, from: b.from, addedAt: iso() };
      goal.docs = [...docs, doc];
      return copy(doc);
    },
    async updateGoalDoc(id, docId, b) {
      const goal = goalOf(id);
      const doc = (goal.docs ?? []).find((d) => d.id === docId);
      if (!doc) fail(404, 'not_found');
      if (b.text === undefined && b.title === undefined) fail(400, 'invalid_argument');
      if (b.text !== undefined) doc!.text = b.text;
      if (b.title !== undefined) doc!.title = b.title;
      doc!.updatedAt = iso();
      return copy(doc!);
    },
    async deleteGoalDoc(id, docId) {
      const goal = goalOf(id);
      goal.docs = (goal.docs ?? []).filter((d) => d.id !== docId);
    },

    async archiveGoal(id) {
      const goal = goalOf(id);
      goal.archivedAt = goal.archivedAt ?? iso();
      return copy(goal);
    },

    async restoreGoal(id) {
      const goal = goalOf(id);
      delete goal.archivedAt;
      return copy(goal);
    },

    async getGoal(id) {
      const goal = goalOf(id);
      const roadmap = roadmaps.get(id) ?? null;
      const pace = paceOf({ roadmap, deadline: goal.deadline, minutesPerDay: goal.minutesPerDay, now: now() });
      return copy({ goal, roadmap, candidates: candidates.get(id) ?? [], axes: AXES, pace });
    },

    async makeCandidates(goalId, note) {
      goalOf(goalId);
      // 希望（#223）は見本では案を変えない。長さだけサーバーと同じに検査する
      if (note !== undefined && Array.from(note.trim()).length > REMAKE_NOTE_MAX) {
        fail(400, 'invalid_argument', `note: ${REMAKE_NOTE_MAX} 文字までにしてください`);
      }
      // 確定後は作り直せない（サーバーと同じ 409）
      if (roadmaps.has(goalId)) fail(409, 'conflict', 'ロードマップはもう確定しています');
      await wait(aiDelay * 1.5);
      const list: Candidate[] = PLANS.map((p) => ({
        id: newId('cand'),
        label: p.label,
        summary: p.summary,
        axes: { ...p.axes },
        checkpoints: toCandidateCheckpoints(p.steps.map(([title, doneMark, estimateMin]) => ({ title, doneMark, estimateMin }))),
      }));
      candidates.set(goalId, list);
      return copy({ axes: AXES, candidates: list });
    },

    async importTasks(items) {
      // サーバー（roadmap/routes.js の POST /api/goals/import）と同じ: 1 件でも外れたら 400・目標と合わせて 20 件まで。AI なし
      if (!Array.isArray(items) || items.length < 1 || items.length > 10) fail(400, 'invalid_argument', '1〜10 件');
      for (const it of items) {
        if (!checkLen(it.title, 1, 200)) fail(400, 'invalid_argument', '題は 1〜200 文字');
        if (it.deadline !== null && Number.isNaN(Date.parse(it.deadline))) fail(400, 'invalid_argument', '期限が不正');
      }
      if (goals.length + items.length > MAX_GOALS_PER_USER) fail(409, 'conflict', `目標は ${MAX_GOALS_PER_USER} 件までです`);
      const made: Goal[] = items.map((it) => {
        const goal: Goal = {
          id: newId('goal'),
          userId: me.id,
          text: it.title.trim(),
          deadline: it.deadline ? new Date(it.deadline).toISOString() : iso(),
          minutesPerDay: null,
          status: 'active',
          kind: 'task',
          ...(it.notes?.trim() ? { materials: it.notes.trim() } : {}),
          createdAt: iso(),
        };
        goals.push(goal);
        roadmaps.set(goal.id, {
          id: newId('rm'),
          goalId: goal.id,
          userId: me.id,
          adopted: 'auto',
          why: '',
          checkpoints: toCheckpoints([{ title: goal.text, doneMark: '終わった', estimateMin: it.minutes ?? 30 }]),
          createdAt: iso(),
        });
        return goal;
      });
      return copy({ goals: made });
    },

    async roadmapChat(goalId, b) {
      // サーバーの GEMINI_MODE=fake（roadmap/chat.js の fakeRoadmapChat）と同じ形。「短く」と言われたら 3 つに縮める。何も保存しない
      const msg = typeof b?.message === 'string' ? b.message.trim() : '';
      if (Array.from(msg).length < 1 || Array.from(msg).length > 300) fail(400, 'invalid_argument', '1〜300 字で書いてください');
      if (!goals.some((g) => g.id === goalId)) fail(404, 'not_found', '目標が見つかりません');
      if (roadmaps.get(goalId)) fail(409, 'conflict', 'ロードマップはもう確定しています');
      await wait(aiDelay);
      const kept = (b.draft ?? []).filter((c) => c.title && c.doneMark).slice(0, /短く/.test(msg) ? 3 : 6);
      const draft = kept.map((c) => ({ ...c, estimateMin: Math.min(240, Math.max(5, c.estimateMin ?? 30)) }));
      for (let i = draft.length; i < 3; i++) draft.push({ title: `ステップ${i + 1}（偽）`, doneMark: `ステップ${i + 1}ができた（偽）`, estimateMin: 30 });
      return copy({ reply: '話してくれた内容で、道を整えました（偽の返事）。', draft });
    },

    async reviseRoadmap(goalId, b) {
      // サーバーの GEMINI_MODE=fake と同じ直し方（lib/roadmapRevise.ts の fakeRevise）。何も保存しない
      const msg = b?.message === undefined ? undefined : typeof b.message === 'string' ? b.message.trim() : '';
      if (msg !== undefined && (Array.from(msg).length < 1 || Array.from(msg).length > 300)) fail(400, 'invalid_argument', '1〜300 字で書いてください');
      if (b?.draft !== undefined && (!Array.isArray(b.draft) || b.draft.length > REVISE_DRAFT_MAX)) fail(400, 'invalid_argument', '下書きは 8 件まで');
      if (b?.history !== undefined && (!Array.isArray(b.history) || b.history.length > 6)) fail(400, 'invalid_argument', 'やり取りは 6 件まで');
      const goal = goals.find((g) => g.id === goalId) ?? fail(404, 'not_found', '目標が見つかりません');
      const rm = roadmaps.get(goalId) ?? fail(404, 'not_found', 'ロードマップがありません');
      await wait(aiDelay);
      const pace = paceOf({ roadmap: rm, deadline: goal.deadline, minutesPerDay: goal.minutesPerDay, now: now() });
      const doneCount = rm.checkpoints.filter((c) => c.state === 'done').length;
      const given = normalizeDraft(b?.draft ?? []);
      const base = given.length > 0 ? given : normalizeDraft(remainingDraft(rm.checkpoints));
      // 【見本の判断】pace に合わせた直しは最初の 1 回（message 無し）だけ。話した後は下書きをそのまま返す（毎回縮む・増えるのを防ぐ）
      const draft = msg === undefined ? fakeRevise(pace, base, doneCount) : base;
      if (draft.length === 0) draft.push({ title: 'ステップ1（偽）', doneMark: 'ステップ1ができた（偽）', estimateMin: 30 });
      const reply =
        msg !== undefined
          ? '話してくれた内容で、残りを整えました（偽の返事）。'
          : pace === 'behind'
            ? '最後の 1 つを今回は外して、期限までに収まる形にしました（偽の返事）。'
            : pace === 'ahead'
              ? '余裕があるので、最後に仕上げを 1 つ足しました（偽の返事）。'
              : '今の残りを並べました。直したい所を話してください（偽の返事）。';
      return copy({ reply, draft, pace });
    },

    async replaceRemaining(goalId, list) {
      // 終わった物はそのまま前に残し、未完了をこの並びで置き換える。点・理由・確定の時刻は変えない（契約 §3.3）
      if (!Array.isArray(list) || list.length < 1 || list.length > REVISE_DRAFT_MAX) fail(400, 'invalid_argument', '1〜8 件');
      for (const c of list) {
        if (!checkLen(c?.title, 1, 100)) fail(400, 'invalid_argument', 'やることは 1〜100 字');
        if (!checkLen(c?.doneMark, 1, 200)) fail(400, 'invalid_argument', '完了の目印は 1〜200 字');
        if (c.estimateMin !== undefined && !(Number.isInteger(c.estimateMin) && c.estimateMin >= 1 && c.estimateMin <= 6000)) {
          fail(400, 'invalid_argument', '見込みは 1〜6000 の整数');
        }
      }
      goalOf(goalId);
      const rm = roadmaps.get(goalId) ?? fail(404, 'not_found', 'ロードマップがありません');
      const done = rm.checkpoints.filter((c) => c.state === 'done');
      const total = done.length + list.length;
      if (total < REVISE_TOTAL_MIN || total > REVISE_TOTAL_MAX) fail(400, 'invalid_argument', `チェックポイントは合わせて ${REVISE_TOTAL_MIN}〜${REVISE_TOTAL_MAX} 個にしてください`);
      const act = activeOf();
      if (act && act.goalId === goalId && rm.checkpoints.some((c) => c.id === act.checkpointId && c.state !== 'done')) {
        fail(409, 'conflict', '進行中の集中があるチェックポイントは消せません');
      }
      const fresh = toCheckpoints(list.map((c) => ({ title: c.title.trim(), doneMark: c.doneMark.trim(), ...(c.estimateMin !== undefined ? { estimateMin: c.estimateMin } : {}) })));
      rm.checkpoints = [...done, ...fresh].map((c, i) => ({ ...c, order: i + 1 }));
      return copy(rm);
    },

    async decideRoadmap(goalId, b) {
      goalOf(goalId);
      if (!checkLen(b.why, 1, 300)) fail(400, 'invalid_argument', '選んだ理由が要ります');
      if (roadmaps.has(goalId)) fail(409, 'conflict', 'ロードマップはもう確定しています');
      const cands = candidates.get(goalId) ?? [];
      let steps: CheckpointInput[];
      let ratio: number | undefined;
      const source: RoadmapSource = b.source;
      if (source === 'candidate' || source === 'edited') {
        const c = cands.find((x) => x.id === b.candidateId) ?? fail(404, 'not_found', '選んだ案が見つかりません');
        if (source === 'candidate') steps = c.checkpoints;
        else {
          steps = b.checkpoints;
          ratio = editRatio(c.checkpoints, b.checkpoints);
        }
      } else if (source === 'own') {
        steps = b.checkpoints;
      } else {
        return fail(400, 'invalid_argument');
      }
      // そのまま採る時はサーバーも送られた checkpoints を見ない。範囲は lib/roadmapLimits.ts（サーバーと同じ・仮）
      if (source !== 'candidate') {
        const problem = stepsProblem(steps);
        if (problem) fail(400, 'invalid_argument', problem);
      }
      const rm: Roadmap = {
        id: newId('rm'),
        goalId,
        userId: me.id,
        adopted: source,
        ...(ratio !== undefined ? { editRatio: ratio } : {}),
        why: b.why.trim(),
        checkpoints: toCheckpoints(steps),
        createdAt: iso(),
      };
      roadmaps.set(goalId, rm);
      return copy(rm);
    },

    async startSession(b) {
      // 順はサーバーと同じ: 入力（400）→ 目標・ロードマップ・チェックポイント（404）→ 完了済み・進行中（409）
      if (!checkLen(b.oneLine, 1, 200)) fail(400, 'invalid_argument', '今日やることが要ります');
      if (b.materials !== undefined && (typeof b.materials !== 'string' || b.materials.length > 2000)) {
        fail(400, 'invalid_argument', '資料は 2000 文字まで');
      }
      goalOf(b.goalId);
      const rm = roadmaps.get(b.goalId) ?? fail(404, 'not_found');
      const cp = rm.checkpoints.find((c) => c.id === b.checkpointId) ?? fail(404, 'not_found');
      if (cp.state === 'done') fail(409, 'conflict', 'このチェックポイントはもう完了しています');
      if (activeOf()) fail(409, 'conflict', '進行中の集中があります');
      const s: Session = {
        id: newId('ses'),
        userId: me.id,
        goalId: b.goalId,
        checkpointId: b.checkpointId,
        startedAt: iso(),
        oneLine: b.oneLine.trim(),
        ...(b.materials !== undefined ? { materials: b.materials.trim() } : {}),
        leaveCount: 0,
      };
      sessions.push(s);
      if (cp.state === 'todo') cp.state = 'doing';
      addEvent(s.id, 'focus_start');
      return copy(s);
    },

    async readMaterials(images, files = []) {
      if (!Array.isArray(images) || !Array.isArray(files) || images.length + files.length < 1) {
        fail(400, 'invalid_argument', '写真かファイルが 1 つ以上必要です');
      }
      checkImages({ images }, 3);
      if (files.length > MAX_MATERIAL_FILES) fail(400, 'invalid_argument', `ファイルは ${MAX_MATERIAL_FILES} 件まで`);
      for (const f of files) {
        const limit = MATERIAL_FILE_LIMITS[f.mimeType];
        if (limit === undefined) fail(400, 'invalid_argument', 'ファイルの形式が違います');
        if (base64Bytes(f.dataBase64) > limit) fail(400, 'invalid_argument', 'ファイルが大きすぎます');
      }
      await wait(aiDelay);
      // 保存しない。決め打ちの偽の文字を返す
      if (files.length > 0) return { text: '【偽の読み取り】範囲: 第1〜5章／提出物: レポート 1 本（期限 11/20）' };
      return { text: '【偽の読み取り】数学 p.12〜15 の練習問題 1〜8（二次方程式）' };
    },

    async transcribe(audio) {
      if (!audio || typeof audio.dataBase64 !== 'string' || audio.dataBase64 === '') fail(400, 'invalid_argument');
      if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'].includes(audio.mimeType)) fail(400, 'invalid_argument');
      if (base64Bytes(audio.dataBase64) > MAX_AUDIO_BYTES) fail(413, 'too_large');
      await wait(aiDelay);
      // 保存しない。決め打ちの 1 文
      return { text: '二次方程式の解の公式をもう一度確かめたい' };
    },

    async activeSession() {
      return copy({ session: activeOf() });
    },

    async sendEvent(sessionId, type) {
      if (type !== 'leave' && type !== 'return') fail(400, 'invalid_argument');
      const s = sessionOf(sessionId);
      if (s.endedAt) fail(409, 'conflict', '終わった集中です');
      if (type === 'leave') {
        if (away.has(sessionId)) fail(409, 'conflict', 'もう離れています');
        away.add(sessionId);
        s.leaveCount += 1;
      } else {
        if (!away.has(sessionId)) fail(409, 'conflict', '離れていません');
        away.delete(sessionId);
      }
      return copy(addEvent(sessionId, type));
    },

    async endSession(sessionId) {
      const s = sessionOf(sessionId);
      if (s.endedAt) fail(409, 'conflict', '終わった集中です');
      addEvent(sessionId, 'focus_end');
      away.delete(sessionId);
      s.endedAt = iso();
      const start = Date.parse(s.startedAt);
      const end = Date.parse(s.endedAt);
      const list = (events.get(sessionId) ?? []).map((e) => ({ type: e.type, at: Date.parse(e.at) }));
      const real = focusMinutes(list, start, end);
      s.focusMin = Math.round(real * speed * 10) / 10;
      const floor = computeFloor(s);
      return copy({ session: s, floor });
    },

    async tutorHistory(sessionId) {
      sessionOf(sessionId);
      return copy({ messages: tutor.get(sessionId) ?? [], helpTotal: helpTotal(sessionId) });
    },

    async stuckOptions(sessionId, intent): Promise<StuckOptionsResult> {
      const s = sessionOf(sessionId);
      if (intent !== 'stuck' && intent !== 'check') fail(400, 'invalid_argument', 'intent');
      if (s.endedAt) fail(409, 'conflict', '終わった集中です');
      await wait(aiDelay);
      const labels =
        intent === 'stuck'
          ? ['問題の意味が取れない', 'どこから始めるか分からない', '途中で考えが合わない', '用語や公式が思い出せない']
          : ['考え方が合っているか', '途中の手順', '答えの形（単位・桁など）', '抜けがないか'];
      return copy({ options: labels.map((label, i) => ({ id: `opt-${i + 1}`, label })), source: 'fixed' as const });
    },

    async tutor(sessionId, b) {
      // 順はサーバーと同じ: 無い集中（404）→ 入力（400）→ 終わった集中（409）
      const s = sessionOf(sessionId);
      const kind = b.kind ?? 'ask'; // 省略は ask と同じ（サーバーが省略に対応する形）
      if (kind !== 'ask' && kind !== 'research') fail(400, 'invalid_argument');
      if (b.intent !== undefined && b.intent !== 'stuck' && b.intent !== 'check') fail(400, 'invalid_argument', 'intent');
      if (!checkLen(b.text, 1, 2000)) fail(400, 'invalid_argument', '1〜2000 文字');
      if (b.thought !== undefined && (typeof b.thought !== 'string' || b.thought.trim().length > 300)) {
        fail(400, 'invalid_argument', 'thought: 0〜300 文字');
      }
      const thought = (b.thought ?? '').trim();
      if (kind === 'research' && thought) fail(400, 'invalid_argument', 'thought: 調べたいことには付けられません');
      const images = b.images ?? [];
      checkImages({ ...b, images }, 2);
      if (kind === 'research' && images.length > 0) fail(400, 'invalid_argument', '調べるには写真を付けられません');
      if (s.endedAt) fail(409, 'conflict', '終わった集中です');
      await wait(aiDelay);
      const text = b.text.trim();
      const user: TutorMessage = { id: newId('msg'), sessionId, role: 'user', kind, text, helpLevel: 'none', at: iso() };
      const r = aiReply(kind, text);
      const ai: TutorMessage = {
        id: newId('msg'),
        sessionId,
        role: 'ai',
        kind,
        text: r.text,
        helpLevel: r.helpLevel,
        at: iso(),
        ...(r.sources ? { sources: r.sources } : {}),
      };
      const list = tutor.get(sessionId) ?? [];
      list.push(user, ai);
      tutor.set(sessionId, list);
      if (kind === 'ask') {
        const c = askCounts.get(sessionId) ?? { asks: 0, thoughtAsks: 0 };
        askCounts.set(sessionId, { asks: c.asks + 1, thoughtAsks: c.thoughtAsks + (thought ? 1 : 0) });
      }
      if (r.helpLevel !== 'none') addEvent(sessionId, `help_${r.helpLevel}`);
      if (kind === 'research') addEvent(sessionId, 'research');
      return copy({ messages: [user, ai], helpTotal: helpTotal(sessionId) });
    },

    async reflect(sessionId, b: ReflectRequest) {
      // 順はサーバーと同じ: 本文の大きさ（413）→ 無い集中（404）→ 入力（400）→ 終わっていない（409）
      if (Array.isArray(b.images) && reflectBodyBytes(b) > MAX_REFLECT_BODY_BYTES) fail(413, 'too_large', '写真が大きすぎます');
      const s = sessionOf(sessionId);
      if (typeof b.note !== 'string' || b.note.length > 1000) fail(400, 'invalid_argument', 'メモは 1000 文字まで');
      if (typeof b.done !== 'boolean') fail(400, 'invalid_argument', 'done が要ります');
      if (b.materials !== undefined && (typeof b.materials !== 'string' || b.materials.length > 2000)) {
        fail(400, 'invalid_argument', '資料は 2000 文字まで');
      }
      if (b.stuck && !(b.stuck.cause in NEXT_STEPS)) fail(400, 'invalid_argument', '行き詰まりの原因が違います');
      checkImages(b, 3);
      if (b.audio) {
        if (!['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav'].includes(b.audio.mimeType)) fail(400, 'invalid_argument');
        if ((b.audio.dataBase64.length * 3) / 4 > 1.5 * 1024 * 1024) fail(413, 'too_large', '音声が大きすぎます');
      }
      if (!s.endedAt) fail(409, 'conflict', '集中を終えてから');
      // 2 回目（応答を受け取り損ねた時など）は保存した結果を返す（サーバーと同じ・AI は呼ばない）
      const saved = achievements.get(sessionId);
      if (saved) {
        syncCheckpoint(s);
        const floor = computeFloor(s);
        return copy({
          judgeable: saved.judgeable,
          aiAchievement: saved.ai,
          achievement: saved.mine,
          reason: saved.reason,
          nextSteps: saved.nextSteps,
          floor,
        });
      }
      await wait(aiDelay * 1.5);

      let ai: Achievement | null;
      let reason: string;
      // 本人の申告（done）は判定に使わない。どこまでできたかは材料から決める（owner-choices §6）
      if (b.images.length > 0) {
        ai = 3;
        reason = '写真から、完了の目印まで届いていると判定しました（偽の判定）';
      } else if (b.note.trim().length >= 20 || b.audio) {
        ai = 1;
        reason = 'メモから判定しました。写真が無いので低めに見ています（偽の判定）';
      } else {
        ai = null;
        reason = '写真とメモから判定しきれませんでした';
      }
      const nextSteps = b.stuck ? (NEXT_STEPS[b.stuck.cause] ?? NEXT_STEPS.other) : [];
      achievements.set(sessionId, { judgeable: ai !== null, ai, mine: ai, reason, nextSteps, seq: ++reflectSeq });
      s.stuckCause = b.stuck?.cause;
      s.reflectedAt = iso();
      syncCheckpoint(s);
      const floor = computeFloor(s);
      return copy({ judgeable: ai !== null, aiAchievement: ai, achievement: ai, reason, nextSteps, floor });
    },

    async confirmReflect(sessionId, achievement) {
      const s = sessionOf(sessionId);
      if (![0, 1, 2, 3].includes(achievement)) fail(400, 'invalid_argument');
      const prev = achievements.get(sessionId) ?? fail(409, 'conflict', '先に振り返りを送る');
      // 決め直せるのは、そのチェックポイントで最後に振り返った集中だけ（サーバーと同じ）
      if (latestReflected(s)?.id !== s.id) fail(409, 'conflict', 'このチェックポイントの、より新しい集中で決め直してください');
      prev.mine = achievement;
      syncCheckpoint(s);
      const floor = computeFloor(s);
      return copy({ achievement, aiAchievement: prev.ai, floor });
    },

    async tower() {
      // 階の pt（集中＋振り返り・契約 §3.6b）。サーバーの GET /api/tower と同じ足し方
      const withPt = floors.map((f) => ({
        ...f,
        pt: Math.min(12, Math.floor(Math.max(0, f.focusMin) / 5)) + donePt(f),
      }));
      return copy({ floors: withPt, totalFloors: totalFloors(), streak: streak() });
    },

    async today(given, note) {
      // サーバーの GEMINI_MODE=fake と同じ: ルールの提案（期限の近い順・合計が minutes に収まる物・1 件目は必ず）に
      // source "ai" と決まったあいさつを付ける。候補が 0 件なら空と決まった文。何も保存しない
      // minutes の省略は、合計の目安 60 分（#265・サーバーの TARGET_MINUTES と同じ）
      const minutes = given ?? 60;
      if (![15, 30, 60, 120].includes(minutes)) fail(400, 'invalid_argument', '時間は 15・30・60・120 分');
      const cands = goals
        .filter((g) => g.status === 'active' && !g.archivedAt) // やめた目標は外す（#231）
        .map((g) => {
          const cp = [...(roadmaps.get(g.id)?.checkpoints ?? [])].sort((a, b) => a.order - b.order).find((c) => c.state !== 'done');
          return cp ? { g, cp } : null;
        })
        .filter((x): x is { g: Goal; cp: Checkpoint } => !!x)
        .sort((a, b) => a.g.deadline.localeCompare(b.g.deadline));
      if (cands.length === 0) {
        return { greeting: '目標を足すと、今日の提案が出ます', minutes, proposals: [], totalMinutes: 0, source: 'rules' as const };
      }
      // 希望（note・#222）があれば、サーバー（today/pick.js の preferByNote）と同じく部分一致する候補を先頭に寄せる
      const n = note?.trim() ?? '';
      if (typeof note === 'string' && Array.from(n).length > 200) fail(400, 'invalid_argument', '希望は 200 字まで');
      const words = n.split(/[\s　、。，．,.!！?？・「」『』（）()]+/).filter((w) => Array.from(w).length >= 2);
      const hits = (c: (typeof cands)[number]) =>
        n !== '' && [c.cp.title, c.g.text].some((s) => Array.from(s).length >= 2 && (n.includes(s) || words.some((w) => s.includes(w))));
      const ordered = [...cands.filter(hits), ...cands.filter((c) => !hits(c))];
      const picked: typeof cands = [];
      let total = 0;
      for (const c of ordered) {
        if (picked.length >= 3) break;
        if (picked.length > 0 && total + c.cp.estimateMin > minutes) continue;
        picked.push(c);
        total += c.cp.estimateMin;
      }
      // 理由はサーバー（today/pick.js の ruleReason）と同じ決まった文。日数は日本時間の暦日で数える
      const jstDay = (t: number) => Math.floor((t + JST_MS) / 86_400_000);
      const reasonOf = (deadline: string) => {
        const d = jstDay(Date.parse(deadline)) - jstDay(now());
        return d < 0 ? '期限を過ぎています' : d === 0 ? '期限は今日です' : `期限まであと ${d} 日`;
      };
      const proposals = picked.map(({ g, cp }) => ({
        goalId: g.id,
        checkpointId: cp.id,
        title: cp.title,
        minutes: cp.estimateMin,
        reason: reasonOf(g.deadline),
      }));
      return copy({
        greeting: given === undefined ? '今日の分を選びました。一緒にここから始めましょう（偽のあいさつ）' : `今日は ${minutes} 分です。一緒にここから始めましょう（偽のあいさつ）`,
        minutes,
        proposals,
        totalMinutes: total,
        source: 'ai' as const,
      });
    },

    async agentChat(body) {
      // サーバーの GEMINI_MODE=fake と同じ（契約 §3.12）: ルールの返事に source "ai"。中身の質問は集中へ誘導。何も保存しない
      const msg = typeof body?.message === 'string' ? body.message.trim() : '';
      const len = Array.from(msg).length;
      if (len < 1 || len > 300) fail(400, 'invalid_argument', '1〜300 字で書いてください');
      if (body.goalId !== undefined && !goals.some((g) => g.id === body.goalId)) fail(404, 'not_found', '目標が見つかりません');
      const live = goals.filter((g) => g.status === 'active' && !g.archivedAt).sort((a, b) => a.deadline.localeCompare(b.deadline));
      const focus = body.goalId ? live.filter((g) => g.id === body.goalId) : live;
      const next = (g: Goal) => [...(roadmaps.get(g.id)?.checkpoints ?? [])].sort((a, b) => a.order - b.order).find((c) => c.state !== 'done');
      const active = activeOf();
      const pending = sessions.filter((x) => x.endedAt && !x.reflectedAt).sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))[0];
      const withRoad = focus.find((g) => next(g));
      const noRoad = focus.find((g) => !roadmaps.get(g.id));
      const first: AgentAction | null = active
        ? { kind: 'resume', sessionId: active.id }
        : pending
          ? { kind: 'reflect', sessionId: pending.id }
          : withRoad
            ? { kind: 'start', goalId: withRoad.id, checkpointId: next(withRoad)!.id }
            : noRoad
              ? { kind: 'plan', goalId: noRoad.id }
              : null;
      if (/答え|解き方|教えて/.test(msg)) {
        return copy({
          reply: '中身は、集中を始めてから一緒に考えましょう。まずは自分の考えを持って始めてみませんか。',
          actions: first && (first.kind === 'start' || first.kind === 'resume') ? [first] : [],
          topic: 'content' as const,
          source: 'ai' as const,
        });
      }
      // 目標や課題を足したい時は、取り込む・書くのボタン（ホームに「＋ 目標」を置かない・#315）
      if (/(目標|課題|タスク).*(足|追加|増や|作|書|取り込)|新しい(目標|課題)/.test(msg)) {
        return copy({
          reply: '足しましょう。課題の一覧があるなら取り込み、無ければ書くところからどうぞ。',
          actions: [{ kind: 'import' }, { kind: 'write' }] as AgentAction[],
          topic: 'app' as const,
          source: 'ai' as const,
        });
      }
      const reply = !first
        ? '目標がまだないですね。課題を取り込むか、書くところから始めましょう。'
        : first.kind === 'resume'
          ? '集中の途中です。続きに戻りましょう。'
          : first.kind === 'reflect'
            ? 'さっきの集中、どこまでできたか振り返りましょう。'
            : first.kind === 'plan'
              ? '進め方がまだ決まっていない目標があります。案を比べて決めましょう。'
              : '次の一歩はこれです。いけそうなら始めましょう（偽の返事）。';
      const actions: AgentAction[] = first ? [first] : [{ kind: 'import' }, { kind: 'write' }];
      return copy({ reply, actions, topic: 'plan' as const, source: 'ai' as const });
    },

    async weekly() {
      // サーバーの GEMINI_MODE=fake と同じ: 数字は記録から計算し、文は固定（source "ai"）。集中が 0 件なら summary null
      const to = now();
      const from = Date.parse(`${dayKey(to)}T00:00:00Z`) - JST_MS - 6 * 86400000;
      const inWeek = (at: string) => Date.parse(at) >= from && Date.parse(at) <= to;
      const ended = sessions.filter((s) => s.endedAt && inWeek(s.endedAt));
      const fs = floors.filter((f) => ended.some((s) => s.id === f.sessionId));
      const evs = [...events.values()].flat().filter((e) => inWeek(e.at));
      const stats = {
        focusMinutes: Math.round(fs.reduce((a, f) => a + f.focusMin, 0)),
        sessions: ended.length,
        floorsAdded: fs.reduce((a, f) => a + f.floors, 0),
        streak: streak(),
        helpSmall: evs.filter((e) => e.type === 'help_small').length,
        helpMedium: evs.filter((e) => e.type === 'help_medium').length,
        selfDecided: fs.length ? Math.round(fs.reduce((a, f) => a + f.ownScore, 0) / fs.length) : null,
      };
      const summary =
        ended.length === 0 ? null : '今週の記録から、やり方の変化をまとめました（偽の文）。\n次の一歩: 始める前に、確かめたいことを一行で書いてみてください。';
      return copy({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        stats,
        summary,
        source: summary === null ? ('rules' as const) : ('ai' as const),
      });
    },

    async addFriend(code) {
      // 順と回数の上限はサーバーと同じ（1 日 20 回・見つからないコード 5 回で、その日は 429）
      const c = String(code ?? '').trim().toUpperCase();
      if (c.length < 1 || c.length > 20) fail(400, 'invalid_argument', '友達コードが違います');
      const tries = triesToday();
      if (tries.misses >= FRIEND_MISSES_PER_DAY || tries.sent >= FRIEND_REQUESTS_PER_DAY) {
        fail(429, 'rate_limited', '申請の回数の上限です。明日もう一度');
      }
      tries.sent += 1;
      if (c === me.friendCode) fail(400, 'invalid_argument', '自分のコードです');
      const p = people.find((x) => x.friendCode === c);
      if (!p) {
        tries.misses += 1;
        return fail(404, 'not_found', '友達コードが見つかりません');
      }
      const dup = friendships.find(
        (f) => (f.userId === me.id && f.friendId === p.id) || (f.userId === p.id && f.friendId === me.id),
      );
      if (dup) fail(409, 'conflict', 'もう申請しています');
      const f: Friendship = {
        id: newId('f'),
        userId: me.id,
        friendId: p.id,
        status: 'pending',
        notifyOnStart: true,
        createdAt: iso(),
      };
      friendships.push(f);
      return copy(f);
    },

    async acceptFriend(id) {
      // 受けた側だけ。申請した側・他人・無い ID はどれも 404（サーバーと同じ。403 は使わない）
      const f = friendships.find((x) => x.id === id && x.friendId === me.id) ?? fail(404, 'not_found');
      if (f.status !== 'pending') fail(409, 'conflict', 'すでに承認済みです');
      f.status = 'accepted';
      return copy(f);
    },

    async friends() {
      const list = friendships
        .filter((f) => f.userId === me.id || f.friendId === me.id)
        .map((f) => {
          const otherId = f.userId === me.id ? f.friendId : f.userId;
          const p = people.find((x) => x.id === otherId);
          const ok = f.status === 'accepted';
          const stats = ok ? friendStats[otherId] : undefined;
          return {
            friendship: f,
            user: { id: otherId, displayName: p?.displayName ?? '' }, // 名前が無い時はサーバーと同じ空
            activeNow: ok && activeFriends.has(otherId),
            floors: stats?.floors ?? 0,
            streak: stats?.streak ?? 0,
            today: ok ? (friendToday[otherId] ?? []) : [],
          };
        });
      return copy({ friends: list });
    },

    async feed() {
      return copy({ items: feedNow() });
    },

    // mock は通知の鍵を持たない（鍵の無いサーバーと同じ 404 ＝ 設定に通知のスイッチを出さない）
    async pushKey() {
      return fail(404, 'not_found');
    },
    async pushSubscribe() {
      fail(404, 'not_found');
    },
    async pushUnsubscribe() {
      fail(404, 'not_found');
    },
    // Android の FCM トークン（#299）。mock は何もしないで成功
    async registerDevice() {},
    async unregisterDevice() {},
  };
}
