import { C } from '../common/collections.js';
import { HttpError } from '../http.js';
import { focusMinutes } from '../session/focus.js';
import { colorFor, floorsFor, ownScoreFor, scoredAchievement } from './rules.js';

// 階（Floor）の計算（純粋関数）。元の記録（events・session・roadmap）から作り直せる派生物（P5）。
export function buildFloor({ session, roadmap, events }) {
  const count = (type) => events.filter((e) => e.type === type).length;
  const focusMin = focusMinutes(events, { startedAt: session.startedAt, endedAt: session.endedAt });
  // 達成度は、この集中（session）の「最終の判定」（本人が決め直していればその値）を使う。
  // チェックポイントの値は使わない（同じチェックポイントで何度も集中すると、後の振り返りで上書きされるため）。
  // achievement・aiAchievement・achievementScore は本人の値のまま（表示用）。
  // 色だけは、本人の判定と AI の判定（session.aiAchievement）の低い方で決める（scoredAchievement・契約 §3.6）。
  // null（振り返り前・AI が判定しきれず本人もまだ選んでいない）は 0。
  const achievement = session.achievement ?? null;
  const aiAchievement = session.aiAchievement ?? null;
  const achievementScore = achievement ?? 0;
  const ownScore = ownScoreFor({
    adopted: roadmap?.adopted,
    editRatio: roadmap?.editRatio,
    helpSmall: count('help_small'),
    helpMedium: count('help_medium'),
  });
  return {
    userId: session.userId,
    sessionId: session.id,
    focusMin,
    timeScore: focusMin,
    achievementScore,
    achievement, // 建物で階を押した時に「AI の判定・自分の判定」を出す用（この集中の値）
    aiAchievement,
    ownScore,
    floors: floorsFor(focusMin),
    color: colorFor(ownScore, scoredAchievement(achievement, aiAchievement)),
    derivedFrom: events.map((e) => e.id),
    at: session.endedAt, // 建物の並び順が再計算で動かないよう、集中を終えた時刻に固定する
  };
}

// 集中を終えた session の Floor を再計算して C.floors（id = sessionId）に保存し、返す。
// 「ふりかえり」（達成度の判定後）からも呼ぶ。本人かどうかの照合は呼ぶ側の責任。
export async function recomputeFloor(ctx, sessionId) {
  const session = await ctx.store.get(C.sessions, sessionId);
  if (!session) throw new HttpError(404, 'not_found', '見つかりません');
  if (!session.endedAt) throw new HttpError(409, 'conflict', 'まだ集中が終わっていません');
  const roadmap = await ctx.store.get(C.roadmaps, session.goalId);
  const events = await ctx.store.list(C.events, { sessionId });
  return ctx.store.put(C.floors, sessionId, buildFloor({ session, roadmap, events }));
}
