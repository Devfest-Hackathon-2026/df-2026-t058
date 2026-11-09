import { C } from '../common/collections.js';
import { computePoints, pointsForAchievement, pointsForSession } from './points.js';
import { scoredAchievement } from './rules.js';
import { computeStreak } from './streak.js';

// 考えポイント（docs/points.md）。本人の記録だけを読み、毎回計算する（保存しない）。
// focusMin が session に無い古い記録は、階（floors）の値で補う。
export async function loadPoints(ctx, userId) {
  const [sessions, floors, roadmaps, tutorMessages, goals] = await Promise.all([
    ctx.store.list(C.sessions, { userId }),
    ctx.store.list(C.floors, { userId }),
    ctx.store.list(C.roadmaps, { userId }),
    ctx.store.list(C.tutorMessages, { userId }),
    ctx.store.list(C.goals, { userId }),
  ]);
  const floorMin = new Map(floors.map((f) => [f.sessionId, f.focusMin]));
  const withMin = sessions.map((s) => (s.focusMin === undefined && floorMin.has(s.id) ? { ...s, focusMin: floorMin.get(s.id) } : s));
  return computePoints({ sessions: withMin, roadmaps, tutorMessages, goals, now: ctx.now ? ctx.now() : new Date() });
}

// I-6: 建物。階は C.floors（集中を終えると session/routes.js が recomputeFloor で作る）。
export function register(router, ctx) {
  router.add('GET', '/api/tower', async ({ userId }) => {
    const floors = (await ctx.store.list(C.floors, { userId })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const sessions = await ctx.store.list(C.sessions, { userId });
    const streak = computeStreak(
      sessions.map((s) => s.endedAt),
      ctx.now ? ctx.now() : new Date(),
    );
    const totalFloors = floors.reduce((sum, f) => sum + f.floors, 0);
    // 階の pt（契約 §3.6b）＝その集中の分の pt＋振り返りの達成度の pt（1 日の上限の前）。画面は窓の明かりに使う（決定 11/9）
    // 達成度の pt は、本人の判定と AI の判定の低い方（契約 §3.6・振り返りの pt と同じ）
    const withPt = floors.map((f) => ({
      ...f,
      pt: pointsForSession({ focusMin: f.focusMin }) + pointsForAchievement(scoredAchievement(f.achievement, f.aiAchievement ?? null)),
    }));
    return { status: 200, body: { floors: withPt, totalFloors, streak } };
  });

  router.add('GET', '/api/points', async ({ userId }) => ({ status: 200, body: await loadPoints(ctx, userId) }));
}
