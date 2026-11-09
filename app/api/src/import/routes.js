import { body as bodyObj, str } from '../common/validate.js';
import { HttpError } from '../http.js';
import { parseImages } from '../reflect/routes.js';
import { buildExtractInput, cleanCandidates, EXTRACT_SCHEMA } from './prompts.js';

// 課題の取り込み（契約 §3.3・Issue #139）。貼った文と写真から、課題の候補を返すだけ。何も保存しない（store に書かない）。
// 読み取った課題の文はログに出さない。
export const EXTRACT_BODY_LIMIT = 6_000_000; // 写真が載るため（materials・reflect と同じ）
export const MAX_INPUT_TEXT = 6000;

export function register(router, ctx) {
  const { gemini } = ctx;

  router.add(
    'POST',
    '/api/goals/extract',
    async ({ userId, body }) => {
      bodyObj(body);
      const text = str(body.text, 'text', { min: 0, max: MAX_INPUT_TEXT, optional: true }) ?? '';
      const images = parseImages(body.images); // 形式・大きさ・先頭のバイトの検査は振り返りと同じ（0〜3 枚）
      if (text === '' && images.length === 0) {
        throw new HttpError(400, 'invalid_argument', 'text か images のどちらかが必要です');
      }
      const now = ctx.now ? ctx.now() : new Date();
      const out = await gemini.generate({
        purpose: 'extract',
        input: buildExtractInput({ text, images, now }),
        schema: EXTRACT_SCHEMA,
        userId,
      });
      return { status: 200, body: { candidates: cleanCandidates(out) } };
    },
    { bodyLimit: EXTRACT_BODY_LIMIT },
  );
}
