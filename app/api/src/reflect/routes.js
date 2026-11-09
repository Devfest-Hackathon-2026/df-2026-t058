import { C } from '../common/collections.js';
import { loadOwned } from '../common/owned.js';
import { nowIso } from '../common/time.js';
import { body as bodyObj, bool, num, oneOf, str } from '../common/validate.js';
import { HttpError } from '../http.js';
import { recomputeFloor } from '../score/floor.js';
import { withLock as withUserLock } from '../session/lock.js';
import { exclusive } from './lock.js';
import {
  ACHIEVEMENT_SCHEMA,
  STUCK_CAUSES,
  STUCK_SCHEMA,
  buildAchievementInput,
  buildStuckInput,
  checkpointStateFor,
  parseAchievement,
  parseNextSteps,
} from './prompts.js';
import { goalMaterials } from '../roadmap/goalDocs.js';

// I-8: ふりかえりと達成度の判定（契約の変更点 §3・11/5）。
// 達成度は Gemini が写真・メモ・資料から理由つきで判定する（Own the Why）。判定しきれない時・AI が失敗した時は本人が選ぶ（confirm）。
// 判定は集中（session）ごとに持ち、チェックポイントには最後に振り返った集中の値を写す。
// 写真と資料は判定に使うだけで、どこにも保存しない（残すのは結果と理由だけ）。次の一歩は候補を返すだけ（P8）。
const conflict = (m) => new HttpError(409, 'conflict', m);
const bad = (field, why) => new HttpError(400, 'invalid_argument', `${field}: ${why}`);
const invalid = (purpose, why) => {
  console.error('reflect: AI の出力を採用できません:', purpose, why); // 出力の中身・写真は出さない
  return new HttpError(502, 'upstream_invalid', 'AI の出力が期待した形ではありません');
};

// 振り返り（POST /api/sessions/:id/reflect）の経路だけ本文の上限を 6,000,000 バイトにする（写真が載るため）。
// confirm を含む他の経路は既定の 64KB（confirm の本文は { achievement } だけ）。
export const REFLECT_BODY_LIMIT = 6_000_000;
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 1_500_000; // 1 枚あたり（base64 を戻した後のバイト数）
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// base64 の文字列から、戻した後のバイト数を測る（全体を戻さずに長さだけで出す）。
export function base64Bytes(s) {
  if (s.length % 4 !== 0 || !BASE64_RE.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

// 先頭のバイトが申告した形式と合うか（中身が画像でない物を Gemini に渡さない）。
function magicMatches(mimeType, head) {
  if (mimeType === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mimeType === 'image/png') {
    return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/webp') {
    return head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  }
  return false;
}

// 声の振り返り（契約 §3.8・11/7）。1 つだけ・最大 20 秒（長さは画面側で止める。サーバーは大きさで抑える）。
export const MAX_AUDIO_BYTES = 1_500_000; // base64 を戻した後のバイト数
export const AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

// 音声の先頭のバイトが申告した形式と合うか（webm=EBML・mp4=ftyp・mpeg=ID3 か同期語・wav=RIFF…WAVE）。
function audioMagicMatches(mimeType, head) {
  if (mimeType === 'audio/webm') {
    return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  }
  if (mimeType === 'audio/mp4') return head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp';
  if (mimeType === 'audio/mpeg') {
    if (head.length >= 3 && head.toString('latin1', 0, 3) === 'ID3') return true;
    return head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  }
  if (mimeType === 'audio/wav') {
    return head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE';
  }
  return false;
}

// 無い・null は「音声なし」（null を返す）。形式・大きさ・型が違えば 400。
export function parseAudio(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('audio', 'object が必要です');
  const mimeType = oneOf(v.mimeType, 'audio.mimeType', AUDIO_TYPES);
  if (typeof v.dataBase64 !== 'string' || v.dataBase64 === '') throw bad('audio.dataBase64', 'string が必要です');
  const bytes = base64Bytes(v.dataBase64);
  if (bytes === null) throw bad('audio.dataBase64', 'base64 として読めません');
  if (bytes > MAX_AUDIO_BYTES) throw bad('audio.dataBase64', `${MAX_AUDIO_BYTES} バイトまでにしてください`);
  if (!audioMagicMatches(mimeType, Buffer.from(v.dataBase64.slice(0, 16), 'base64'))) {
    throw bad('audio', 'mimeType と中身の形式が合いません');
  }
  return { mimeType, dataBase64: v.dataBase64 };
}

// 判定の材料（メモ・資料・写真・音声）が 1 つでもあるか。音声だけでも材料がある。
export const hasMaterial = (input) =>
  input.note.trim() !== '' || input.materials.trim() !== '' || input.images.length > 0 || input.audio !== null;

export function parseImages(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad('images', 'array が必要です');
  if (v.length > MAX_IMAGES) throw bad('images', `${MAX_IMAGES} 枚までにしてください`);
  return v.map((img, i) => {
    const f = `images[${i}]`;
    if (img === null || typeof img !== 'object' || Array.isArray(img)) throw bad(f, 'object が必要です');
    const mimeType = oneOf(img.mimeType, `${f}.mimeType`, IMAGE_TYPES);
    if (typeof img.dataBase64 !== 'string' || img.dataBase64 === '') throw bad(`${f}.dataBase64`, 'string が必要です');
    const bytes = base64Bytes(img.dataBase64);
    if (bytes === null) throw bad(`${f}.dataBase64`, 'base64 として読めません');
    if (bytes > MAX_IMAGE_BYTES) throw bad(`${f}.dataBase64`, `1 枚 ${MAX_IMAGE_BYTES} バイトまでにしてください`);
    if (!magicMatches(mimeType, Buffer.from(img.dataBase64.slice(0, 16), 'base64'))) {
      throw bad(f, 'mimeType と中身の形式が合いません');
    }
    return { mimeType, dataBase64: img.dataBase64 };
  });
}

// 入力の検査。stuck は任意（無い・null は「無し」）。images・materials は無ければ空。selfReport は受けない（無視）。
function parseInput(b) {
  bodyObj(b);
  const input = {
    note: str(b.note, 'note', { min: 0, max: 1000 }),
    done: bool(b.done, 'done'), // スマホは常に false。完了は最終の判定（3）で決めるので、判定には使わない
    images: parseImages(b.images),
    audio: parseAudio(b.audio),
    materials: str(b.materials, 'materials', { min: 0, max: 2000, optional: true }) ?? '',
    stuck: null,
  };
  if (b.stuck !== undefined && b.stuck !== null) {
    bodyObj(b.stuck);
    input.stuck = {
      cause: oneOf(b.stuck.cause, 'stuck.cause', STUCK_CAUSES),
      note: str(b.stuck.note, 'stuck.note', { min: 0, max: 500, optional: true }) ?? '',
    };
  }
  return input;
}

// 相談の度合いの件数（events の種類の数だけ。会話の中身は読まない・P10）。
async function usageCounts(store, sessionId) {
  const events = await store.list(C.events, { sessionId });
  const n = (type) => events.filter((e) => e.type === type).length;
  return { helpSmall: n('help_small'), helpMedium: n('help_medium'), research: n('research') };
}

async function findCheckpoint(store, session, userId) {
  const goal = await store.get(C.goals, session.goalId);
  const roadmap = goal && goal.userId === userId ? await store.get(C.roadmaps, session.goalId) : null;
  return roadmap?.checkpoints?.find((c) => c.id === session.checkpointId) ?? null;
}

// 同じチェックポイントで振り返り済みの集中のうち、最後に振り返った物（無ければ null）。
// 並びは reflectedAt、同じ時刻なら endedAt の遅い方（時計が止まった試験でも決まるように）。
async function latestReflected(store, session) {
  const mine = await store.list(C.sessions, { userId: session.userId });
  const same = mine.filter((s) => s.goalId === session.goalId && s.checkpointId === session.checkpointId && s.reflectedAt);
  same.sort((a, b) => a.reflectedAt.localeCompare(b.reflectedAt) || (a.endedAt ?? '').localeCompare(b.endedAt ?? ''));
  return same.at(-1) ?? null;
}

// チェックポイントの達成度・状態を、そのチェックポイントで最後に振り返った集中から決め直す（ユーザー単位の順序の中で呼ぶ）。
// 判定そのものは集中（session）ごとに持つ。チェックポイントの値は「いまの状態」を見せるための写し。
async function syncCheckpoint(store, session) {
  const latest = await latestReflected(store, session);
  const roadmap = await store.get(C.roadmaps, session.goalId);
  if (!latest || !roadmap) return;
  const achievement = latest.achievement ?? null;
  await store.put(C.roadmaps, session.goalId, {
    ...roadmap,
    checkpoints: roadmap.checkpoints.map((c) =>
      c.id === session.checkpointId
        ? {
            ...c,
            achievement,
            aiAchievement: latest.aiAchievement ?? null,
            achievementReason: latest.achievementReason ?? '',
            state: checkpointStateFor(achievement),
          }
        : c,
    ),
  });
}

// 振り返り済みの集中の結果（契約の reflect の応答と同じ形）。2 回目の POST はこれを返す（Gemini は呼ばない）。
const savedResult = (session, floor) => ({
  judgeable: session.judgeable === true,
  aiAchievement: session.aiAchievement ?? null,
  achievement: session.achievement ?? null,
  reason: session.achievementReason ?? '',
  nextSteps: Array.isArray(session.nextSteps) ? session.nextSteps : [],
  floor,
});

// AI が判定できなかった時（回数の上限・形の不正・時間切れ）。本人が confirm で選ぶ（owner-choices §6）。
export const AI_UNAVAILABLE_REASON = 'いまは AI が判定できませんでした。どこまでできたか、自分で選んでください。';
export const NO_MATERIAL_REASON = 'メモ・写真・資料・音声のどれも無いので、AI は判定していません。どこまでできたか、自分で選んでください。';
const isAiFailure =(err) => err instanceof HttpError && (err.status === 429 || err.status === 502);

export function register(router, ctx) {
  const { store, gemini } = ctx;

  // 達成度の判定。失敗（429・502）は捨てずに「判定できない」として返す（呼ぶ側が本人に選ばせる）。
  async function judge(input, checkpoint, session, counts, userId) {
    // 材料が何も無ければ AI を呼ばない（回数も使わない）。本人が confirm で選ぶ。
    if (!hasMaterial(input)) return { judgeable: false, achievement: null, reason: NO_MATERIAL_REASON, aiUnavailable: false };
    try {
      const goal = await store.get(C.goals, session.goalId);
      const goalDocs = goal && goal.userId === userId ? goalMaterials(goal) : '';
      const raw = await gemini.generate({
        purpose: 'achievement',
        input: buildAchievementInput({ checkpoint, ...input, focusMin: session.focusMin ?? 0, counts, goalDocs }),
        schema: ACHIEVEMENT_SCHEMA,
        userId,
      });
      const judged = parseAchievement(raw);
      if (judged) return { ...judged, aiUnavailable: false };
      invalid('achievement', 'judgeable・範囲・理由のどれかが不正'); // ログだけ出す
    } catch (err) {
      if (!isAiFailure(err)) throw err;
      console.error('reflect: 判定を AI から得られませんでした:', err.status); // 中身は出さない
    }
    return { judgeable: false, achievement: null, reason: AI_UNAVAILABLE_REASON, aiUnavailable: true };
  }

  // 次の一歩の候補。失敗（429・502・形の不正）は空にする（判定の結果は捨てない）。
  async function nextStepsFor(stuck, checkpoint, userId) {
    try {
      const raw = await gemini.generate({
        purpose: 'stuck',
        input: buildStuckInput({ checkpoint, ...stuck }),
        schema: STUCK_SCHEMA,
        userId,
      });
      const steps = parseNextSteps(raw);
      if (steps) return steps;
      invalid('stuck', '候補が 2〜3 個の文字列ではない');
    } catch (err) {
      if (!isAiFailure(err)) throw err;
      console.error('reflect: 次の一歩を AI から得られませんでした:', err.status);
    }
    return [];
  }

  // この経路だけ本文の上限を 6MB にする（写真が載るため・契約 §3.8）。confirm を含む他の経路は既定の 64KB。
  router.add(
    'POST',
    '/api/sessions/:id/reflect',
    async ({ params, userId, body }) => {
      await loadOwned(store, C.sessions, params.id, userId); // 他人の物・無い物は 404
      const input = parseInput(body);

      return exclusive(`reflect:${params.id}`, async () => {
        const session = await loadOwned(store, C.sessions, params.id, userId);
        if (!session.endedAt) throw conflict('まだ集中が終わっていません');

        // 2 回目（応答を受け取り損ねた・同時に 2 本など）は、保存した結果を返す。Gemini は呼ばない。
        // 写しの直し（チェックポイント・階）はやり直す（前回の途中で失敗していても直る・何度やっても同じ結果）。
        if (session.reflectedAt) {
          const floor = await withUserLock(userId, async () => {
            await syncCheckpoint(store, session);
            return recomputeFloor(ctx, session.id);
          });
          return { status: 200, body: savedResult(session, floor) };
        }

        const checkpoint = await findCheckpoint(store, session, userId);
        const counts = await usageCounts(store, session.id);
        const judged = await judge(input, checkpoint, session, counts, userId);
        const nextSteps = input.stuck ? await nextStepsFor(input.stuck, checkpoint, userId) : [];

        // 反映。集中の開始・終了と同じユーザー単位の順序で、ロードマップの読み書きを割り込ませない。
        // 保存するのは判定の結果と理由・次の一歩の候補・本人のメモだけ（写真・資料・音声は保存しない）。
        const floor = await withUserLock(userId, async () => {
          const saved = await store.put(C.sessions, session.id, {
            ...session,
            reflectedAt: nowIso(ctx),
            judgeable: judged.judgeable,
            aiAchievement: judged.achievement,
            achievement: judged.achievement, // 最終の判定（confirm で本人が決め直す）
            achievementReason: judged.reason,
            ...(judged.aiUnavailable && { aiUnavailable: true }),
            nextSteps,
            note: input.note,
            ...(input.stuck && {
              stuckCause: input.stuck.note ? `${input.stuck.cause}: ${input.stuck.note}` : input.stuck.cause,
            }),
          });
          await syncCheckpoint(store, saved);
          return recomputeFloor(ctx, session.id);
        });

        return {
          status: 200,
          body: {
            judgeable: judged.judgeable,
            aiAchievement: judged.achievement,
            achievement: judged.achievement,
            reason: judged.reason,
            nextSteps,
            floor,
          },
        };
      });
    },
    { bodyLimit: REFLECT_BODY_LIMIT },
  );

  // 本人が達成度を選ぶ（判定しきれなかった時）・決め直す（判定できた時も）。AI の判定は aiAchievement に残す。
  // 本文は { achievement } だけなので、上限は既定の 64KB。
  // 決め直せるのは、そのチェックポイントで最後に振り返った集中だけ（前の集中を直してチェックポイントの状態が戻るのを防ぐ・409）。
  router.add('POST', '/api/sessions/:id/reflect/confirm', async ({ params, userId, body: b }) => {
    await loadOwned(store, C.sessions, params.id, userId); // 他人の物・無い物は 404
    bodyObj(b);
    const achievement = num(b.achievement, 'achievement', { min: 0, max: 3, int: true });

    return exclusive(`reflect:${params.id}`, async () => {
      const session = await loadOwned(store, C.sessions, params.id, userId);
      if (!session.reflectedAt) throw conflict('先にふりかえりをしてください');

      const floor = await withUserLock(userId, async () => {
        const latest = await latestReflected(store, session);
        if (latest?.id !== session.id) throw conflict('このチェックポイントの、より新しい集中で決め直してください');
        const saved = await store.put(C.sessions, session.id, { ...session, achievement, confirmedAt: nowIso(ctx) });
        await syncCheckpoint(store, saved);
        return recomputeFloor(ctx, session.id);
      });

      return { status: 200, body: { achievement, aiAchievement: session.aiAchievement ?? null, floor } };
    });
  });
}
