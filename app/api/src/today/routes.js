import { body as bodyObj } from '../common/validate.js';
import { HttpError } from '../http.js';
import {
  aiProposals,
  EMPTY_GREETING,
  loadCandidates,
  MAX_GREETING_CHARS,
  MAX_NOTE_CHARS,
  MINUTES_CHOICES,
  oneLine,
  preferByNote,
  readMinutes,
  result,
  RULES_GREETING,
  rulesProposals,
} from './pick.js';
import { buildTodayInput, TODAY_SCHEMA } from './prompts.js';

// 今日の提案（契約 §3.10・#183）。何も保存しない。Gemini が失敗してもルールの提案で 200 を返す（502・429 にしない）。
// 目標の文・チェックポイント名はログに出さない。
export const TODAY_TIMEOUT_MS = 20_000;
export const FAKE_GREETING = '（見本）今日の時間に合わせて、道の次の一歩を選びました。';

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 本人の今日の希望（省略可・0〜200 字）。前後の空白を落として空なら無い扱い（''）。中身はエラー文にもログにも出さない。
export function readNote(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_argument', 'note: string が必要です');
  const t = v.trim();
  if (Array.from(t).length > MAX_NOTE_CHARS) throw new HttpError(400, 'invalid_argument', `note: ${MAX_NOTE_CHARS} 文字までにしてください`);
  return oneLine(t, MAX_NOTE_CHARS);
}

export function register(router, ctx) {
  router.add('POST', '/api/today', async ({ userId, body }) => {
    bodyObj(body);
    // minutes は省略可（#265）。省略時は目安の 60 分で、期限の近い順・見積りから量を決める
    const m = readMinutes(body.minutes);
    if (!m) {
      throw new HttpError(400, 'invalid_argument', `minutes: ${MINUTES_CHOICES.join('|')} のどれか（省略可）`);
    }
    const { minutes, given } = m;
    const note = readNote(body.note);
    const now = ctx.now ? ctx.now() : new Date();
    const candidates = await loadCandidates(ctx.store, userId, now);
    if (candidates.length === 0) {
      return { status: 200, body: result({ greeting: EMPTY_GREETING, minutes, proposals: [], source: 'rules' }) };
    }
    // ルールの提案でも、希望に合う候補を先頭に寄せる（#222）
    const rules = () =>
      result({ greeting: RULES_GREETING, minutes, proposals: rulesProposals(preferByNote(candidates, note), minutes), source: 'rules' });

    let out;
    try {
      out = await withTimeout(
        ctx.gemini.generate({ purpose: 'today', input: buildTodayInput({ candidates, minutes, note, target: !given }), schema: TODAY_SCHEMA, userId }),
        ctx.config.todayTimeoutMs ?? TODAY_TIMEOUT_MS,
      );
    } catch (err) {
      console.error('today: fallback to rules', err?.code || err?.message || 'error');
      return { status: 200, body: rules() };
    }
    // fake は、ルールの提案に source: ai と固定のあいさつ（デモと試験用）。回数の上限は上の generate で数える。
    if (ctx.config.geminiMode === 'fake') {
      return { status: 200, body: { ...rules(), greeting: FAKE_GREETING, source: 'ai' } };
    }
    const proposals = aiProposals(out, candidates, minutes);
    if (!proposals) {
      console.error('today: fallback to rules', 'no_valid_picks');
      return { status: 200, body: rules() };
    }
    const greeting = oneLine(out.greeting, MAX_GREETING_CHARS);
    return { status: 200, body: result({ greeting, minutes, proposals, source: 'ai' }) };
  });
}
