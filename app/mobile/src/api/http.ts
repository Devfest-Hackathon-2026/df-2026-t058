// real モード: サーバーへ送る。認証は、サーバーが invite（招待コード）なら Authorization: Bearer、
// それ以外は仮で x-dev-user（契約 §1・AUTH_MODE=fake の時だけ通る）。auth を渡さなければ x-dev-user だけ。
// 401 を受けたらトークンを捨ててログイン画面へ戻す（onUnauthorized・この 1 か所）。

import { ApiError, errorFromBody } from './errors';
import { candidatesBody } from '../lib/planView';
import type {
  Achievement,
  Api,
  Axis,
  Candidate,
  ConfirmResult,
  DeviceTokenBody,
  ExtractCandidate,
  FeedItem,
  Floor,
  FocusEvent,
  FriendEntry,
  Friendship,
  Goal,
  GoalDetail,
  HomeData,
  NudgeLevel,
  PointsData,
  PublicConfig,
  ReflectRequest,
  ReflectResult,
  Roadmap,
  RoadmapRequest,
  Session,
  TodayResult,
  StuckOptionsResult,
  TutorResult,
  User,
  WeeklyResult,
  AgentChatResult,
  RoadmapChatResult,
  RoadmapReviseResult,
  GoalDoc,
} from './types';

export interface HttpAuth {
  kind(): Promise<'invite' | 'fake' | 'real'>;
  token(): Promise<string | null>;
  signOut(): Promise<void>;
}

export interface HttpDeps {
  baseUrl: string;
  getUserId: () => Promise<string>;
  auth?: HttpAuth;
  fetchImpl?: typeof fetch;
}

// 無効なトークンの 401（契約 §2 の unauthenticated。invalid_token も同じ扱い）
const isSignedOut = (e: ApiError) => e.status === 401 && (e.code === 'unauthenticated' || e.code === 'invalid_token');

export function createHttpApi(deps: HttpDeps): Api {
  const base = deps.baseUrl.replace(/\/+$/, '');
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  // anon: 認証が要らない経路（health）。ヘッダを付けず、401 の扱いもしない
  async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, anon = false): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const invite = !anon && deps.auth ? (await deps.auth.kind()) === 'invite' : false;
    if (anon) {
      // 何も付けない
    } else if (invite) {
      const token = await deps.auth!.token();
      if (!token) {
        // 持っていないトークンでは呼ばない（ログイン画面へ）
        await deps.auth!.signOut();
        throw new ApiError(401, 'unauthenticated', '');
      }
      headers.authorization = `Bearer ${token}`;
    } else {
      headers['x-dev-user'] = await deps.getUserId();
    }
    if (body !== undefined) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network', '');
    }

    const text = await res.text();
    if (!res.ok) {
      const err = errorFromBody(res.status, text);
      if (invite && isSignedOut(err)) await deps.auth!.signOut();
      throw err;
    }
    if (text === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, 'internal', '');
    }
  }

  const enc = encodeURIComponent;

  return {
    health: () =>
      call<{ ok: boolean; auth?: 'invite' | 'fake' | 'real'; loginRequired?: boolean; demoSeed?: boolean }>('GET', '/api/health', undefined, true),
    config: () => call<PublicConfig>('GET', '/api/config', undefined, true),
    demoSeed: () => call<{ goalId: string; floors: number }>('POST', '/api/demo/seed', {}),
    home: () => call<HomeData>('GET', '/api/home'),
    me: () => call<User>('GET', '/api/me'),
    updateMe: (b: { displayName?: string; nudgeLevel?: NudgeLevel }) => call<User>('PUT', '/api/me', b),

    createGoal: (b) => call<Goal>('POST', '/api/goals', b),
    extractGoals: (b) => call<{ candidates: ExtractCandidate[] }>('POST', '/api/goals/extract', b),
    listGoals: () => call<{ goals: Goal[] }>('GET', '/api/goals'),
    getGoal: (id) => call<GoalDetail>('GET', `/api/goals/${enc(id)}`),
    updateGoal: (id, b) => call<Goal>('PUT', `/api/goals/${enc(id)}`, b),
    archiveGoal: (id) => call<Goal>('POST', `/api/goals/${enc(id)}/archive`, {}),
    addGoalDoc: (id, b) => call<GoalDoc>('POST', `/api/goals/${enc(id)}/docs`, b),
    updateGoalDoc: (id, docId, b) => call<GoalDoc>('PUT', `/api/goals/${enc(id)}/docs/${enc(docId)}`, b),
    deleteGoalDoc: async (id, docId) => {
      await call<unknown>('DELETE', `/api/goals/${enc(id)}/docs/${enc(docId)}`);
    },
    restoreGoal: (id) => call<Goal>('POST', `/api/goals/${enc(id)}/restore`, {}),
    makeCandidates: (id, note) =>
      call<{ axes: Axis[]; candidates: Candidate[] }>('POST', `/api/goals/${enc(id)}/candidates`, candidatesBody(note)),
    decideRoadmap: (id, b: RoadmapRequest) => call<Roadmap>('POST', `/api/goals/${enc(id)}/roadmap`, b),
    importTasks: (items) => call<{ goals: Goal[] }>('POST', '/api/goals/import', { items }),
    roadmapChat: (id, b) => call<RoadmapChatResult>('POST', `/api/goals/${enc(id)}/roadmap/chat`, b),
    reviseRoadmap: (id, b) => call<RoadmapReviseResult>('POST', `/api/goals/${enc(id)}/roadmap/revise`, b),
    replaceRemaining: (id, checkpoints) => call<Roadmap>('PUT', `/api/goals/${enc(id)}/roadmap/remaining`, { checkpoints }),

    startSession: (b) => call<Session>('POST', '/api/sessions', b),
    readMaterials: (images, files) =>
      call<{ text: string }>('POST', '/api/materials/read', files && files.length > 0 ? { images, files } : { images }),
    transcribe: (a) => call<{ text: string }>('POST', '/api/voice/transcribe', { audio: a.dataBase64, mimeType: a.mimeType }),
    activeSession: () => call<{ session: Session | null }>('GET', '/api/sessions/active'),
    sendEvent: (id, type) => call<FocusEvent>('POST', `/api/sessions/${enc(id)}/events`, { type }),
    endSession: (id) => call<{ session: Session; floor: Floor }>('POST', `/api/sessions/${enc(id)}/end`, {}),

    tutorHistory: (id) => call<TutorResult>('GET', `/api/sessions/${enc(id)}/tutor`),
    tutor: (id, b) => call<TutorResult>('POST', `/api/sessions/${enc(id)}/tutor`, b),
    stuckOptions: (id, intent) =>
      call<StuckOptionsResult>('POST', `/api/sessions/${enc(id)}/stuck-options`, { intent }),

    reflect: (id, b: ReflectRequest) => call<ReflectResult>('POST', `/api/sessions/${enc(id)}/reflect`, b),
    confirmReflect: (id, achievement: Achievement) =>
      call<ConfirmResult>('POST', `/api/sessions/${enc(id)}/reflect/confirm`, { achievement }),

    tower: () => call<{ floors: Floor[]; totalFloors: number; streak: number }>('GET', '/api/tower'),
    points: () => call<PointsData>('GET', '/api/points'),
    // note は前後の空白を切って、空なら送らない（#222）。minutes は省略可（#265・省略時はサーバーが量を決める）
    today: (minutes, note) => {
      const n = note?.trim();
      return call<TodayResult>('POST', '/api/today', {
        ...(minutes !== undefined && { minutes }),
        ...(n ? { note: n } : {}),
      });
    },
    weekly: () => call<WeeklyResult>('GET', '/api/weekly'),
    agentChat: (body) => call<AgentChatResult>('POST', '/api/agent/chat', body),

    addFriend: (code) => call<Friendship>('POST', '/api/friends', { code }),
    acceptFriend: (id) => call<Friendship>('POST', `/api/friends/${enc(id)}/accept`),
    friends: () => call<{ friends: FriendEntry[] }>('GET', '/api/friends'),
    feed: () => call<{ items: FeedItem[] }>('GET', '/api/feed'),

    pushKey: () => call<{ publicKey: string }>('GET', '/api/push/key'),
    pushSubscribe: (b) => call<void>('POST', '/api/push/subscribe', b),
    pushUnsubscribe: (endpoint) => call<void>('DELETE', '/api/push/subscribe', { endpoint }),
    registerDevice: (token) => call<void>('POST', '/api/push/device', { token, platform: 'android' } satisfies DeviceTokenBody),
    unregisterDevice: (token) => call<void>('DELETE', '/api/push/device', { token, platform: 'android' } satisfies DeviceTokenBody),
  };
}
