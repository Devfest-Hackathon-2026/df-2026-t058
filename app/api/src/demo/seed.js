import { createHash, randomUUID } from 'node:crypto';
import { C } from '../common/collections.js';
import { buildFloor } from '../score/floor.js';

// デモ用の見本（DEMO_SEED=on の時だけ使う）。目標 1・ロードマップ（4 つ中 3 つ完了）・終えた集中 3 件。
// store の put だけで作る。events は追記のみで、append は時刻をサーバーが付けてしまい過去にできないため、
// 見本では events を作らない。作業時間は focusMinutes が session の startedAt／endedAt から出す（階の計算と同じ道）。
export const SEED_GOAL_TEXT = '来週の小テストまでに二次方程式を解けるようにする';
const DAY_MS = 24 * 60 * 60 * 1000;

const CHECKPOINTS = [
  { title: '因数分解で解く', doneMark: '因数分解で解ける問題を 5 問連続で解ける', estimateMin: 30, state: 'done', achievement: 0 },
  { title: '解の公式を使う', doneMark: '解の公式で答えを出せる', estimateMin: 40, state: 'done', achievement: 1 },
  { title: '平方完成を理解する', doneMark: '平方完成の手順を自分の言葉で説明できる', estimateMin: 30, state: 'done', achievement: 3 },
  { title: '小テスト形式で通して解く', doneMark: '制限時間内に 8 割解ける', estimateMin: 45, state: 'todo', achievement: null },
];

// 各集中: 終わった日（何日前）・長さ（分）・対象のチェックポイント・達成度（本人の最終／AI）。
// 階は 15 分で 1 階: 20→1、35→2、15→1。色は own=70（自作）で 3→金、1→銀、0→銅。古い日ほど低く新しい日ほど高く（銅→銀→金）。
const SESSIONS = [
  { daysAgo: 3, minutes: 20, cp: 0, oneLine: '因数分解のパターンを覚える', achievement: 0, aiAchievement: 0 },
  { daysAgo: 2, minutes: 35, cp: 1, oneLine: '解の公式の使い方を確かめる', achievement: 1, aiAchievement: 2 },
  { daysAgo: 1, minutes: 15, cp: 2, oneLine: '平方完成を少し試す', achievement: 3, aiAchievement: 3 },
];

// 見本の友達 2 人。ID の接頭辞 `demo-friend-` は、ログインの userId（`u_` + 名前から決まる文字）と混ざらない。
// ID は固定なので、見本を何度入れても（別の本人でも）友達は 2 人のまま（同じ ID を上書きするだけ）。
// 終わった集中は 24 時間より前（フィードに出るのは「いま始めた」1 件だけにするため）。
// active は、いま集中中（endedAt なし・開始が何分前）。
export const DEMO_FRIEND_PREFIX = 'demo-friend-';
const DEMO_FRIENDS = [
  {
    key: 'midori',
    displayName: 'みどり',
    sessions: [
      { daysAgo: 5, minutes: 45, cp: 0, oneLine: '因数分解を集中して解く', achievement: 3, aiAchievement: 3 },
      { daysAgo: 3, minutes: 20, cp: 1, oneLine: '解の公式を一度ためす', achievement: 1, aiAchievement: 1 },
    ],
  },
  {
    key: 'kouta',
    displayName: 'こうた',
    sessions: [
      { daysAgo: 4, minutes: 35, cp: 0, oneLine: '基本の問題をおさらいする', achievement: 0, aiAchievement: 0 },
      { daysAgo: 2, minutes: 20, cp: 1, oneLine: '公式の形を覚える', achievement: 3, aiAchievement: 3 },
    ],
    active: { minutesAgo: 6, cp: 2, oneLine: '平方完成の手順をたどる' },
  },
];

// friends/routes.js の pairId と同じ（向きに依らない組の ID。POST /api/friends の重複判定と揃える）。
function pairId(a, b) {
  const [x, y] = [a, b].sort();
  return createHash('sha256').update(`${x}\0${y}`).digest('hex').slice(0, 32);
}

async function seedFriends(ctx, userId, now) {
  const { store } = ctx;
  const iso = (ms) => new Date(ms).toISOString();
  for (const f of DEMO_FRIENDS) {
    const friendId = `${DEMO_FRIEND_PREFIX}${f.key}`;
    const createdAt = iso(now.getTime() - 6 * DAY_MS);
    const existing = await store.get(C.users, friendId);
    await store.put(C.users, friendId, {
      displayName: f.displayName,
      nudgeLevel: 'friend_start',
      friendCode: existing?.friendCode ?? `D${f.key.toUpperCase().slice(0, 5).padEnd(5, 'X')}`,
      createdAt: existing?.createdAt ?? createdAt,
    });
    const goalId = `demo-goal-${f.key}`;
    await store.put(C.goals, goalId, {
      userId: friendId,
      text: SEED_GOAL_TEXT,
      deadline: iso(now.getTime() + 7 * DAY_MS).slice(0, 10),
      minutesPerDay: 30,
      status: 'active',
      createdAt,
    });
    const roadmap = await store.put(C.roadmaps, goalId, {
      goalId,
      userId: friendId,
      adopted: 'own',
      why: '小テストに間に合わせたい',
      checkpoints: CHECKPOINTS.map((c, i) => ({ id: `demo-cp-${f.key}-${i}`, order: i + 1, ...c })),
      createdAt,
    });
    for (const [i, s] of f.sessions.entries()) {
      const endedAt = iso(now.getTime() - s.daysAgo * DAY_MS);
      const session = await store.put(C.sessions, `demo-session-${f.key}-${i}`, {
        userId: friendId,
        goalId,
        checkpointId: roadmap.checkpoints[s.cp].id,
        oneLine: s.oneLine,
        startedAt: iso(Date.parse(endedAt) - s.minutes * 60000),
        endedAt,
        focusMin: s.minutes,
        leaveCount: 0,
        reflectedAt: endedAt,
        achievement: s.achievement,
        aiAchievement: s.aiAchievement,
      });
      await store.put(C.floors, session.id, buildFloor({ session, roadmap, events: [] }));
    }
    if (f.active) {
      await store.put(C.sessions, `demo-session-${f.key}-active`, {
        userId: friendId,
        goalId,
        checkpointId: roadmap.checkpoints[f.active.cp].id,
        oneLine: f.active.oneLine,
        startedAt: iso(now.getTime() - f.active.minutesAgo * 60000),
        endedAt: null,
        leaveCount: 0,
      });
    }
    await store.put(C.friendships, pairId(userId, friendId), {
      userId,
      friendId,
      status: 'accepted',
      notifyOnStart: true,
      createdAt: iso(now.getTime() - 5 * DAY_MS),
    });
  }
}

// 足す目標 3 つ（複数の課題が一覧に見えるように）。集中の記録は作らない（建物・連続記録・階は主の目標だけ）。
// 今日の分＝最初の未完了の道の estimateMin（today）。minutesPerDay は null（おまかせ）。
// 道の完了は主の見本と同じ作り方（state: 'done' ＋ achievement）。
const EXTRA_GOALS = [
  {
    text: '英語の長文読解を、制限時間内に解けるようにする',
    days: 2,
    done: 1,
    why: '期限が近いので、読み方の型を先に固める',
    titles: ['段落ごとに要点をつかむ', '指示語が指す内容を押さえる', '設問から先に読む', '時間を決めて 1 題解く', '間違いの理由を振り返る'],
    today: 25,
  },
  {
    text: '統計学のレポートを書き上げる',
    days: 9,
    done: 0,
    why: '構成を決めてから、少しずつ書き進める',
    titles: ['テーマと問いを決める', 'データの集計をする', '図と表をつくる', '本文を書いて見直す'],
    today: 40,
  },
  {
    text: '資格試験の過去問を、安定して解けるようにする',
    days: 21,
    done: 2,
    why: '出題の傾向をつかみ、苦手を順に減らす',
    titles: ['出題の傾向を調べる', '1 年分を通して解く', '間違えた問題を整理する', '苦手な分野を復習する', '時間を計って解く', '最後の見直しをする'],
    today: 30,
  },
];

async function seedExtraGoals(ctx, userId, now) {
  const { store } = ctx;
  const iso = (ms) => new Date(ms).toISOString();
  for (const g of EXTRA_GOALS) {
    const goalId = randomUUID();
    const createdAt = iso(now.getTime() - 2 * DAY_MS);
    await store.put(C.goals, goalId, {
      userId,
      text: g.text,
      deadline: iso(now.getTime() + g.days * DAY_MS).slice(0, 10),
      minutesPerDay: null,
      status: 'active',
      createdAt,
    });
    await store.put(C.roadmaps, goalId, {
      goalId,
      userId,
      adopted: 'own',
      why: g.why,
      checkpoints: g.titles.map((title, i) => {
        const isDone = i < g.done;
        return {
          id: randomUUID(),
          order: i + 1,
          title,
          doneMark: `${title}ができた`,
          estimateMin: i === g.done ? g.today : 30,
          state: isDone ? 'done' : 'todo',
          achievement: isDone ? 1 : null,
        };
      }),
      createdAt,
    });
  }
}

export async function seedDemo(ctx, userId) {
  const { store } = ctx;
  const now = ctx.now ? ctx.now() : new Date();
  const iso = (ms) => new Date(ms).toISOString();
  const goalId = randomUUID();
  const createdAt = iso(now.getTime() - 4 * DAY_MS);

  const goal = await store.put(C.goals, goalId, {
    userId,
    text: SEED_GOAL_TEXT,
    deadline: iso(now.getTime() + 7 * DAY_MS).slice(0, 10),
    minutesPerDay: 30,
    status: 'active',
    createdAt,
  });
  const roadmap = await store.put(C.roadmaps, goalId, {
    goalId,
    userId,
    adopted: 'own',
    why: '小テストに間に合わせたいので、解き方を順に固める',
    checkpoints: CHECKPOINTS.map((c, i) => ({ id: randomUUID(), order: i + 1, ...c })),
    createdAt,
  });

  const floors = [];
  for (const s of SESSIONS) {
    const endedAt = iso(now.getTime() - s.daysAgo * DAY_MS);
    const session = await store.put(C.sessions, randomUUID(), {
      userId,
      goalId,
      checkpointId: roadmap.checkpoints[s.cp].id,
      oneLine: s.oneLine,
      startedAt: iso(Date.parse(endedAt) - s.minutes * 60000),
      endedAt,
      focusMin: s.minutes,
      leaveCount: 0,
      reflectedAt: endedAt,
      achievement: s.achievement,
      aiAchievement: s.aiAchievement,
    });
    floors.push(await store.put(C.floors, session.id, buildFloor({ session, roadmap, events: [] })));
  }
  await seedExtraGoals(ctx, userId, now);
  await seedFriends(ctx, userId, now);
  return { goal, roadmap, floors };
}
