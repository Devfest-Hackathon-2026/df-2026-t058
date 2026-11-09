import { createHash } from 'node:crypto';
import { C } from '../common/collections.js';
import { nowIso } from '../common/time.js';
import { createTokenProvider } from '../gemini/vertex.js';
import { HttpError } from '../http.js';
import { friendStartMessage, sendFcm } from './fcm.js';
import { isQuietHour } from './pick.js';

// スマホ（Android）の FCM 登録と送信（契約 §3.7d・#298）。FCM_PROJECT_ID が無い時は経路を足さず null を返す（＝404・何も送らない）。
// 保管は Web Push と同じ store（memory／firestore）。Firestore の集まりの名前は小文字と _ だけなので push_devices にする。
export const COL = { devices: 'push_devices', friendSent: 'push_friend_sent' }; // friendSent: id = userId（{ at }＝最後に友達の通知を届けた時刻）
export const MAX_TOKEN = 4096;
export const FRIEND_INTERVAL_MS = 3600_000; // 友達の通知は 1 人 1 時間に 1 回まで

const bad = (m) => new HttpError(400, 'invalid_argument', m);
const devId = (token) => createHash('sha256').update(token).digest('hex');
const live = (d) => !d.deletedAt;

function readToken(v) {
  if (typeof v !== 'string' || v.length < 1 || v.length > MAX_TOKEN) throw bad(`token は 1〜${MAX_TOKEN} 字の文字にしてください`);
  return v;
}

export function register(router, ctx) {
  const projectId = ctx.config.fcmProjectId;
  if (!projectId) return null;
  const fetchImpl = ctx.pushFetch ?? fetch;
  // Cloud Run のメタデータサーバーから取り、期限まで使い回す（env: {}＝手元の GEMINI_ACCESS_TOKEN は使わない）。
  const getToken = createTokenProvider({ fetchImpl, env: {} });
  const now = () => (ctx.now ? ctx.now() : new Date());
  const { store } = ctx;
  const pending = new Set();

  const forget = (d) => store.put(COL.devices, d.id, { userId: d.userId, token: null, platform: d.platform, deletedAt: nowIso(ctx) });
  const devicesOf = async (userId) => (await store.list(COL.devices, { userId })).filter(live);

  // 端末の束へ送り、届いた数を返す。認証が取れない時は送らず 0（記録だけ・例外は外へ出さない）。
  async function sendTo(devices, msg) {
    if (devices.length === 0) return 0;
    let access;
    try {
      access = await getToken();
    } catch {
      console.warn('[fcm] 認証トークンが取れないので送らない');
      return 0;
    }
    let ok = 0;
    for (const d of devices) {
      const r = await sendFcm({ projectId, token: d.token, msg, access, fetchImpl });
      if (r === 'ok') ok += 1;
      else if (r === 'gone') await forget(d);
    }
    return ok;
  }

  // 承認済みで notifyOnStart の友達へ。off・集中中・送らない時間帯・1 時間以内に送った人には送らない。
  async function notifyFriends(userId) {
    const at = now();
    if (isQuietHour(at)) return;
    const [mine, theirs, me] = await Promise.all([
      store.list(C.friendships, { userId }),
      store.list(C.friendships, { friendId: userId }),
      store.get(C.users, userId),
    ]);
    const msg = friendStartMessage(me?.displayName);
    for (const f of [...mine, ...theirs]) {
      if (f.status !== 'accepted' || f.notifyOnStart === false) continue;
      const to = f.userId === userId ? f.friendId : f.userId;
      if (to === userId) continue;
      const [user, sessions, last, devices] = await Promise.all([
        store.get(C.users, to),
        store.list(C.sessions, { userId: to }),
        store.get(COL.friendSent, to),
        devicesOf(to),
      ]);
      // 11/9 から nudgeLevel での出し分けは無い（全員 strong）
      if (sessions.some((s) => !s.endedAt)) continue;
      if (last && at.getTime() - Date.parse(last.at) < FRIEND_INTERVAL_MS) continue;
      if ((await sendTo(devices, msg)) > 0) await store.put(COL.friendSent, to, { at: at.toISOString() });
    }
  }

  const fcm = {
    sendTo,
    liveDevices: async () => (await store.list(COL.devices)).filter(live),
    // 集中を始めた時に呼ぶ（待たない・失敗しても集中の開始は落とさない）。
    friendStart(userId) {
      const p = notifyFriends(userId).catch(() => console.warn('[fcm] 友達への通知に失敗'));
      pending.add(p);
      p.finally(() => pending.delete(p));
    },
    idle: () => Promise.all([...pending]), // 試験用: 送り終わるまで待つ
  };
  ctx.fcm = fcm;

  router.add('POST', '/api/push/device', async ({ userId, body }) => {
    const token = readToken(body?.token);
    if (body?.platform !== 'android') throw bad('platform は android にしてください');
    // 同じ token は 1 件（他の人の登録だった時は、登録した人に移る）。
    await store.put(COL.devices, devId(token), { userId, token, platform: 'android', createdAt: nowIso(ctx), deletedAt: null });
    return { status: 204 };
  });

  router.add('DELETE', '/api/push/device', async ({ userId, body }) => {
    const token = readToken(body?.token);
    const cur = await store.get(COL.devices, devId(token));
    if (cur && cur.userId === userId && live(cur)) await forget(cur);
    return { status: 204 };
  });

  return fcm;
}
