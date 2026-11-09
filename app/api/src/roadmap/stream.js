import { C } from '../common/collections.js';
import { nowIso } from '../common/time.js';
import { createArrayItemScanner, sseEvent } from '../gemini/jsonStream.js';
import { HttpError } from '../http.js';
import { publicAxes } from './axes.js';
import { toCandidates } from './candidates.js';
import { CANDIDATES_MAX } from './limits.js';
import { buildInput } from './prompts.js';
import { roadmapResponseSchema } from './schemas.js';

// POST /api/goals/:id/candidates/stream（契約 §3.3・#235）。
// axes → candidate（できた順に最大 3 回）→ done。失敗は error で閉じる。
// 保存は done の直前に 1 回だけ（途中で切れたら保存しない）。入力・出力の本文はログに出さない。
export async function streamCandidates({ res, ctx, goal, userId, note }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
  });
  const ctrl = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) ctrl.abort(); // 相手が切れた → 上流の読み取りも止める
  };
  res.on('close', onClose);
  const emit = (event, data) => {
    if (!ctrl.signal.aborted && !res.writableEnded) res.write(sseEvent(event, data));
  };

  const axes = publicAxes();
  emit('axes', { axes });
  const scanner = createArrayItemScanner({ key: 'candidates', max: CANDIDATES_MAX });
  const sent = []; // 送った案（サーバーが付けた ID ごと）
  const onText = (text) => {
    for (const raw of scanner.push(text)) {
      let c;
      try {
        [c] = toCandidates({ candidates: [raw] }); // 1 件ずつ同じ検査（外れたら送らない＝最後の検査で落ちる）
      } catch {
        continue;
      }
      sent.push(c);
      emit('candidate', c);
    }
  };

  try {
    const now = ctx.now ? ctx.now() : new Date();
    const output = await ctx.gemini.generateStream({
      purpose: 'roadmap',
      input: buildInput({ goal, now, note }),
      schema: roadmapResponseSchema(),
      userId,
      onText,
      signal: ctrl.signal,
    });
    const checked = toCandidates(output); // 全体の検査（個数など）。通らなければ 502 で保存しない
    if (ctrl.signal.aborted) return;
    // 送った案の ID をそのまま保存する（確定の candidateId と合うように）。送れていない分はここで送る。
    const candidates = checked.map((c, i) => {
      if (sent[i]) return sent[i];
      emit('candidate', c);
      return c;
    });
    await ctx.store.put(C.candidateSets, goal.id, { goalId: goal.id, userId, axes, candidates, createdAt: nowIso(ctx) });
    emit('done', { count: candidates.length });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('candidates stream failed:', err?.name ?? 'Error');
    const e = err instanceof HttpError ? err : { code: 'internal', message: 'サーバー側の失敗です' };
    emit('error', { code: e.code, message: e.message });
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}
