// purpose 別の既定モデル（docs/model-selection.md の方針: 質が要る所＝上位、頻度が多い所＝軽い）。ここ 1 か所で変える。
//  roadmap／achievement: 呼ぶ回数が少なく、本人の方向と評価を左右する → gemini-4-argon（Pro 相当の最上位）
//  hint／research／stuck: 相談の中で何度も呼ぶ・待たせたくない → gemini-3.8-flash
// モデル ID は公式の各モデルのページで確認（2026-11-05）。料金は未確認＝$20 の予算は回数制限（limiter）で守る。
export const DEFAULT_GEMINI_MODELS = Object.freeze({
  roadmap: 'gemini-4-argon',
  achievement: 'gemini-4-argon',
  hint: 'gemini-3.8-flash',
  research: 'gemini-3.8-flash',
  stuck: 'gemini-3.8-flash',
  material: 'gemini-3.8-flash', // 写真の書き起こし（軽い方）
  voice: 'gemini-3.8-flash', // 声の書き起こし（軽い方・#210）
});

// purpose 別の時間切れ（ms）の選び方。roadmap（gemini-4-argon・成功に 10〜20 秒）だけ既定 60 秒。
// どれも Cloud Run の既定のリクエスト時間切れ（300 秒）より短い。
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_PURPOSE_TIMEOUT_MS = Object.freeze({ roadmap: 60000 });

function positiveInt(v) {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

// Gemini の 1 回の重さ（点・#225）。上限は回数でなく点で数える。数は仮（料金が未確認）＝使用量のログで単価を当てて直す。
//  gemini-4-argon の roadmap／achievement は重く、写真の書き起こし・声は中くらい、相談の中の軽い呼び出しは 1。
export const DEFAULT_GEMINI_WEIGHTS = Object.freeze({
  roadmap: 8,
  achievement: 8,
  material: 3,
  voice: 3,
  extract: 2,
  today: 1,
  hint: 1,
  research: 1,
  stuck: 1,
  weekly: 1,
});
// 写真や PDF が付く呼び出しは、その purpose の重みにこれを足す。
export const GEMINI_MEDIA_WEIGHT = 2;

// GEMINI_WEIGHTS（JSON・任意）: 例 {"roadmap":10}。既定に上書きする。読めない・未知の purpose・0 以上の整数でない時は既定に戻す。
export function parseWeights(v) {
  const t = v === undefined ? '' : String(v).trim();
  if (t === '') return DEFAULT_GEMINI_WEIGHTS;
  try {
    const j = JSON.parse(t);
    if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new Error('not object');
    for (const [k, n] of Object.entries(j)) {
      if (!Object.hasOwn(DEFAULT_GEMINI_WEIGHTS, k) || !Number.isInteger(n) || n < 0) throw new Error('bad entry');
    }
    return Object.freeze({ ...DEFAULT_GEMINI_WEIGHTS, ...j });
  } catch {
    console.warn('[config] GEMINI_WEIGHTS は使えない値なので既定の重みを使う');
    return DEFAULT_GEMINI_WEIGHTS;
  }
}

// 費用を守る数（点の上限・出力の上限）。空なら既定。数として読めない・負・小数の時も既定に戻す
// （Number('abc') の NaN をそのまま使うと、limiter の比較がいつも false になり、上限が無くなるため）。0 は「使わない」として受ける。
// 点の上限は、以前の 1 人 50 回・全体 500 回の 3 倍（軽い呼び出しだけなら前より多く、重い呼び出しは約 18 回で止まる）。
const DEFAULT_LIMIT_PER_USER_PER_DAY = 150;
const DEFAULT_LIMIT_TOTAL_PER_DAY = 1500;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
function budgetInt(name, v, fallback, { min = 0 } = {}) {
  const t = v === undefined ? '' : String(v).trim();
  if (t === '') return fallback; // 空白だけも空（Number(' ') は 0 になるため）
  const n = Number(t);
  if (Number.isInteger(n) && n >= min) return n;
  console.warn(`[config] ${name} は使えない値なので既定 ${fallback} を使う`);
  return fallback;
}

// config.geminiTimeoutMs は全体の既定、config.geminiTimeoutsMs は purpose 別の値。
export function timeoutFor(config, purpose) {
  return config?.geminiTimeoutsMs?.[purpose] ?? config?.geminiTimeoutMs ?? DEFAULT_TIMEOUT_MS;
}

// 環境変数の読み取り（値はコードに置かない。変数名は .env.example）。
export function loadConfig(env = process.env) {
  const store = (env.STORE || '').trim() || 'memory';
  if (store !== 'memory' && store !== 'firestore') {
    throw new Error('STORE は memory か firestore にしてください');
  }
  return {
    // memory: 1 台のメモリ（既定）／firestore: Firestore に保存（store/firestore.js・GCP_PROJECT_ID が要る）
    store,
    firestoreDatabase: (env.FIRESTORE_DATABASE || '').trim() || '(default)',
    port: Number(env.PORT || 8080),
    // fake: 偽の応答を返す（試験用）／real: Vertex AI（gemini/vertex.js）
    geminiMode: env.GEMINI_MODE || 'real',
    // fake: 'x-dev-user' ヘッダを本人の ID として受ける（開発・試験専用。本番では使わない）
    // invite: 招待コード＋名前で入る（auth/invite.js）。TEAM_CODE（8 文字以上）と SESSION_SECRET（32 文字以上）が要る。
    // 値はここにも試験にも本物の形で書かない（Secret Manager 等から環境変数で渡す）。前後の空白・改行は落とす。
    authMode: env.AUTH_MODE || 'real',
    teamCode: (env.TEAM_CODE || '').trim(),
    sessionSecret: (env.SESSION_SECRET || '').trim(),
    tokenTtlHours: env.TOKEN_TTL_HOURS || '', // 空なら 72
    // on の時だけ POST /api/demo/seed がある（デモ用の Cloud Run だけ。既定は無効）
    demoSeed: env.DEMO_SEED === 'on',
    // 端末への通知（Web Push・push/）。3 つ揃わない時は /api/push/* が 404。tick は TICK_SECRET も要る。
    vapidPublicKey: (env.VAPID_PUBLIC_KEY || '').trim(),
    vapidPrivateKey: (env.VAPID_PRIVATE_KEY || '').trim(),
    vapidSubject: (env.VAPID_SUBJECT || '').trim(),
    tickSecret: (env.TICK_SECRET || '').trim(),
    // スマホへの通知（FCM・push/devices.js・#298）。無い時は /api/push/device が 404 で、FCM へは何も送らない。
    fcmProjectId: (env.FCM_PROJECT_ID || '').trim(),
    // Google カレンダーの読み込み（画面の GIS 用）の OAuth クライアント ID。公開してよい値（秘密ではない）。無ければ null＝ボタンを出さない
    googleClientId: (env.GOOGLE_CLIENT_ID || '').trim() || null,

    // Gemini 呼び出しの点の制限（1 人 1 日・全体 1 日）。数は仮。$20(=¥3,165) を守る役。重みは geminiWeights。
    geminiWeights: parseWeights(env.GEMINI_WEIGHTS),
    geminiLimitPerUserPerDay: budgetInt(
      'GEMINI_LIMIT_PER_USER_PER_DAY',
      env.GEMINI_LIMIT_PER_USER_PER_DAY,
      DEFAULT_LIMIT_PER_USER_PER_DAY,
    ),
    geminiLimitTotalPerDay: budgetInt('GEMINI_LIMIT_TOTAL_PER_DAY', env.GEMINI_LIMIT_TOTAL_PER_DAY, DEFAULT_LIMIT_TOTAL_PER_DAY),
    // Vertex AI（real モード）。プロジェクト ID は環境変数からだけ（既定値を書かない）。
    gcpProjectId: env.GCP_PROJECT_ID || '',
    gcpRegion: env.GCP_REGION || 'global', // global＝世界共通の窓口（gemini-4-argon・3.8-flash とも対応と公式に記載）
    // 環境変数 GEMINI_MODEL を置くと全 purpose をそのモデルにする。空なら下の purpose 別の既定。
    geminiModel: env.GEMINI_MODEL || '',
    geminiModels: DEFAULT_GEMINI_MODELS,
    geminiTimeoutMs: Number(env.GEMINI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    geminiTimeoutsMs: {
      roadmap: positiveInt(env.GEMINI_TIMEOUT_ROADMAP_MS) ?? DEFAULT_PURPOSE_TIMEOUT_MS.roadmap,
    },
    // 考えるトークンも含む。費用の上限の役（1 以上）
    geminiMaxOutputTokens: budgetInt('GEMINI_MAX_OUTPUT_TOKENS', env.GEMINI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, {
      min: 1,
    }),
  };
}
