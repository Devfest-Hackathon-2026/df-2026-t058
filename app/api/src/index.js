import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createInviteAuth } from './auth/invite.js';
import { createGoogleAuth } from './auth/google.js';
import { loadConfig } from './config.js';
import { features } from './features.js';
import { register as registerDemo } from './demo/routes.js';
import { demoFakeResponses } from './gemini/fake.js';
import { createGemini } from './gemini/index.js';
import { createVertexClient } from './gemini/vertex.js';
import { BODY_LIMIT, corsHeaders, HttpError, parseCorsOrigins, readJson, send, sendError } from './http.js';
import { register as importGoals } from './import/routes.js';
import { register as classifyTasks } from './import/classify.js';
import { createLimiter } from './limiter.js';
import { MATERIALS_BODY_LIMIT, register as materials } from './materials/routes.js';
import { register as push } from './push/routes.js';
import { createRouter } from './router.js';
import { createStaticHandler } from './static.js';
import { register as today } from './today/routes.js';
import { register as weekly } from './weekly/routes.js';
import { register as voice } from './voice/routes.js';
import { createFirestoreStore } from './store/firestore.js';
import { createMemoryStore } from './store/index.js';

// ctx（各機能へ渡す窓口）: { config, store, gemini, limiter }
export function createApp(overrides = {}) {
  const config = overrides.config || loadConfig();
  const env = overrides.env || process.env;
  // x-dev-user で誰にでもなれる AUTH_MODE=fake を、Cloud Run（K_SERVICE が付く）では起動させない。
  if (config.authMode === 'fake' && env.K_SERVICE) {
    throw new Error('AUTH_MODE=fake は Cloud Run では使えません');
  }
  const limiter =
    overrides.limiter ||
    createLimiter({ perUserPerDay: config.geminiLimitPerUserPerDay, totalPerDay: config.geminiLimitTotalPerDay });
  let store = overrides.store;
  if (!store && config.store === 'firestore') {
    if (!config.gcpProjectId) throw new Error('STORE=firestore には GCP_PROJECT_ID が要ります');
    store = createFirestoreStore({
      projectId: config.gcpProjectId,
      databaseId: config.firestoreDatabase,
      // 試験用: 偽の fetch と偽のトークン（実際の Firestore は呼ばない）
      ...(overrides.firestoreFetch && { fetchImpl: overrides.firestoreFetch, getToken: async () => 'test-token' }),
    });
  }
  store ||= createMemoryStore();
  const storeKind = overrides.store ? 'memory' : config.store === 'firestore' ? 'firestore' : 'memory';
  const gemini =
    overrides.gemini ||
    createGemini({
      mode: config.geminiMode,
      limiter,
      weights: config.geminiWeights, // 点で数える（#225）
      fakeResponses: overrides.fakeResponses,
      real: config.geminiMode === 'real' ? createVertexClient({ config }) : undefined,
    });
  // 招待コード方式（AUTH_MODE=invite）。TEAM_CODE・SESSION_SECRET が足りなければ、ここで例外になって起動しない。
  const invite =
    config.authMode === 'invite'
      ? createInviteAuth({
          teamCode: config.teamCode,
          sessionSecret: config.sessionSecret,
          ttlHours: config.tokenTtlHours,
          now: () => (overrides.now ? overrides.now() : new Date()),
          log: overrides.log,
        })
      : null;
  // Google でログイン（invite で GOOGLE_CLIENT_ID がある時だけ・契約 §3.0b）。トークンは invite と同じ SESSION_SECRET で署名。
  const google =
    invite && config.googleClientId
      ? createGoogleAuth({
          clientId: config.googleClientId,
          sessionSecret: config.sessionSecret,
          ttlHours: config.tokenTtlHours,
          now: () => (overrides.now ? overrides.now() : new Date()),
          fetchImpl: overrides.googleFetch,
          log: overrides.log,
        })
      : null;
  // pushFetch: 試験用の偽の fetch（push サービスを呼ばない）。
  const ctx = { config, store, gemini, limiter, now: overrides.now, invite, google, pushFetch: overrides.pushFetch };

  // 認証。invite は Authorization: Bearer を検証する（x-dev-user は無視）。fake の時だけ x-dev-user を受ける。
  // 本物（Firebase Auth）はまだ（real は常に未認証）。
  const authenticate =
    overrides.authenticate ||
    (async (req) => {
      if (invite) return invite.authenticate(req);
      return config.authMode === 'fake' ? req.headers['x-dev-user'] || null : null;
    });

  const router = createRouter();
  // auth は、画面が使う方式を知るため（invite の時だけ loginRequired も）。
  const healthBody = {
    ok: true,
    store: storeKind,
    auth: config.authMode === 'invite' || config.authMode === 'fake' ? config.authMode : 'real',
    ...(invite && { loginRequired: true }),
    ...(config.demoSeed && { demoSeed: true }),
  };
  router.add('GET', '/api/health', async () => ({ status: 200, body: healthBody }), { auth: false });
  // 画面が使う公開の設定（契約 §3.1b・認証不要）。クライアント ID は公開してよい値
  const configBody = { googleClientId: config.googleClientId ?? null };
  router.add('GET', '/api/config', async () => ({ status: 200, body: configBody }), { auth: false });
  // 写真が載る相談（POST /api/sessions/:id/tutor）にだけ本文の上限 6MB を付ける（tutor/ には触らず、ここで足す）。
  const featureRouter = {
    ...router,
    add(method, path, handler, opts = {}) {
      const photo = method === 'POST' && path === '/api/sessions/:id/tutor';
      router.add(method, path, handler, photo ? { bodyLimit: MATERIALS_BODY_LIMIT, ...opts } : opts);
    },
  };
  for (const register of overrides.features || [...features, materials, importGoals, classifyTasks, today, weekly, voice, push]) register(featureRouter, ctx);
  if (config.demoSeed) registerDemo(router, ctx);

  // CORS は開発用（CORS_ORIGINS・既定は空＝付けない）。config.corsOrigins があればそちらを使う（試験用）。
  const corsOrigins = parseCorsOrigins(config.corsOrigins ?? env.CORS_ORIGINS);

  // 画面の配信（STATIC_DIR があるときだけ。static.js）。
  const serveStatic = createStaticHandler(overrides.staticDir ?? env.STATIC_DIR);

  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      const preflight = req.method === 'OPTIONS' && corsOrigins.length > 0 && corsOrigins.includes(origin);
      // setHeader で先に置くと、エラーの応答（sendError）にも同じヘッダが付く。
      for (const [k, v] of Object.entries(corsHeaders(corsOrigins, origin, { preflight }))) res.setHeader(k, v);
      if (preflight) {
        res.writeHead(204);
        return res.end();
      }

      const { pathname } = new URL(req.url, 'http://localhost');
      if (serveStatic?.(req, res, pathname)) return;
      const hit = router.match(req.method, pathname);
      if (!hit) throw new HttpError(404, 'not_found', '見つかりません');
      let userId = null;
      if (hit.auth) {
        userId = await authenticate(req);
        if (!userId) throw new HttpError(401, 'unauthenticated', 'ログインが必要です');
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readJson(req, hit.bodyLimit ?? BODY_LIMIT);
      // res は流す経路（SSE・#235）だけが使う。流した経路は { streamed: true } を返し、ここでは何も送らない。
      const out = await hit.handler({ req, res, params: hit.params, userId, body, ctx });
      if (out?.streamed) return;
      if (out.status === 204) {
        res.writeHead(204); // 本文なし（/api/push/subscribe）
        res.end();
      } else send(res, out.status, out.body);
    } catch (err) {
      if (res.headersSent) {
        console.error('error after headers sent:', err?.name ?? 'Error');
        if (!res.writableEnded) res.end();
      } else sendError(res, err);
    }
  });
  return { server, ctx };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 手元で起動した時の GEMINI_MODE=fake は、画面の流れが通る見本の応答を使う（gemini/fake.js）。
  const geminiMode = loadConfig().geminiMode;
  const { server, ctx } = createApp(geminiMode === 'fake' ? { fakeResponses: demoFakeResponses } : {});
  server.listen(ctx.config.port, () => {
    console.log(`api listening on :${ctx.config.port}`);
    const c = ctx.config;
    console.log(c.store === 'firestore' ? `store=firestore database=${c.firestoreDatabase} project=${c.gcpProjectId}` : 'store=memory');
  });
}
