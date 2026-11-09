import { C } from '../common/collections.js';
import { HttpError } from '../http.js';
import { withLock } from '../roadmap/lock.js';
import { seedDemo } from './seed.js';

// POST /api/demo/seed（DEMO_SEED=on の時だけ index.js が登録する。無い時は 404）。
export function register(router, ctx) {
  router.add('POST', '/api/demo/seed', async ({ userId }) =>
    withLock(`goals:${userId}`, async () => {
      if ((await ctx.store.list(C.goals, { userId })).length > 0) {
        throw new HttpError(409, 'conflict', 'すでに目標があるので、見本は入れられません');
      }
      const { goal, floors } = await seedDemo(ctx, userId);
      return { status: 201, body: { goalId: goal.id, floors: floors.length } };
    }),
  );
}
