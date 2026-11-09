import { randomInt } from 'node:crypto';
import { C } from '../common/collections.js';
import { nowIso } from '../common/time.js';
import { body, oneOf, str } from '../common/validate.js';
import { clientKey, NAME_MAX } from './invite.js';
import { computeStreak } from '../score/streak.js';

// I-2（初版）: 自分の情報。認証そのものは index.js の authenticate（いまは AUTH_MODE=fake）。
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I を除く

async function newFriendCode(store) {
  for (let i = 0; i < 20; i++) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    if ((await store.list(C.users, { friendCode: code })).length === 0) return code;
  }
  throw new Error('友達コードを作れませんでした');
}

export async function getOrCreateUser(ctx, userId) {
  const found = await ctx.store.get(C.users, userId);
  if (found) return found;
  return ctx.store.put(C.users, userId, {
    displayName: '',
    nudgeLevel: 'strong', // 11/9 から全員 strong 固定（本人・契約 §3.2）
    friendCode: await newFriendCode(ctx.store),
    createdAt: nowIso(ctx),
  });
}

// 連続記録は保存しない。読むたびに GET /api/tower と同じ計算（score/streak.js・終えた集中の日・JST）で埋める。
export async function withStreak(ctx, user) {
  const { streak: _stale, ...rest } = user; // 古い保存の streak（いつも 0）は使わない
  const sessions = await ctx.store.list(C.sessions, { userId: user.id });
  // 焦りの強さは全員 strong 固定（11/9 本人）。前に保存した値に関わらず strong を返す
  return { ...rest, nudgeLevel: 'strong', streak: computeStreak(sessions.map((x) => x.endedAt), ctx.now ? ctx.now() : new Date()) };
}

export function register(router, ctx) {
  // 招待コードでのログイン（AUTH_MODE=invite の時だけ。ほかの方式では経路ごと無い＝404）。
  // コードが違う理由・名前が使われているかは言わない。入力されたコードと名前はログに出さない。
  if (ctx.invite) {
    router.add(
      'POST',
      '/api/login',
      async ({ req, body: b }) => {
        body(b);
        const name = str(b.name, 'name', { max: NAME_MAX });
        const code = str(b.code, 'code', { max: 200 });
        const { token, userId } = ctx.invite.login({ name, code, key: clientKey(req) });
        const user = await getOrCreateUser(ctx, userId);
        const named = user.displayName ? user : await ctx.store.put(C.users, userId, { ...user, displayName: name });
        return { status: 200, body: { token, user: await withStreak(ctx, named) } };
      },
      { auth: false },
    );
  }

  // Google でログイン（invite で GOOGLE_CLIENT_ID がある時だけ・契約 §3.0b）。ID トークン・メール・sub は保存しない。
  if (ctx.google) {
    router.add(
      'POST',
      '/api/login/google',
      async ({ req, body: b }) => {
        body(b);
        const credential = str(b.credential, 'credential', { max: 4096 });
        const { token, userId, displayName } = await ctx.google.login({ credential, key: clientKey(req) });
        const user = await getOrCreateUser(ctx, userId);
        const named = user.displayName || !displayName ? user : await ctx.store.put(C.users, userId, { ...user, displayName });
        return { status: 200, body: { token, user: await withStreak(ctx, named) } };
      },
      { auth: false },
    );
  }

  router.add('GET', '/api/me', async ({ userId }) => ({
    status: 200,
    body: await withStreak(ctx, await getOrCreateUser(ctx, userId)),
  }));

  router.add('PUT', '/api/me', async ({ userId, body: b }) => {
    body(b);
    const user = await getOrCreateUser(ctx, userId);
    const displayName = str(b.displayName, 'displayName', { max: 30, optional: true });
    // nudgeLevel は型だけ確かめて保存しない（11/9 から全員 strong 固定・後方互換）
    oneOf(b.nudgeLevel, 'nudgeLevel', ['off', 'friend_start', 'strong'], { optional: true });
    const { streak: _stale, ...stored } = user;
    const next = { ...stored, ...(displayName !== undefined && { displayName }) };
    return { status: 200, body: await withStreak(ctx, await ctx.store.put(C.users, userId, next)) };
  });
}
