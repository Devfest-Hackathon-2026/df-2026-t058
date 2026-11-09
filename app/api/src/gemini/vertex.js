import { HttpError } from '../http.js';
import { timeoutFor } from '../config.js';
import { createSseParser } from './jsonStream.js';

// Vertex AI の generateContent を fetch だけで呼ぶ（依存パッケージなし）。
// 出典（2026-11-05 に確認）:
//   エンドポイント/認証: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart?usertype=adc
//   構造化出力:         https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output
//   Schema の型:        https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/Schema
//   検索の根拠づけ:      https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search
//   メタデータ認証:      https://docs.cloud.google.com/compute/docs/access/authenticate-workloads

const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const TOKEN_REFRESH_MARGIN_MS = 60_000; // 期限の 60 秒前に更新する
const TOKEN_TIMEOUT_MS = 5_000;

const PROJECT_RE = /^[a-z0-9][a-z0-9:.-]*$/;
const REGION_RE = /^[a-z][a-z0-9-]*$/;
const MODEL_RE = /^[a-z0-9][a-z0-9._-]*$/;

const upstreamInvalid = (message) => new HttpError(502, 'upstream_invalid', message);
// Vertex 側が混んでいる（429・503 がやり直しでも続いた・同時呼び出しの待ちが長すぎた）。自前の回数制限（429 rate_limited）と分ける（契約 §2・#226）。
export const UPSTREAM_BUSY_MESSAGE = 'AI が混み合っています。少し待ってもう一度お試しください';
const upstreamBusy = () => new HttpError(503, 'upstream_busy', UPSTREAM_BUSY_MESSAGE);

// ---- 混雑への備え（#226） ----------------------------------------------------
const RETRY_STATUSES = new Set([429, 503]); // やり直すのはこの 2 つだけ（400 系・購読・時間切れはやり直さない）
const RETRY_AFTER_MAX_MS = 3_000;
const RETRY_JITTER_MIN_MS = 800;
const RETRY_JITTER_SPAN_MS = 700; // 0.8〜1.5 秒
export const MAX_CONCURRENT_PER_MODEL = 4;
export const QUEUE_WAIT_MS = 8_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// やり直す前の待ち時間（ミリ秒）。Retry-After（秒 または HTTP の日付）があればそれ（最大 3 秒）、なければ 0.8〜1.5 秒のばらつき。
export function retryDelayMs(retryAfter, { random = Math.random, now = () => Date.now() } = {}) {
  if (typeof retryAfter === 'string' && retryAfter.trim() !== '') {
    const v = retryAfter.trim();
    let ms = NaN;
    if (/^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000;
    else if (Number.isFinite(Date.parse(v))) ms = Date.parse(v) - now();
    if (Number.isFinite(ms)) return Math.min(Math.max(ms, 0), RETRY_AFTER_MAX_MS);
  }
  return RETRY_JITTER_MIN_MS + Math.floor(random() * RETRY_JITTER_SPAN_MS);
}

function headerOf(res, name) {
  try {
    const v = res?.headers?.get?.(name);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

// モデルごとに、同時に走る呼び出しを max 本に絞る。超えた分は順に待たせ、waitMs を過ぎたら 503 upstream_busy。
// acquire(model) -> release()（release は何度呼んでも 1 回分だけ返す）。
export function createModelGate({ max = MAX_CONCURRENT_PER_MODEL, waitMs = QUEUE_WAIT_MS } = {}) {
  const gates = new Map(); // model -> { active, queue }
  function releaser(g) {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = g.queue.shift();
      if (next) next.grant(); // 枠をそのまま次へ渡す（active は変えない）
      else g.active -= 1;
    };
  }
  return {
    async acquire(model) {
      let g = gates.get(model);
      if (!g) {
        g = { active: 0, queue: [] };
        gates.set(model, g);
      }
      if (g.active < max) {
        g.active += 1;
        return releaser(g);
      }
      await new Promise((resolve, reject) => {
        const entry = {
          grant: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        const timer = setTimeout(() => {
          const i = g.queue.indexOf(entry);
          if (i >= 0) g.queue.splice(i, 1);
          reject(upstreamBusy());
        }, waitMs);
        g.queue.push(entry);
      });
      return releaser(g);
    },
    // 試験・調べる用（走っている本数と待っている数）
    stats(model) {
      const g = gates.get(model);
      return { active: g?.active ?? 0, waiting: g?.queue.length ?? 0 };
    },
  };
}

// ---- 認証 ----------------------------------------------------------------
// ローカル: 環境変数 GEMINI_ACCESS_TOKEN があればそれを使う。Cloud Run: メタデータサーバーから取り、期限まで使い回す。
// 値は例外・ログに出さない。
export function createTokenProvider({ fetchImpl = fetch, env = process.env, now = () => Date.now() } = {}) {
  let cached = null; // { token, refreshAt }
  let inflight = null;

  async function fetchFromMetadata() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TOKEN_TIMEOUT_MS);
    try {
      const res = await fetchImpl(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`metadata status ${res.status}`);
      const j = await res.json();
      if (typeof j?.access_token !== 'string' || j.access_token === '') throw new Error('metadata response has no token');
      const ttlMs = Number(j.expires_in) * 1000;
      const refreshAt = now() + (Number.isFinite(ttlMs) ? Math.max(ttlMs - TOKEN_REFRESH_MARGIN_MS, 0) : 0);
      cached = { token: j.access_token, refreshAt };
      return cached.token;
    } finally {
      clearTimeout(timer);
    }
  }

  return async function getToken() {
    const local = env.GEMINI_ACCESS_TOKEN;
    if (typeof local === 'string' && local !== '') return local;
    if (cached && now() < cached.refreshAt) return cached.token;
    inflight ??= fetchFromMetadata().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

// ---- JSON Schema -> Vertex の responseSchema ---------------------------------
// 本アプリの schema（type/properties/required/items/enum）を Vertex の Schema に直す。
// type は公式の列挙どおり大文字。enum は文字列のみ（公式の制約）。properties の順は propertyOrdering で固定する。
const TYPES = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
};

export function toVertexSchema(schema, path = '$') {
  if (schema === null || typeof schema !== 'object') throw new Error(`${path}: schema がオブジェクトではありません`);
  const out = {};
  if (schema.enum) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((v) => typeof v === 'string')) {
      throw new Error(`${path}: enum は空でない文字列の配列だけ使えます`);
    }
    out.type = 'STRING';
    out.enum = [...schema.enum];
    return out;
  }
  const type = TYPES[schema.type];
  if (!type) throw new Error(`${path}: 未対応の type: ${schema.type}`);
  out.type = type;
  if (schema.type === 'object') {
    const props = schema.properties || {};
    out.properties = Object.fromEntries(Object.entries(props).map(([k, s]) => [k, toVertexSchema(s, `${path}.${k}`)]));
    if (Object.keys(props).length > 0) out.propertyOrdering = Object.keys(props);
    if (schema.required?.length) out.required = [...schema.required];
  } else if (schema.type === 'array' && schema.items) {
    out.items = toVertexSchema(schema.items, `${path}[]`);
  }
  return out;
}

// ---- 応答の取り出し --------------------------------------------------------
function normalizeFinish(reason) {
  return typeof reason === 'string' ? reason.replace(/^FINISH_REASON_/, '') : '';
}

export function extractOutput(body) {
  const cand = body?.candidates?.[0];
  if (!cand) throw upstreamInvalid('AI から答えが返りませんでした');
  if (normalizeFinish(cand.finishReason) !== 'STOP') throw upstreamInvalid('AI の答えが途中で止まりました');
  const parts = Array.isArray(cand.content?.parts) ? cand.content.parts : [];
  // 思考の要約（thought: true）は出力に含めない。
  const text = parts
    .filter((p) => p && p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (text.trim() === '') throw upstreamInvalid('AI の答えが空でした');
  try {
    return JSON.parse(text);
  } catch {
    throw upstreamInvalid('AI の答えを読み取れませんでした');
  }
}

export function extractSources(body) {
  const chunks = body?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set();
  const sources = [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
    seen.add(uri);
    const title = typeof c.web.title === 'string' && c.web.title !== '' ? c.web.title : c.web.domain || uri;
    sources.push({ title, url: uri });
  }
  return sources;
}

// ---- 呼び出し --------------------------------------------------------------
// config.js の既定（DEFAULT_GEMINI_MODELS）に無い purpose の既定モデル。課題の取り込み（#139）は軽い方。
// #139 の触ってよい範囲が gemini/ までのため、ここに置く（config.js へ移すのは別 Issue）。
// 今日の提案（#183）も軽い方。
export const EXTRA_DEFAULT_MODELS = Object.freeze({ extract: 'gemini-3.8-flash', today: 'gemini-3.8-flash', weekly: 'gemini-3.8-flash', agent: 'gemini-3.8-flash' });

export function modelFor(config, purpose) {
  const model = config.geminiModel || config.geminiModels?.[purpose] || EXTRA_DEFAULT_MODELS[purpose];
  if (!model || !MODEL_RE.test(model)) throw new Error(`purpose ${purpose} のモデル名が設定されていません`);
  return model;
}

// stream=true は streamGenerateContent（SSE で断片が届く・#235）。参照（#235 の担当はこの場で開けていない・人が確かめる）:
//   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.publishers.models/streamGenerateContent
export function endpointFor(config, model, { stream = false } = {}) {
  const { gcpProjectId: project, gcpRegion: region } = config;
  if (!project || !PROJECT_RE.test(project)) throw new Error('GCP_PROJECT_ID が設定されていません');
  if (!region || !REGION_RE.test(region)) throw new Error('GCP_REGION が正しくありません');
  const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  return `https://${host}/v1/projects/${project}/locations/${region}/publishers/google/models/${model}:${method}`;
}

// streamGenerateContent の SSE を読み、思考でない文の断片ごとに onText(text) を呼ぶ。
// 全部読んだら generateContent と同じ形の本文（文はつないだ 1 つ・最後の finishReason・usageMetadata）を返す。
export async function readSseBody(res, onText = () => {}) {
  if (!res.body?.getReader) throw new Error('stream body がありません');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = createSseParser();
  let text = '';
  let finishReason;
  let usage;
  let grounding;
  const take = (events) => {
    for (const e of events) {
      const j = JSON.parse(e.data);
      const cand = j?.candidates?.[0];
      const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
      const t = parts.filter((p) => p && p.thought !== true && typeof p.text === 'string').map((p) => p.text).join('');
      if (cand?.finishReason) finishReason = cand.finishReason;
      if (cand?.groundingMetadata) grounding = cand.groundingMetadata;
      if (j?.usageMetadata) usage = j.usageMetadata;
      if (t !== '') {
        text += t;
        onText(t);
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    take(sse.push(decoder.decode(value, { stream: true })));
  }
  take(sse.push(decoder.decode() + '\n\n'));
  return {
    candidates: [{ finishReason, content: { parts: [{ text }] }, ...(grounding && { groundingMetadata: grounding }) }],
    ...(usage && { usageMetadata: usage }),
  };
}

// 写真（input.images = [{ mimeType, dataBase64 }]・検査は呼ぶ側の責任＝reflect/routes.js）を、
// 文字の部品の後ろに inlineData の部品として足す。形は公式の推論 API の文書（2026-11-06 に確認）:
//   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
//   parts[] = { inlineData: { mimeType, data } }（data は base64）
// 中身はログに出さない（下の log は枚数だけ）。
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export function imageParts(images) {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) throw new Error('input.images は配列で渡してください');
  return images.map((img, i) => {
    if (!IMAGE_MIME.has(img?.mimeType) || typeof img.dataBase64 !== 'string' || img.dataBase64 === '') {
      throw new Error(`input.images[${i}] の形が正しくありません`);
    }
    return { inlineData: { mimeType: img.mimeType, data: img.dataBase64 } };
  });
}

// 音声（input.audio = { mimeType, dataBase64 }・検査は呼ぶ側の責任＝reflect/routes.js・voice/routes.js）を、写真の後ろに inlineData の部品として足す。
// 形は写真と同じ parts[] = { inlineData: { mimeType, data } }。中身はログに出さない（下の log は数と長さだけ）。ogg は声の相談（#210）から。
const AUDIO_MIME = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']);
export function audioParts(audio) {
  if (audio === undefined || audio === null) return [];
  if (!AUDIO_MIME.has(audio?.mimeType) || typeof audio.dataBase64 !== 'string' || audio.dataBase64 === '') {
    throw new Error('input.audio の形が正しくありません');
  }
  return [{ inlineData: { mimeType: audio.mimeType, data: audio.dataBase64 } }];
}

// 文書（input.files = [{ mimeType: 'application/pdf', dataBase64 }]・検査は呼ぶ側の責任＝materials/routes.js・#201）を、
// 写真と同じ inlineData の部品として足す（Gemini は PDF をそのまま読む）。PDF だけ受ける。中身はログに出さない（下の log は件数だけ）。
export function fileParts(files) {
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files)) throw new Error('input.files は配列で渡してください');
  return files.map((f, i) => {
    if (f?.mimeType !== 'application/pdf' || typeof f.dataBase64 !== 'string' || f.dataBase64 === '') {
      throw new Error(`input.files[${i}] の形が正しくありません`);
    }
    return { inlineData: { mimeType: f.mimeType, data: f.dataBase64 } };
  });
}

// real({ purpose, input: { system, user, images?, files?, audio? }, schema, grounding }) -> { output, sources? }
export function createVertexClient({
  config,
  fetchImpl = fetch,
  getToken = createTokenProvider({ fetchImpl }),
  log = (line) => console.log(line),
  sleep = defaultSleep, // 試験では 0 ms の偽物を渡す
  random = Math.random,
  gate = createModelGate(),
}) {
  // stream=true の時は streamGenerateContent を呼び、文の断片ごとに onText を呼ぶ（#235）。
  // signal（呼ぶ側の取り消し・画面が離れた時）が来たら上流の読み取りも止める。
  async function call({ purpose, input, schema, grounding = false, stream = false, onText, signal }) {
    if (!input || typeof input.system !== 'string' || typeof input.user !== 'string') {
      throw new Error('input は { system: string, user: string } の形で渡してください');
    }
    const model = modelFor(config, purpose);
    const url = endpointFor(config, model, { stream });
    const images = imageParts(input.images);
    const audio = audioParts(input.audio);
    const docs = fileParts(input.files);
    const request = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.user }, ...images, ...docs, ...audio] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toVertexSchema(schema),
        maxOutputTokens: config.geminiMaxOutputTokens,
      },
      ...(grounding && { tools: [{ googleSearch: {} }] }),
    };

    const started = Date.now();
    let status = 'error';
    let retried = false;
    let ok = false;
    let release = null;
    let timer = null;
    let onAbort = null;
    try {
      // 同じモデルへの同時呼び出しを絞る（待ちすぎたら 503 upstream_busy）。時間切れの計測は枠を取ってから始める。
      try {
        release = await gate.acquire(model);
      } catch (err) {
        status = 'queue_timeout';
        throw err;
      }
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), timeoutFor(config, purpose));
      if (signal) {
        onAbort = () => ctrl.abort();
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      let token;
      try {
        token = await getToken();
      } catch {
        status = 'auth_failed';
        throw upstreamInvalid('AI との接続に失敗しました');
      }
      let res;
      // 429・503 だけ 1 回やり直す（自前の点は gemini/index.js で 1 回分だけ数え済み）。
      for (let attempt = 0; ; attempt += 1) {
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(request),
            signal: ctrl.signal,
          });
        } catch (err) {
          status = signal?.aborted ? 'cancelled' : err?.name === 'AbortError' ? 'timeout' : 'network_error';
          throw upstreamInvalid(status === 'timeout' ? 'AI の答えが時間内に返りませんでした' : 'AI との接続に失敗しました');
        }
        status = String(res.status);
        if (!RETRY_STATUSES.has(res.status)) break;
        if (attempt >= 1) throw upstreamBusy();
        retried = true;
        await sleep(retryDelayMs(headerOf(res, 'retry-after'), { random }));
      }
      if (!res.ok) throw upstreamInvalid('AI が応答できませんでした');
      let body;
      try {
        body = stream ? await readSseBody(res, onText) : await res.json();
      } catch (err) {
        if (err instanceof HttpError) throw err; // onText の中で起きた失敗はそのまま
        status = signal?.aborted ? 'cancelled' : err?.name === 'AbortError' ? 'timeout' : 'bad_body';
        throw upstreamInvalid(status === 'timeout' ? 'AI の答えが時間内に返りませんでした' : 'AI の答えを読み取れませんでした');
      }
      let output;
      try {
        output = extractOutput(body);
      } catch (err) {
        status = 'invalid_output';
        throw err;
      }
      // usage＝Vertex の usageMetadata（トークン数だけ・gemini/index.js が使用量のログに使う）
      const usage = body && typeof body.usageMetadata === 'object' ? body.usageMetadata : null;
      const result = { output, model, usage };
      if (grounding) result.sources = extractSources(body);
      ok = true;
      return result;
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
      release?.();
      // 出すのは purpose・所要時間・状態・写真の枚数・音声の数と長さ（base64 の文字数）だけ（プロンプトも出力も写真・音声の中身も出さない）。
      const n = images.length;
      const a = audio.length > 0 ? ` audio=1 audioChars=${audio[0].inlineData.data.length}` : '';
      log(`gemini purpose=${purpose} model=${model}${stream ? ' stream=1' : ''} status=${status} ms=${Date.now() - started}${n > 0 ? ` images=${n}` : ''}${docs.length > 0 ? ` files=${docs.length}` : ''}${a}`);
      // 上流の失敗の種類（失敗した時・やり直した時だけ）。項目はこの 5 つだけ（本文・入力・ユーザー ID は出さない）。
      if (!ok || retried) {
        log(JSON.stringify({ evt: 'gemini_upstream', purpose, model, status, retried, ms: Date.now() - started }));
      }
    }
  }
  const real = ({ purpose, input, schema, grounding }) => call({ purpose, input, schema, grounding });
  // ストリーミング（#235）: real.stream({ purpose, input, schema, onText, signal }) -> real と同じ { output, model, usage }
  real.stream = ({ purpose, input, schema, onText, signal }) => call({ purpose, input, schema, stream: true, onText, signal });
  // 失敗した時の使用量のログにモデル名を載せるため（gemini/index.js）
  real.modelFor = (purpose) => modelFor(config, purpose);
  return real;
}
