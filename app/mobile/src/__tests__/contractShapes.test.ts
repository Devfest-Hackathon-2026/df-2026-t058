// 契約の応答の形（contract-shapes.json＝app/api/test/contract-shapes.json の写し）と、
// ① types.ts の型のキー ② mock の実際の応答 を突き合わせる（Issue #66）。
// サーバー側は app/api/test/contract-shapes.test.js が同じ見本で実応答を確かめ、写しが同じ中身かも確かめる。

import { createMockApi } from '../api/mock';
import type { Axis, Candidate, CandidateCheckpoint, Checkpoint, FeedItem, Floor, FocusEvent, FriendEntry, Friendship, Goal, GoalDetail, HelpTotal, Roadmap, RoadmapReviseResult, Session, TodayProposalItem, TodayResult, TutorMessage, User, TodayFloor, HomeFriend, GoalDoc, PointItem, PointsByGoal, PointsData } from '../api/types';
import shapes from './contract-shapes.json';

interface Spec {
  required?: Record<string, string>;
  optional?: Record<string, string>;
  model?: string;
}
const MODELS = shapes.models as Record<string, Spec>;
// 見直し（#353・#359）で GET /api/goals/:id に pace を足した（後方互換）。json はサーバー側の写しと同じ中身である必要があるので、
// サーバー側の json と試験に足すまで、ここで足す（下の today・points と同じ理由）
const GOAL_DETAIL_PACE = 'string|null';
const RESPONSES: Record<string, Spec> = {
  ...(shapes.responses as Record<string, Spec>),
  'GET /api/goals/:id': {
    ...(shapes.responses as Record<string, Spec>)['GET /api/goals/:id'],
    optional: { ...((shapes.responses as Record<string, Spec>)['GET /api/goals/:id']!.optional ?? {}), pace: GOAL_DETAIL_PACE },
  },
};

function shapeErrors(typeSpec: string, value: unknown, where: string): string[] {
  let best: string[] | null = null;
  for (const t of typeSpec.split('|')) {
    const errs = oneType(t, value, where);
    if (errs.length === 0) return [];
    if (!best || errs.length < best.length) best = errs;
  }
  return best ?? [];
}

function oneType(t: string, v: unknown, where: string): string[] {
  if (t.startsWith('[') && t.endsWith(']')) {
    if (!Array.isArray(v)) return [`${where}: 配列ではない`];
    return v.flatMap((x, i) => shapeErrors(t.slice(1, -1), x, `${where}[${i}]`));
  }
  if (t === 'null') return v === null ? [] : [`${where}: null ではない`];
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v) ? [] : [`${where}: object ではない`];
  if (t === 'string' || t === 'number' || t === 'boolean') return typeof v === t ? [] : [`${where}: ${t} ではない`];
  const model = MODELS[t];
  return model ? objectErrors(model, v, where) : [`${where}: 見本に無い型 ${t}`];
}

function objectErrors(spec: Spec, v: unknown, where: string): string[] {
  if (spec.model) return shapeErrors(spec.model, v, where);
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${where}: object ではない`];
  const obj = v as Record<string, unknown>;
  const req = spec.required ?? {};
  const opt = spec.optional ?? {};
  const errs: string[] = [];
  for (const [k, t] of Object.entries(req)) {
    if (!(k in obj)) errs.push(`${where}.${k}: 無い`);
    else errs.push(...shapeErrors(t, obj[k], `${where}.${k}`));
  }
  for (const [k, x] of Object.entries(obj)) {
    if (k in req) continue;
    const t = opt[k];
    if (t === undefined) errs.push(`${where}.${k}: 契約に無いキー`);
    else if (x !== undefined) errs.push(...shapeErrors(t, x, `${where}.${k}`));
  }
  return errs;
}

// ---------- ① types.ts のキーと見本のキー ----------
// Record<keyof T, …> の文字どおりの値なので、型にあって下に無いキー・下にあって型に無いキーは tsc が止める。
// 下の一覧と見本（required ∪ optional）の一致は jest が確かめる。
type Keys<T> = Record<keyof Required<T>, 'required' | 'optional'>;
const R = 'required' as const;
const O = 'optional' as const;
const TYPE_KEYS: Record<string, Record<string, 'required' | 'optional'>> = {
  User: { id: R, friendCode: R, displayName: R, nudgeLevel: R, streak: R, createdAt: R } satisfies Keys<User>,
  Goal: { id: R, userId: R, text: R, deadline: R, minutesPerDay: R, status: R, kind: O, materials: O, createdAt: O, archivedAt: O, docs: O } satisfies Keys<Goal>,
  GoalDoc: { id: R, title: R, text: R, from: R, addedAt: R, updatedAt: O } satisfies Keys<GoalDoc>,
  Checkpoint: {
    id: R, order: R, title: R, doneMark: R, estimateMin: R, state: R, achievement: R, aiAchievement: O, achievementReason: O,
  } satisfies Keys<Checkpoint>,
  CandidateCheckpoint: { id: R, order: R, title: R, doneMark: R, estimateMin: R } satisfies Keys<CandidateCheckpoint>,
  Candidate: { id: R, label: R, summary: R, checkpoints: R, axes: R } satisfies Keys<Candidate>,
  Axis: { key: R, label: R } satisfies Keys<Axis>,
  Roadmap: { id: R, goalId: R, userId: R, adopted: R, why: R, checkpoints: R, createdAt: R, editRatio: O } satisfies Keys<Roadmap>,
  Session: {
    id: R, userId: R, goalId: R, checkpointId: R, startedAt: R, oneLine: R, leaveCount: R,
    focusMin: O, endedAt: O, materials: O, stuckCause: O, reflectedAt: O, judgeable: O, aiAchievement: O, achievement: O,
    achievementReason: O, nextSteps: O, note: O, aiUnavailable: O, confirmedAt: O,
  } satisfies Keys<Session>,
  Event: { id: R, userId: R, sessionId: R, type: R, at: R, meta: O } satisfies Keys<FocusEvent>,
  Floor: {
    id: R, userId: R, sessionId: R, focusMin: R, at: R, timeScore: R, achievementScore: R, ownScore: R,
    achievement: R, aiAchievement: R, floors: R, color: R, derivedFrom: R,
    asks: O, thoughtAsks: O, pt: O,
  } satisfies Keys<Floor>,
  TutorMessage: { id: R, sessionId: R, role: R, kind: R, text: R, helpLevel: R, at: R, sources: O } satisfies Keys<TutorMessage>,
  HelpTotal: { small: R, medium: R } satisfies Keys<HelpTotal>,
  Friendship: { id: R, userId: R, friendId: R, status: R, notifyOnStart: R, createdAt: O } satisfies Keys<Friendship>,
  FriendEntry: { friendship: R, user: R, activeNow: R, floors: R, streak: R, today: O } satisfies Keys<FriendEntry>,
  TodayFloor: { id: R, color: R } satisfies Keys<TodayFloor>,
  HomeFriend: { userId: R, displayName: R, activeNow: R, today: R } satisfies Keys<HomeFriend>,
  FeedItem: { userId: R, displayName: R, oneLine: R, at: R } satisfies Keys<FeedItem>,
};

describe('types.ts は契約の形（見本）と同じキーを持つ', () => {
  test.each(Object.keys(TYPE_KEYS))('%s', (name) => {
    const spec = MODELS[name]!;
    const want = Object.fromEntries([
      ...Object.keys(spec.required ?? {}).map((k) => [k, 'required']),
      ...Object.keys(spec.optional ?? {}).map((k) => [k, 'optional']),
    ]);
    expect(TYPE_KEYS[name]).toEqual(want);
  });
});

// ---------- ② mock の応答 ----------
const tinyJpeg = () => ({ mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(400) });

test('mock の全ての経路の応答が、見本の形（キーと型）に合う', async () => {
  let t = Date.parse('2026-11-05T01:00:00Z');
  const api = createMockApi({ now: () => (t += 1000), aiDelayMs: 0 });
  const seen = new Set<string>();
  const check = <T>(route: string, v: T): T => {
    seen.add(route);
    expect(objectErrors(RESPONSES[route]!, v, route)).toEqual([]);
    return v;
  };

  check('GET /api/health', await api.health());
  check('GET /api/me', await api.me());
  check('PUT /api/me', await api.updateMe({ displayName: 'いち', nudgeLevel: 'friend_start' }));
  const goal = check('POST /api/goals', await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 30, materials: 'p.12' }));
  check('GET /api/goals', await api.listGoals());
  const { candidates } = check('POST /api/goals/:id/candidates', await api.makeCandidates(goal.id));
  check('GET /api/goals/:id', await api.getGoal(goal.id));
  const edited = candidates[0]!.checkpoints.map(({ title, doneMark, estimateMin }) => ({ title, doneMark, estimateMin }));
  const rm = check(
    'POST /api/goals/:id/roadmap',
    await api.decideRoadmap(goal.id, { source: 'edited', candidateId: candidates[0]!.id, why: 'a', checkpoints: edited }),
  );
  const s = check('POST /api/sessions', await api.startSession({ goalId: goal.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'a', materials: 'b' }));
  check('GET /api/sessions/active', await api.activeSession());
  check('POST /api/sessions/:id/events', await api.sendEvent(s.id, 'leave'));
  check('POST /api/sessions/:id/events', await api.sendEvent(s.id, 'return'));
  check('POST /api/sessions/:id/tutor', await api.tutor(s.id, { kind: 'ask', text: 'やり方を教えて', images: [tinyJpeg()] }));
  check('POST /api/sessions/:id/tutor', await api.tutor(s.id, { kind: 'research', text: '因数分解' }));
  check('GET /api/sessions/:id/tutor', await api.tutorHistory(s.id));
  t += 20 * 60_000;
  check('POST /api/sessions/:id/end', await api.endSession(s.id));
  check('POST /api/materials/read', await api.readMaterials([tinyJpeg()]));
  check('POST /api/materials/read', await api.readMaterials([], [{ mimeType: 'application/pdf', dataBase64: 'JVBERi0xLjQK' }]));
  check(
    'POST /api/sessions/:id/reflect',
    await api.reflect(s.id, { note: '', done: false, images: [tinyJpeg()], materials: '', stuck: { cause: 'too_big', note: '' } }),
  );
  check('POST /api/sessions/:id/reflect/confirm', await api.confirmReflect(s.id, 2));
  check('GET /api/tower', await api.tower());
  const f = check('POST /api/friends', await api.addFriend('KEN003'));
  expect(f.status).toBe('pending');
  const incoming = (await api.friends()).friends.find((x) => x.friendship.status === 'pending' && x.friendship.friendId === 'me');
  check('POST /api/friends/:id/accept', await api.acceptFriend(incoming!.friendship.id));
  check('GET /api/friends', await api.friends());
  check('GET /api/feed', await api.feed());
  check('GET /api/home', await api.home());

  // ログインは mock に無い（api/auth.ts がサーバーへ直接送る）。それ以外は全部通った
  expect([...seen, 'POST /api/login'].sort()).toEqual(Object.keys(RESPONSES).sort());
});

// POST /api/today（#185・#187）。contract-shapes.json はサーバー側の写しと同じ中身であることをサーバーの試験が確かめるので、
// ここでは見本を直に書く。json へ移すのは、サーバー側の json と試験に足す時に一緒に（スマホだけ足すとサーバーの試験が落ちる）
const TODAY_PROPOSAL: Spec = {
  required: { goalId: 'string', checkpointId: 'string', title: 'string', minutes: 'number', reason: 'string' },
};
const TODAY_RESPONSE: Spec = {
  required: { greeting: 'string', minutes: 'number', proposals: '[object]', totalMinutes: 'number', source: 'string' },
};
const TODAY_TYPE_KEYS = {
  TodayResult: { greeting: R, minutes: R, proposals: R, totalMinutes: R, source: R } satisfies Keys<TodayResult>,
  TodayProposal: { goalId: R, checkpointId: R, title: R, minutes: R, reason: R } satisfies Keys<TodayProposalItem>,
};

describe('POST /api/today の形', () => {
  test('types.ts のキーが見本と同じ', () => {
    expect(Object.keys(TODAY_TYPE_KEYS.TodayResult).sort()).toEqual(Object.keys(TODAY_RESPONSE.required!).sort());
    expect(Object.keys(TODAY_TYPE_KEYS.TodayProposal).sort()).toEqual(Object.keys(TODAY_PROPOSAL.required!).sort());
  });

  test('mock の応答（空・提案あり）が見本の形に合う', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    const errs = (v: { proposals: unknown[] }) => [
      ...objectErrors(TODAY_RESPONSE, v, 'POST /api/today'),
      ...v.proposals.flatMap((p, i) => objectErrors(TODAY_PROPOSAL, p, `proposals[${i}]`)),
    ];
    const empty = await api.today(30);
    expect(errs(empty)).toEqual([]);
    expect(['ai', 'rules']).toContain(empty.source);
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z' });
    const { candidates } = await api.makeCandidates(g.id);
    await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const some = await api.today(60);
    expect(some.proposals.length).toBeGreaterThan(0);
    expect(errs(some)).toEqual([]);
    expect(['ai', 'rules']).toContain(some.source);
    for (const p of some.proposals) expect(p.reason.length).toBeLessThanOrEqual(80);
    expect(some.greeting.length).toBeLessThanOrEqual(80);
  });
});

// GET /api/points（契約 §3.6b・byGoal は #351 で足した後方互換の追加）。上の today と同じ理由で、見本はここに直に書く
// （json はサーバー側の写しと同じ中身である必要があり、サーバー側の json と試験に足す時に一緒に移す）
const POINT_ITEM: Spec = { required: { at: 'string', kind: 'string', pt: 'number', label: 'string' } };
const POINTS_BY_GOAL: Spec = { required: { goalId: 'string', text: 'string', pt: 'number', archived: 'boolean' } };
const POINTS_RESPONSE: Spec = {
  required: { total: 'number', today: 'number', week: 'number', items: '[object]' },
  optional: { byGoal: '[object]' },
};
const POINTS_TYPE_KEYS = {
  PointsData: { total: R, today: R, week: R, items: R, byGoal: O } satisfies Keys<PointsData>,
  PointItem: { at: R, kind: R, pt: R, label: R } satisfies Keys<PointItem>,
  PointsByGoal: { goalId: R, text: R, pt: R, archived: R } satisfies Keys<PointsByGoal>,
};

describe('GET /api/points の形', () => {
  const keysOf = (s: Spec) => [...Object.keys(s.required ?? {}), ...Object.keys(s.optional ?? {})].sort();
  test('types.ts のキーが見本と同じ', () => {
    expect(Object.keys(POINTS_TYPE_KEYS.PointsData).sort()).toEqual(keysOf(POINTS_RESPONSE));
    expect(Object.keys(POINTS_TYPE_KEYS.PointItem).sort()).toEqual(keysOf(POINT_ITEM));
    expect(Object.keys(POINTS_TYPE_KEYS.PointsByGoal).sort()).toEqual(keysOf(POINTS_BY_GOAL));
  });

  test('mock の応答が見本の形に合う・byGoal に目標ごとの行が入る・byGoal の無い古い応答も形に合う', async () => {
    let t = Date.parse('2026-11-08T03:00:00Z');
    const api = createMockApi({ aiDelayMs: 0, now: () => t });
    const errs = (v: PointsData) => [
      ...objectErrors(POINTS_RESPONSE, v, 'GET /api/points'),
      ...v.items.flatMap((x, i) => objectErrors(POINT_ITEM, x, `items[${i}]`)),
      ...(v.byGoal ?? []).flatMap((x, i) => objectErrors(POINTS_BY_GOAL, x, `byGoal[${i}]`)),
    ];
    expect(errs(await api.points())).toEqual([]);
    const g = await api.createGoal({ text: '英検', deadline: '2026-11-20T14:59:00Z' });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: '始める' });
    t += 30 * 60_000;
    await api.endSession(s.id);
    const p = await api.points();
    expect(errs(p)).toEqual([]);
    expect(p.byGoal).toEqual([{ goalId: g.id, text: '英検', pt: expect.any(Number), archived: false }]);
    expect(p.byGoal![0]!.pt).toBeGreaterThan(0);
    expect(errs({ total: 0, today: 0, week: 0, items: [] })).toEqual([]);
  });
});

// ロードマップの見直し（契約 §3.3・#353・#359）。上の today・points と同じ理由で、見本はここに直に書く
const REVISE_DRAFT_ITEM: Spec = { required: { title: 'string', doneMark: 'string', estimateMin: 'number' } };
const REVISE_RESPONSE: Spec = { required: { reply: 'string', draft: '[object]', pace: 'string|null' } };
const REVISE_TYPE_KEYS = {
  RoadmapReviseResult: { reply: R, draft: R, pace: R } satisfies Keys<RoadmapReviseResult>,
  GoalDetail: { goal: R, roadmap: R, candidates: R, axes: R, pace: O } satisfies Keys<GoalDetail>,
};

describe('ロードマップの見直しの形', () => {
  const keysOf = (s: Spec) => [...Object.keys(s.required ?? {}), ...Object.keys(s.optional ?? {})].sort();
  test('types.ts のキーが見本と同じ', () => {
    expect(Object.keys(REVISE_TYPE_KEYS.RoadmapReviseResult).sort()).toEqual(keysOf(REVISE_RESPONSE));
    expect(Object.keys(REVISE_TYPE_KEYS.GoalDetail).sort()).toEqual(keysOf(RESPONSES['GET /api/goals/:id']!));
  });

  test('mock の revise・remaining・pace の応答が見本の形に合う', async () => {
    const api = createMockApi({ aiDelayMs: 0, now: () => Date.parse('2026-11-09T03:00:00Z') });
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-10T14:59:00Z', minutesPerDay: 15 });
    expect(objectErrors(RESPONSES['GET /api/goals/:id']!, await api.getGoal(g.id), 'GET /api/goals/:id')).toEqual([]);
    const { candidates } = await api.makeCandidates(g.id);
    await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const d = await api.getGoal(g.id);
    expect(objectErrors(RESPONSES['GET /api/goals/:id']!, d, 'GET /api/goals/:id')).toEqual([]);
    expect(d.pace).toBe('behind');
    const r = await api.reviseRoadmap(g.id, {});
    expect([
      ...objectErrors(REVISE_RESPONSE, r, 'POST /api/goals/:id/roadmap/revise'),
      ...r.draft.flatMap((x, i) => objectErrors(REVISE_DRAFT_ITEM, x, `draft[${i}]`)),
    ]).toEqual([]);
    expect(objectErrors(MODELS.Roadmap!, await api.replaceRemaining(g.id, r.draft), 'PUT /api/goals/:id/roadmap/remaining')).toEqual([]);
  });
});

describe('mock のエラーはサーバーと同じ code・HTTP（11/7 の点検）', () => {
  async function planned() {
    const api = createMockApi({ aiDelayMs: 0 });
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    const { candidates } = await api.makeCandidates(g.id);
    return { api, g, candidates };
  }

  test('ロードマップ: 無い案は 404・確定後の確定と案の作り直しは 409', async () => {
    const { api, g, candidates } = await planned();
    await expect(api.decideRoadmap(g.id, { source: 'candidate', candidateId: 'nope', why: 'a', checkpoints: [] })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    await expect(api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] })).rejects.toMatchObject({ status: 409 });
    await expect(api.makeCandidates(g.id)).rejects.toMatchObject({ status: 409 });
  });

  test('集中: ロードマップが無いと 404・完了したチェックポイントは 409', async () => {
    const { api, g, candidates } = await planned();
    await expect(api.startSession({ goalId: g.id, checkpointId: 'x', oneLine: 'a' })).rejects.toMatchObject({ status: 404 });
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const cp = rm.checkpoints[0]!.id;
    const s = await api.startSession({ goalId: g.id, checkpointId: cp, oneLine: 'a' });
    await api.endSession(s.id);
    await api.reflect(s.id, { note: '', done: false, images: [tinyJpeg()], materials: '' }); // 偽の判定は 3＝完了
    await expect(api.startSession({ goalId: g.id, checkpointId: cp, oneLine: 'a' })).rejects.toMatchObject({ status: 409 });
  });

  test('友達: 見つからないコードが 5 回で、その日は 429（当たりのコードでも）', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    for (let i = 0; i < 5; i++) await expect(api.addFriend(`ZZZZZ${i}`)).rejects.toMatchObject({ status: 404 });
    await expect(api.addFriend('KEN003')).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  test('知らせ: 11/9 から強め固定。off を送っても出る・強さは strong のまま', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    expect((await api.feed()).items.length).toBeGreaterThan(0);
    const me = await api.updateMe({ nudgeLevel: 'off' });
    expect(me.nudgeLevel).toBe('strong');
    expect((await api.feed()).items.length).toBeGreaterThan(0);
  });

  test('写真: 1 枚 1,500,000 バイトを超えたら 400（相談・資料を読むも同じ）', async () => {
    const { api } = await planned();
    const big = { mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(2_000_004) };
    await expect(api.readMaterials([big])).rejects.toMatchObject({ status: 400, code: 'invalid_argument' });
  });
});
