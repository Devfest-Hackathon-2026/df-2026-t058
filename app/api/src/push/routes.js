import { createHash, timingSafeEqual } from 'node:crypto';
import { C } from '../common/collections.js';
import { nowIso } from '../common/time.js';
import { HttpError } from '../http.js';
import { jstDayKey } from '../score/streak.js';
import { latestStarterToday, PUSH_PAYLOAD, skipReason } from './pick.js';
import { register as registerDevices } from './devices.js';
import { nudgeBody, nudgeMessage } from './fcm.js';
import { sendPush } from './send.js';
import { fromB64u, vapidKeyObject } from './vapid.js';

// 端末への通知（契約 §3.7c・#211）。VAPID の 3 つが揃わない時は経路を足さない（＝404）。
// 本文・endpoint・鍵はログに出さない。
export const MAX_DEVICES = 3;
export const MAX_ENDPOINT = 1024;

const bad = (m) => new HttpError(400, 'invalid_argument', m);
const subId = (endpoint) => createHash('sha256').update(endpoint).digest('hex');
const sha = (s) => createHash('sha256').update(String(s)).digest();

function readEndpoint(v) {
  if (typeof v !== 'string' || v.length > MAX_ENDPOINT || !v.startsWith('https://')) {
    throw bad(`endpoint は https:// で始まる ${MAX_ENDPOINT} 字までの文字にしてください`);
  }
  try {
    new URL(v);
  } catch {
    throw bad('endpoint が正しくありません');
  }
  return v;
}

function readKey(v, name, len) {
  const ok = typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9_-]+={0,2}$/.test(v);
  const buf = ok ? fromB64u(v) : null;
  if (!buf || buf.length !== len || (len === 65 && buf[0] !== 4)) throw bad(`keys.${name} の形が違います`);
  return v;
}

export function validateSubscription(b) {
  const endpoint = readEndpoint(b?.endpoint);
  const keys = b?.keys;
  return { endpoint, p256dh: readKey(keys?.p256dh, 'p256dh', 65), auth: readKey(keys?.auth, 'auth', 16) };
}

// 一致の比較は長さに依らない時間で（両方の sha256 を timingSafeEqual）。
export function tickSecretOk(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

const live = (s) => !s.deletedAt;

export function register(router, ctx) {
  const { vapidPublicKey: publicKey, vapidPrivateKey: privateKey, vapidSubject: subject, tickSecret } = ctx.config;
  const fcm = registerDevices(router, ctx); // スマホの FCM（#298）。FCM_PROJECT_ID が無ければ null
  const now = () => (ctx.now ? ctx.now() : new Date());
  const vapid = publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
  if (vapid) registerWebPush(router, ctx, vapid);
  if (tickSecret && (vapid || fcm)) registerTick(router, ctx, { vapid, fcm, tickSecret, now });
}

function registerWebPush(router, ctx, { publicKey, privateKey }) {
  vapidKeyObject(publicKey, privateKey); // 形が違う鍵なら起動時に止める（値は出さない）

  router.add('GET', '/api/push/key', async () => ({ status: 200, body: { publicKey } }));

  router.add('POST', '/api/push/subscribe', async ({ userId, body }) => {
    const sub = validateSubscription(body);
    const id = subId(sub.endpoint);
    const mine = (await ctx.store.list(C.pushSubs, { userId })).filter(live);
    if (!mine.some((s) => s.id === id) && mine.length >= MAX_DEVICES) {
      throw new HttpError(409, 'conflict', `通知を受ける端末は ${MAX_DEVICES} つまでです`);
    }
    await ctx.store.put(C.pushSubs, id, { userId, ...sub, createdAt: nowIso(ctx), deletedAt: null });
    return { status: 204 };
  });

  router.add('DELETE', '/api/push/subscribe', async ({ userId, body }) => {
    const endpoint = readEndpoint(body?.endpoint);
    const id = subId(endpoint);
    const cur = await ctx.store.get(C.pushSubs, id);
    if (cur && cur.userId === userId && live(cur)) await forget(ctx, id, userId);
    return { status: 204 };
  });
}

// 合図（Cloud Scheduler）。Web Push と FCM の両方の登録を、同じ選び方（pick.js）・同じ 1 日の数で送る。
function registerTick(router, ctx, { vapid, fcm, tickSecret, now }) {
  router.add(
    'POST',
    '/api/push/tick',
    async ({ req }) => {
      if (!tickSecretOk(req.headers['x-tick-secret'], tickSecret)) {
        throw new HttpError(401, 'unauthenticated', '合図の鍵が違います');
      }
      const at = now();
      const byUser = new Map(); // userId → { subs, devices }
      const entry = (userId) => {
        if (!byUser.has(userId)) byUser.set(userId, { subs: [], devices: [] });
        return byUser.get(userId);
      };
      if (vapid) for (const s of (await ctx.store.list(C.pushSubs)).filter(live)) entry(s.userId).subs.push(s);
      if (fcm) for (const d of await fcm.liveDevices()) entry(d.userId).devices.push(d);
      let sent = 0;
      let skipped = 0;
      for (const [userId, { subs, devices }] of byUser) {
        const [user, sessions, state] = await Promise.all([
          ctx.store.get(C.users, userId),
          ctx.store.list(C.sessions, { userId }),
          ctx.store.get(C.pushSent, userId),
        ]);
        if (skipReason({ user, sessions, sent: state, now: at })) {
          skipped += 1;
          continue;
        }
        // 今日始めた友達がいれば、その人の名前を入れる（11/9・固定の文＋表示名だけ）
        const friendName = await todayStarterName(ctx, userId, at);
        const payload = { ...PUSH_PAYLOAD, body: nudgeBody(friendName) };
        let ok = 0;
        for (const sub of subs) {
          const r = await sendPush({ sub, payload, vapid, fetchImpl: ctx.pushFetch, now: at });
          if (r === 'ok') ok += 1;
          else if (r === 'gone') await forget(ctx, sub.id, userId);
        }
        if (fcm) ok += await fcm.sendTo(devices, nudgeMessage(friendName));
        sent += ok;
        if (ok > 0) {
          const day = jstDayKey(at);
          await ctx.store.put(C.pushSent, userId, { day, count: state?.day === day ? state.count + 1 : 1 });
        }
      }
      return { status: 200, body: { sent, skipped } };
    },
    { auth: false },
  );
}

// 承認済みの友達のうち、今日いちばん最近に集中を始めた人の表示名（いなければ null）
async function todayStarterName(ctx, userId, at) {
  const [mine, theirs] = await Promise.all([
    ctx.store.list(C.friendships, { userId }),
    ctx.store.list(C.friendships, { friendId: userId }),
  ]);
  const ids = [...mine, ...theirs].filter((f) => f.status === 'accepted').map((f) => (f.userId === userId ? f.friendId : f.userId));
  const starts = [];
  for (const friendId of ids) {
    for (const s of await ctx.store.list(C.sessions, { userId: friendId })) starts.push({ friendId, startedAt: s.startedAt });
  }
  const who = latestStarterToday(starts, at);
  if (!who) return null;
  return (await ctx.store.get(C.users, who))?.displayName || null;
}

// 保管に「消す」が無いので、endpoint と鍵を空にして deletedAt を付ける（以後は数えない・送らない）。
async function forget(ctx, id, userId) {
  await ctx.store.put(C.pushSubs, id, { userId, endpoint: null, p256dh: null, auth: null, deletedAt: nowIso(ctx) });
}
