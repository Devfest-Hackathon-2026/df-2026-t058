import { createHash } from 'node:crypto';
import { C } from '../common/collections.js';
import { loadOwned } from '../common/owned.js';
import { nowIso } from '../common/time.js';
import { body, str } from '../common/validate.js';
import { HttpError } from '../http.js';
import { createLimiter } from '../limiter.js';
import { computeStreak, jstDayKey } from '../score/streak.js';

// I-7: 友達と焦りの知らせ（契約 §3.7・設計思想 P7・P10）。
//
// 方針
// - 知らせは「引く」形（GET /api/feed）。サーバーは C.sessions を読むだけで、セッションには何も書かない。
// - 友達に見せるのは 表示名・集中中か・始める前の一行 だけ。友達コード・通知の強さ・目標・メモは返さない（P10）。
// - 通知の強さ（nudgeLevel）は本人が選ぶ。'off' の人には知らせを一切出さない（P7）。
//
// 後で足す物
// - 端末への通知（FCM）は未実装。差し込み位置は I-4 が集中を始めた直後（POST /api/sessions の中）。
//   そこで「承認済みの友達（acceptedFriendIds）のうち nudgeLevel が 'off' でない人」へ送る。
//   このファイルの feed の絞り方と同じ規則にすること。

const FEED_WINDOW_MS = 24 * 60 * 60 * 1000; // 過去 24 時間
const FEED_MAX = 50;

// 友達申請の回数の制限（仮）。コードの総当たり（無い→404・ある→201 の差で当てる）と、全件走査の負荷を抑える。
// - 1 人 1 日 20 回まで申請できる（当たり外れに関わらず数える）。
// - 見つからないコードが 1 人 1 日 5 回になったら、その日は申請できない（429）。
// どちらも 1 プロセスの中だけで数える（limiter.js と同じ・複数台では台ごと）。日の区切りは UTC。
export const FRIEND_REQUEST_LIMIT = Object.freeze({ perUserPerDay: 20, missesPerUserPerDay: 5 });

// 2 人の組ごとに 1 つの ID（向きに依らない）。どちら向きの重複も 1 回の get で見つかる。
function pairId(a, b) {
  const [x, y] = [a, b].sort();
  return createHash('sha256').update(`${x}\0${y}`).digest('hex').slice(0, 32);
}

// 同じプロセス内で順番に実行する（申請の同時送信で重複や上書きを起こさないため）。
// 保管の窓口に「無い時だけ作る」が無いための措置。Firestore 版に替える時は create() かトランザクションにする。
function createLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

// 自分が関わる全ての Friendship（向きは問わない・pending を含む）。
async function myFriendships(ctx, userId) {
  const [sent, received] = await Promise.all([
    ctx.store.list(C.friendships, { userId }),
    ctx.store.list(C.friendships, { friendId: userId }),
  ]);
  return [...sent, ...received];
}

// 今日（日本時間）積んだ階（契約 §3.7 TodayFloor）。1 回の集中で N 階なら N 個・古い順・最大 TODAY_MAX（多い時は新しい分）。
// lastAt は並び替え用（返す形には入れない）。何を積んだか（目標・一行）は入れない。
export const TODAY_MAX = 5;
export function todayFloors(floorDocs, now) {
  const day = jstDayKey(now);
  const mine = floorDocs
    .filter((x) => x.at && jstDayKey(x.at) === day && (x.floors ?? 0) > 0)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const floors = [];
  for (const x of mine) for (let i = 0; i < x.floors; i++) floors.push({ id: `${x.sessionId}:${i}`, color: x.color });
  return { floors: floors.slice(-TODAY_MAX), lastAt: mine.length ? mine[mine.length - 1].at : null };
}

// ホームの一番上の友達の列（契約 §3.9 friends）。承認済みだけ・取り組み中 → 今日の最後の階が新しい順 → 承認の新しい順・最大 20 人
export const HOME_FRIENDS_MAX = 20;
export async function homeFriends(ctx, userId) {
  const now = ctx.now ? ctx.now() : new Date();
  const accepted = (await myFriendships(ctx, userId)).filter((f) => f.status === 'accepted');
  const rows = await Promise.all(
    accepted.map(async (f) => {
      const id = otherSide(f, userId);
      const [sessions, floorDocs] = await Promise.all([ctx.store.list(C.sessions, { userId: id }), ctx.store.list(C.floors, { userId: id })]);
      const t = todayFloors(floorDocs, now);
      return {
        row: { userId: id, displayName: await displayNameOf(ctx, id), activeNow: sessions.some((s) => !s.endedAt), today: t.floors },
        lastAt: t.lastAt,
        createdAt: f.createdAt,
      };
    }),
  );
  rows.sort(
    (a, b) =>
      Number(b.row.activeNow) - Number(a.row.activeNow) ||
      (b.lastAt ? Date.parse(b.lastAt) : 0) - (a.lastAt ? Date.parse(a.lastAt) : 0) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return rows.slice(0, HOME_FRIENDS_MAX).map((x) => x.row);
}

const otherSide = (f, userId) => (f.userId === userId ? f.friendId : f.userId);

async function displayNameOf(ctx, id) {
  const u = await ctx.store.get(C.users, id);
  return u?.displayName ?? '';
}

export function register(router, ctx) {
  const locked = createLock();
  const now = () => (ctx.now ? ctx.now() : new Date());
  const requests = createLimiter({ perUserPerDay: FRIEND_REQUEST_LIMIT.perUserPerDay, totalPerDay: Infinity, now });
  const misses = createLimiter({ perUserPerDay: FRIEND_REQUEST_LIMIT.missesPerUserPerDay, totalPerDay: Infinity, now });
  const tooMany = () => new HttpError(429, 'rate_limited', '申請の回数の上限です。明日もう一度');

  router.add('POST', '/api/friends', async ({ userId, body: b }) => {
    body(b);
    const code = str(b.code, 'code', { max: 20 }).toUpperCase();
    // 外れが上限に達した人は、検索の前に止める（その日は当たりのコードでも申請できない）。
    if (misses.used(userId) >= FRIEND_REQUEST_LIMIT.missesPerUserPerDay) throw tooMany();
    try {
      requests.take(userId);
    } catch {
      throw tooMany();
    }
    // 注意（メモリ保管の制約）: 友達コードでの検索は users の全件走査になる。
    // Firestore 版では friendCode に索引（where friendCode == code）を使うこと。
    const [target] = await ctx.store.list(C.users, { friendCode: code });
    if (!target) {
      try {
        misses.take(userId);
      } catch {
        // 数え終わっている（次の申請は上で止まる）
      }
      throw new HttpError(404, 'not_found', '友達コードが見つかりません');
    }
    if (target.id === userId) throw new HttpError(400, 'invalid_argument', '自分の友達コードは使えません');

    return locked(async () => {
      const id = pairId(userId, target.id);
      if (await ctx.store.get(C.friendships, id)) {
        throw new HttpError(409, 'conflict', 'すでに申請済み、または友達です');
      }
      const friendship = await ctx.store.put(C.friendships, id, {
        userId, // 申請した人
        friendId: target.id, // 受けた人
        status: 'pending',
        notifyOnStart: true,
        createdAt: nowIso(ctx),
      });
      return { status: 201, body: friendship };
    });
  });

  router.add('POST', '/api/friends/:id/accept', async ({ params, userId }) =>
    locked(async () => {
      // 受けた側（friendId）だけ。申請した側・第三者・存在しない ID は 404。
      const f = await loadOwned(ctx.store, C.friendships, params.id, userId, 'friendId');
      if (f.status !== 'pending') throw new HttpError(409, 'conflict', 'すでに承認済みです');
      return { status: 200, body: await ctx.store.put(C.friendships, f.id, { ...f, status: 'accepted' }) };
    }),
  );

  router.add('GET', '/api/friends', async ({ userId }) => {
    const all = (await myFriendships(ctx, userId)).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : 1),
    );
    const friends = await Promise.all(
      all.map(async (f) => {
        const otherId = otherSide(f, userId);
        let activeNow = false;
        let floors = 0;
        let streak = 0;
        let today = [];
        // 承認済みの友達だけ読む（申請中の相手の値は返さない・P7）。順位は付けない。
        if (f.status === 'accepted') {
          const [theirs, theirFloors] = await Promise.all([
            ctx.store.list(C.sessions, { userId: otherId }),
            ctx.store.list(C.floors, { userId: otherId }),
          ]);
          activeNow = theirs.some((s) => !s.endedAt);
          // GET /api/tower の totalFloors・streak と同じ計算（score/）。
          floors = theirFloors.reduce((sum, x) => sum + (x.floors ?? 0), 0);
          streak = computeStreak(theirs.map((s) => s.endedAt), now());
          today = todayFloors(theirFloors, now()).floors;
        }
        // user は id と表示名だけ（友達コード・通知の強さなどは返さない・P10）。
        return {
          friendship: f,
          user: { id: otherId, displayName: await displayNameOf(ctx, otherId) },
          activeNow,
          floors,
          streak,
          today,
        };
      }),
    );
    return { status: 200, body: { friends } };
  });

  router.add('GET', '/api/feed', async ({ userId }) => {
    // 11/9 から焦りの強さは全員 strong 固定（本人）。nudgeLevel に関わらず出す。終えた・やめた知らせは作らない。
    const friendIds = (await myFriendships(ctx, userId))
      .filter((f) => f.status === 'accepted')
      .map((f) => otherSide(f, userId));

    const since = (ctx.now ? ctx.now() : new Date()).getTime() - FEED_WINDOW_MS;
    const items = [];
    for (const friendId of friendIds) {
      const displayName = await displayNameOf(ctx, friendId);
      // C.sessions を読むだけ（書かない）。終わった集中も「始めた」知らせとして 24 時間は残る。
      for (const s of await ctx.store.list(C.sessions, { userId: friendId })) {
        if (Date.parse(s.startedAt) >= since) {
          items.push({ userId: friendId, displayName, oneLine: s.oneLine, at: s.startedAt });
        }
      }
    }
    items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { status: 200, body: { items: items.slice(0, FEED_MAX) } };
  });
}
