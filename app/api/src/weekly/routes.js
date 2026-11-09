import { C } from '../common/collections.js';
import { computeStreak, jstDayKey } from '../score/streak.js';
import { buildWeeklyInput, MAX_SUMMARY_CHARS, MAX_SUMMARY_LINES, STAT_KEYS, WEEKLY_SCHEMA } from './prompts.js';

// 週のまとめ（契約 §3.11・#202）。何も保存しない。数字はサーバーが計算し、文だけを Gemini が書く。
// Gemini が失敗（形の不正・時間切れ・回数の上限）しても、決まった文（source: rules）で 200 を返す。
export const WEEKLY_TIMEOUT_MS = 20_000;
export const FAKE_SUMMARY = '（見本）今週の記録から、やり方の変化をまとめました。\n次の一歩: 始める前に、確かめたいことを一行で書いてみる。';
const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3600_000;

// 今日（日本時間）を含む直近 7 日の始まり（日本時間 0:00）。
export function weekStart(now) {
  return new Date(Date.parse(`${jstDayKey(now)}T00:00:00Z`) - JST_OFFSET_MS - 6 * DAY_MS);
}

const inRange = (iso, from, to) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= from.getTime() && t < to.getTime();
};

// 本人の記録（sessions・events・floors）から、[from, to) の stats を計算する（純粋関数）。
// roadmaps（省略可）は、タスク（adopted: 'auto'・#261）の集中を「自分で決めた度」の平均から外すために使う。
export function computeStats({ sessions, events, floors, roadmaps = [] }, from, to) {
  const ended = sessions.filter((s) => s.endedAt && inRange(s.endedAt, from, to));
  const ids = new Set(ended.map((s) => s.id));
  const fs = floors.filter((f) => ids.has(f.sessionId));
  const count = (type) => events.filter((e) => e.type === type && inRange(e.at, from, to)).length;
  const autoGoals = new Set(roadmaps.filter((r) => r.adopted === 'auto').map((r) => r.goalId));
  const autoSessions = new Set(ended.filter((s) => autoGoals.has(s.goalId)).map((s) => s.id));
  const own = fs
    .filter((f) => !autoSessions.has(f.sessionId))
    .map((f) => f.ownScore)
    .filter((n) => typeof n === 'number');
  return {
    focusMinutes: Math.round(fs.reduce((sum, f) => sum + (f.focusMin || 0), 0)),
    sessions: ended.length,
    floorsAdded: fs.reduce((sum, f) => sum + (f.floors || 0), 0),
    // 連続日数は、その期間の終わりの時点で数える（score/streak.js）。
    streak: computeStreak(
      sessions.filter((s) => s.endedAt && Date.parse(s.endedAt) < to.getTime()).map((s) => s.endedAt),
      new Date(to.getTime() - 1),
    ),
    helpSmall: count('help_small'),
    helpMedium: count('help_medium'),
    selfDecided: own.length ? Math.round(own.reduce((a, b) => a + b, 0) / own.length) : null,
  };
}

// 決まった文（AI が使えない時）。量をほめず、やり方の変化だけに触れる。
export function rulesSummary(stats, previous) {
  const lines = [`この 7 日で ${stats.sessions} 回、合わせて ${stats.focusMinutes} 分 集中しました。`];
  if (previous && stats.selfDecided !== null && previous.selfDecided !== null && stats.selfDecided !== previous.selfDecided) {
    const dir = stats.selfDecided > previous.selfDecided ? '上がりました' : '下がりました';
    lines.push(`自分で決めた度は、前の週の ${previous.selfDecided} から ${stats.selfDecided} に${dir}。`);
  } else {
    lines.push(`AI に借りた手は、小 ${stats.helpSmall}・中 ${stats.helpMedium} でした。`);
  }
  lines.push('次の一歩: 始める前に、確かめたいことを一行で書いてみる。');
  return lines.join('\n');
}

// AI の文を検査する。行は 1〜3（4 行目以降は捨てる）・合計 240 字で切る・渡していない数を書いたら使わない（null）。
export function cleanSummary(out, stats, previous) {
  if (!out || !Array.isArray(out.lines)) return null;
  const lines = out.lines
    .filter((l) => typeof l === 'string')
    .map((l) => l.replace(/\s*[\r\n]+\s*/g, ' ').trim())
    .filter((l) => l !== '')
    .slice(0, MAX_SUMMARY_LINES);
  if (lines.length === 0) return null;
  const text = Array.from(lines.join('\n')).slice(0, MAX_SUMMARY_CHARS).join('');
  const allowed = new Set(['1', '2', '3', '7', '100']);
  for (const s of [stats, previous]) if (s) for (const k of STAT_KEYS) if (s[k] !== null) allowed.add(String(s[k]));
  const numbers = text.normalize('NFKC').match(/\d+/g) || [];
  if (numbers.some((n) => !allowed.has(String(Number(n))))) return null;
  return text;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function register(router, ctx) {
  router.add('GET', '/api/weekly', async ({ userId }) => {
    const now = ctx.now ? ctx.now() : new Date();
    const from = weekStart(now);
    const prevFrom = new Date(from.getTime() - 7 * DAY_MS);
    const [sessions, events, floors, roadmaps] = await Promise.all([
      ctx.store.list(C.sessions, { userId }),
      ctx.store.list(C.events, { userId }),
      ctx.store.list(C.floors, { userId }),
      ctx.store.list(C.roadmaps, { userId }),
    ]);
    const records = { sessions, events, floors, roadmaps };
    const stats = computeStats(records, from, new Date(now.getTime() + 1)); // いまの時刻ちょうどに終えた物も含める
    const base = { from: from.toISOString(), to: now.toISOString(), stats };
    if (stats.sessions === 0) return { status: 200, body: { ...base, summary: null, source: 'rules' } };
    const prev = computeStats(records, prevFrom, from);
    const previous = prev.sessions > 0 ? prev : null;
    const rules = { status: 200, body: { ...base, summary: rulesSummary(stats, previous), source: 'rules' } };

    let out;
    try {
      out = await withTimeout(
        ctx.gemini.generate({ purpose: 'weekly', input: buildWeeklyInput({ stats, previous }), schema: WEEKLY_SCHEMA, userId }),
        ctx.config.weeklyTimeoutMs ?? WEEKLY_TIMEOUT_MS,
      );
    } catch (err) {
      console.error('weekly: fallback to rules', err?.code || err?.message || 'error');
      return rules;
    }
    // fake は固定の文（デモと試験用）。回数の上限は上の generate で数える。
    if (ctx.config.geminiMode === 'fake') return { status: 200, body: { ...base, summary: FAKE_SUMMARY, source: 'ai' } };
    const summary = cleanSummary(out, stats, previous);
    if (!summary) {
      console.error('weekly: fallback to rules', 'invalid_summary');
      return rules;
    }
    return { status: 200, body: { ...base, summary, source: 'ai' } };
  });
}
