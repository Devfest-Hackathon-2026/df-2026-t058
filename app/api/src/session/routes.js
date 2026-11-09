import { randomUUID } from 'node:crypto';
import { C } from '../common/collections.js';
import { loadOwned } from '../common/owned.js';
import { nowIso } from '../common/time.js';
import { body, oneOf, str } from '../common/validate.js';
import { HttpError } from '../http.js';
import { recomputeFloor } from '../score/floor.js';
import { countLeaves, focusMinutes, isAway } from './focus.js';
import { withLock } from './lock.js';

// I-4: 集中セッション（契約 §3.4）。時間は端末の申告でなく、サーバーが付けた Event の時刻から出す（P3）。
const conflict = (message) => new HttpError(409, 'conflict', message);
const notFound = () => new HttpError(404, 'not_found', '見つかりません');

async function findActive(ctx, userId) {
  const mine = await ctx.store.list(C.sessions, { userId });
  return mine.find((s) => !s.endedAt) ?? null;
}

export function register(router, ctx) {
  const { store } = ctx;

  router.add('POST', '/api/sessions', async ({ userId, body: b }) => {
    body(b);
    const goalId = str(b.goalId, 'goalId', { max: 200 });
    const checkpointId = str(b.checkpointId, 'checkpointId', { max: 200 });
    const oneLine = str(b.oneLine, 'oneLine', { max: 200 });

    const materials = str(b.materials, 'materials', { min: 0, max: 2000, optional: true });

    return withLock(userId, async () => {
      await loadOwned(store, C.goals, goalId, userId); // 他人の目標は 404
      const roadmap = await store.get(C.roadmaps, goalId); // id = goalId
      if (!roadmap) throw notFound();
      const checkpoint = roadmap.checkpoints?.find((c) => c.id === checkpointId);
      if (!checkpoint) throw notFound();
      if (checkpoint.state === 'done') throw conflict('このチェックポイントはもう完了しています');
      if (await findActive(ctx, userId)) throw conflict('進行中の集中があります。先に終えてください');

      const session = await store.put(C.sessions, randomUUID(), {
        userId,
        goalId,
        checkpointId,
        oneLine,
        ...(materials !== undefined && { materials }),
        startedAt: nowIso(ctx),
        leaveCount: 0,
      });
      await store.append(C.events, { userId, sessionId: session.id, type: 'focus_start' });
      await store.put(C.roadmaps, goalId, {
        ...roadmap,
        checkpoints: roadmap.checkpoints.map((c) => (c.id === checkpointId ? { ...c, state: 'doing' } : c)),
      });
      ctx.fcm?.friendStart(userId); // 友達のスマホへ通知（#298・FCM がある時だけ・待たない・失敗しても開始は落ちない）
      return { status: 201, body: session };
    });
  });

  router.add('GET', '/api/sessions/active', async ({ userId }) => ({
    status: 200,
    body: { session: await findActive(ctx, userId) },
  }));

  router.add('POST', '/api/sessions/:id/events', async ({ params, userId, body: b }) => {
    body(b);
    const type = oneOf(b.type, 'type', ['leave', 'return']);
    return withLock(userId, async () => {
      const session = await loadOwned(store, C.sessions, params.id, userId);
      if (session.endedAt) throw conflict('この集中はもう終わっています');
      const events = await store.list(C.events, { sessionId: session.id });
      const away = isAway(events);
      if (type === 'leave' && away) throw conflict('すでに離れています');
      if (type === 'return' && !away) throw conflict('離れていないので戻れません');

      const event = await store.append(C.events, { userId, sessionId: session.id, type });
      if (type === 'leave') await store.put(C.sessions, session.id, { ...session, leaveCount: countLeaves(events) + 1 });
      return { status: 201, body: event };
    });
  });

  router.add('POST', '/api/sessions/:id/end', async ({ params, userId }) => {
    return withLock(userId, async () => {
      const session = await loadOwned(store, C.sessions, params.id, userId);
      if (session.endedAt) throw conflict('この集中はもう終わっています');

      const endEvent = await store.append(C.events, { userId, sessionId: session.id, type: 'focus_end' });
      const events = await store.list(C.events, { sessionId: session.id });
      const ended = await store.put(C.sessions, session.id, {
        ...session,
        endedAt: endEvent.at, // 時間の計算と同じ時刻（サーバーが付けた物）を使う
        focusMin: focusMinutes(events, { startedAt: session.startedAt, endedAt: endEvent.at }),
        leaveCount: countLeaves(events),
      });
      const floor = await recomputeFloor(ctx, ended.id);
      return { status: 200, body: { session: ended, floor } };
    });
  });
}
