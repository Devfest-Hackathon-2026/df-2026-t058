import { HttpError } from '../http.js';
import { GEMINI_MEDIA_WEIGHT } from '../config.js';
import { sample, validate } from './schema.js';

export const PURPOSES = ['roadmap', 'hint', 'research', 'achievement', 'stuck', 'material', 'extract', 'today', 'weekly', 'voice', 'agent']; // 契約 §5.1（agent は §3.12・#307）

// Gemini の窓口（契約 §5.1）。各機能はここだけを使う。
//   generate({ purpose, input, schema, userId, grounding }) -> 検査済みの出力
//   grounding=true の時は Google 検索を付け、出力に sources: [{ title, url }] を足して返す（fake は空配列）。
// fake モード（GEMINI_MODE=fake）は schema に合う見本を返す。fakeResponses で目的別に差し替え可（試験用）。
// real モードは Vertex AI を呼ぶ（gemini/vertex.js・fetch だけ・依存なし）。
// 【input の約束】real モードの input は { system: string, user: string, images?: [{ mimeType, dataBase64 }] }。各機能はこの形で渡す。
//   images＝写真（jpeg/png/webp・検査済みの物だけ）。vertex.js が inlineData の部品として user の文の後ろに付ける。
//   system＝AI への指示（固定文。ユーザーが書いた文を混ぜない）／user＝本人が書いた文や記録（<user_text>…</user_text> で区切る）。
//   schema はプロンプトに書き写さない（responseSchema で渡る）。fake モードでも、system と user が文字列かは検査する（本物との食い違いを試験で見つけるため）。
// 失敗の写像（vertex.js）: Vertex の 429・503 は 1 回やり直し、続けば 503 upstream_busy（自前の点の上限＝429 rate_limited とは別・#226）。
//   同じモデルへの同時呼び出しは 4 本まで（待ちが 8 秒を超えたら 503 upstream_busy）。
//   その他の失敗・空・途中停止・JSON 不正・時間切れ→502 upstream_invalid（中身は返さない）。点は 1 回分だけ数える（やり直しでも数え直さない）。
// 1 回の重さ（点・#225）。weights が無い時は 1（回数として数える＝試験の既定）。
// 写真（input.images）や PDF（input.files）が付く時は mediaWeight を足す。
export function weightFor({ weights, mediaWeight = GEMINI_MEDIA_WEIGHT }, purpose, input) {
  if (!weights) return 1;
  const base = Number.isInteger(weights[purpose]) ? weights[purpose] : 1;
  const hasMedia = (Array.isArray(input?.images) && input.images.length > 0) || (Array.isArray(input?.files) && input.files.length > 0);
  return base + (hasMedia ? mediaWeight : 0);
}

const tokens = (n) => (Number.isFinite(n) ? n : null);

// 使用量の 1 行（Cloud Logging で集計する用）。ユーザー ID・入力・出力・写真・音声は入れない（項目はこの 9 つだけ）。
export function usageLine({ purpose, model, weight, usage, ms, ok }) {
  return JSON.stringify({
    evt: 'gemini_usage',
    purpose,
    model: model ?? null,
    weight,
    promptTokens: tokens(usage?.promptTokenCount),
    outputTokens: tokens(usage?.candidatesTokenCount),
    thoughtTokens: tokens(usage?.thoughtsTokenCount),
    ms,
    ok,
  });
}

export function createGemini({ mode, limiter, fakeResponses = {}, real, weights, log = (line) => console.log(line) }) {
  return {
    async generate({ purpose, input, schema, userId, grounding = false }) {
      if (!PURPOSES.includes(purpose)) throw new Error(`未知の purpose: ${purpose}`);
      const weight = weightFor({ weights }, purpose, input);
      if (limiter) limiter.take(userId, weight); // 点の制限（429）
      // 入力の形は fake でも本物と同じ検査をする（fake だけ通って、本物で初めて落ちる食い違いを試験で見つけるため）
      if (!input || typeof input.system !== 'string' || typeof input.user !== 'string') {
        throw new Error('input は { system: string, user: string } の形で渡してください');
      }
      let output;
      if (mode === 'fake') {
        output = purpose in fakeResponses ? await fakeResponses[purpose](input) : sample(schema);
        if (grounding) output = { ...output, sources: output.sources ?? [] };
        return checked(purpose, schema, output);
      }
      if (!real) throw new Error('Gemini の real モードは未実装です');
      // real({ purpose, input, schema, grounding }) -> { output, sources?, usage? }（gemini/vertex.js）
      const started = Date.now();
      let r = null;
      let ok = false;
      try {
        r = await real({ purpose, input, schema, grounding });
        output = grounding ? { ...r.output, sources: r.sources ?? [] } : r.output;
        const result = checked(purpose, schema, output);
        ok = true;
        return result;
      } finally {
        const model = r?.model ?? safeModel(real, purpose);
        log(usageLine({ purpose, model, weight, usage: r?.usage, ms: Date.now() - started, ok }));
      }
    },

    // ストリーミング（#235）。generate と同じ検査・点の数え方（1 回分）で、出力の文の断片ごとに onText(text) を呼ぶ。
    // 戻り値は generate と同じ検査済みの出力（全体）。grounding は使わない。fake は見本の JSON を小さく刻んで流す。
    async generateStream({ purpose, input, schema, userId, onText = () => {}, signal }) {
      if (!PURPOSES.includes(purpose)) throw new Error(`未知の purpose: ${purpose}`);
      const weight = weightFor({ weights }, purpose, input);
      if (limiter) limiter.take(userId, weight);
      if (!input || typeof input.system !== 'string' || typeof input.user !== 'string') {
        throw new Error('input は { system: string, user: string } の形で渡してください');
      }
      if (mode === 'fake') {
        const output = purpose in fakeResponses ? await fakeResponses[purpose](input) : sample(schema);
        const text = JSON.stringify(output);
        for (let i = 0; i < text.length && !signal?.aborted; i += FAKE_CHUNK) {
          onText(text.slice(i, i + FAKE_CHUNK));
          await new Promise((r) => setImmediate(r)); // 断片ごとに 1 回ずつ譲る（届く順を本物に近づける）
        }
        if (signal?.aborted) throw new HttpError(502, 'upstream_invalid', 'AI との接続に失敗しました');
        return checked(purpose, schema, output);
      }
      if (!real?.stream) throw new Error('Gemini の real モードのストリーミングは未実装です');
      const started = Date.now();
      let r = null;
      let ok = false;
      try {
        r = await real.stream({ purpose, input, schema, onText, signal });
        const result = checked(purpose, schema, r.output);
        ok = true;
        return result;
      } finally {
        const model = r?.model ?? safeModel(real, purpose);
        log(usageLine({ purpose, model, weight, usage: r?.usage, ms: Date.now() - started, ok }));
      }
    },
  };
}

const FAKE_CHUNK = 37; // fake の断片の長さ（JSON の区切りとずれるよう半端な数）

function safeModel(real, purpose) {
  try {
    return real.modelFor?.(purpose) ?? null;
  } catch {
    return null;
  }
}

function checked(purpose, schema, output) {
  const errors = validate(schema, output);
  if (errors.length > 0) {
    // 内容は返さない（契約 §2・502）。調べる用にサーバーのログへ出す。
    console.error('gemini output rejected:', purpose, errors);
    throw new HttpError(502, 'upstream_invalid', 'AI の出力が期待した形ではありません');
  }
  return output;
}
