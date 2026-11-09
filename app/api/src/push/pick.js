import { jstDayKey } from '../score/streak.js';

// 「いつ誰に送るか」（純粋な関数・契約 §3.7c）。本文は固定で、AI の文や課題の中身は入れない。
export const PUSH_PAYLOAD = Object.freeze({ title: '今日の取り組み', body: '今日の取り組み、5 分だけ始めませんか', url: '/' });
export const MAX_PER_DAY = 1; // 11/9: その日に 1 回だけ（本人）
export const QUIET_FROM_HOUR = 21; // 日本時間 21:00 から
export const QUIET_UNTIL_HOUR = 7; // 翌 7:00 まで送らない

const jstHour = (now) => new Date(now.getTime() + 9 * 3600_000).getUTCHours();
// 送らない時間帯か（FCM の友達の通知も同じ時間帯を使う・#298）。
export const isQuietHour = (now) => jstHour(now) >= QUIET_FROM_HOUR || jstHour(now) < QUIET_UNTIL_HOUR;

// sessions: その人の集中。sent: その人の { day, count }（無ければ null）。返り値: 送るなら null、送らないなら理由の文字。
// 11/9 から焦りの強さは全員 strong（nudgeLevel を見ない）。今日すでに始めていれば送らない。
export function skipReason({ sessions = [], sent = null, now }) {
  if (isQuietHour(now)) return 'quiet_hours';
  const today = jstDayKey(now);
  const startedToday = (s) => Number.isFinite(Date.parse(s.startedAt)) && jstDayKey(s.startedAt) === today;
  if (sessions.some(startedToday)) return 'done_today';
  if (sent?.day === today && sent.count >= MAX_PER_DAY) return 'daily_limit';
  return null;
}

// 今日（日本時間）いちばん最近に集中を始めた友達（{ startedAt, friendId } の並びから）。いなければ null
export function latestStarterToday(starts, now) {
  const today = jstDayKey(now);
  const hits = starts.filter((x) => Number.isFinite(Date.parse(x.startedAt)) && jstDayKey(x.startedAt) === today);
  hits.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return hits[0]?.friendId ?? null;
}
