// 連続記録（純粋関数）。終了した集中がある日（Asia/Tokyo の暦日）が、今日（または昨日）から何日続くか。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function jstDayKey(dateOrIso) {
  const t = typeof dateOrIso === 'string' ? Date.parse(dateOrIso) : dateOrIso.getTime();
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}

const shiftDay = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// endedAts: 終了時刻（ISO）の配列。now: Date。
// 今日に 1 回も終えていなくても、昨日まで続いていれば切れていない（今日これから終える余地がある）。
export function computeStreak(endedAts, now) {
  const days = new Set(endedAts.filter(Boolean).map(jstDayKey));
  const today = jstDayKey(now);
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n += 1;
    cursor = shiftDay(cursor, -1);
  }
  return n;
}
