import { getOrCreateUser, withStreak } from '../auth/routes.js';
import { C } from '../common/collections.js';
import { homeFriends } from '../friends/routes.js';

// ホーム用（契約の変更点 §5）。ホーム 1 枚に要る物を 1 回で返し、スマホの往復を減らす。
// 中身は既存の経路と同じ形にするため、既存の経路のハンドラをそのまま呼ぶ（形を二重に書かない）。
// どの経路も userId で本人の物だけに絞っている（他人の物は混ざらない）。
// toReflect: 終えたがまだ振り返っていない集中（新しい順・最大 TO_REFLECT_MAX）。振り返りの画面を途中で閉じた時の入口。
export const TO_REFLECT_MAX = 3;
export function register(router, ctx) {
  // 既存の GET 経路を、同じ要求の本人として中で呼ぶ。経路が無い時は起動後の初回で気づけるよう投げる。
  const callGet = async (path, { req, userId }) => {
    const hit = router.match('GET', path);
    if (!hit) throw new Error(`home: 経路がありません ${path}`);
    const out = await hit.handler({ req, params: hit.params, userId, body: undefined, ctx });
    return out.body;
  };

  router.add('GET', '/api/home', async ({ req, userId }) => {
    const me = await withStreak(ctx, await getOrCreateUser(ctx, userId)); // GET /api/me と同じ（初回は作る・連続記録は計算）
    const call = (path) => callGet(path, { req, userId });

    const [{ goals }, { session }, tower, { items }] = await Promise.all([
      call('/api/goals'),
      call('/api/sessions/active'),
      call('/api/tower'),
      call('/api/feed'),
    ]);
    // GET /api/goals/:id から goal と roadmap だけを取る（candidates はホームでは使わない）。
    // やめた目標（archivedAt あり・#231）はホームに出さない。一覧は GET /api/goals に残る。
    const withRoadmaps = await Promise.all(
      goals.filter((g) => !g.archivedAt).map(async (g) => {
        const { goal, roadmap } = await call(`/api/goals/${encodeURIComponent(g.id)}`);
        return { goal, roadmap };
      }),
    );

    const friends = await homeFriends(ctx, userId); // 一番上の友達の列（11/9・契約 §3.9）
    const toReflect = (await ctx.store.list(C.sessions, { userId }))
      .filter((x) => x.endedAt && !x.reflectedAt)
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
      .slice(0, TO_REFLECT_MAX);

    return {
      status: 200,
      body: {
        me,
        goals: withRoadmaps,
        active: session,
        tower: { totalFloors: tower.totalFloors, streak: tower.streak },
        feed: items,
        toReflect,
        friends,
      },
    };
  });
}
