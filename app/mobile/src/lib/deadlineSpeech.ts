// 話した文から期限を読み取る（足す場面・#315）。サーバーは呼ばない（画面の中だけ・何も送らない）。
// 読めるのは「明日」「3 日後」「2 週間」「1 か月」「来週の金曜」「金曜」「11/20」「11 月 20 日」程度。
// 読めない時は null（画面は期限の札を出して選んでもらう）。期限はその日の 23:59。

import { deadlineFromDays } from './goalForm';

// 足す画面の期限の札（読み取れない時・直したい時）
export const DEADLINE_CHIPS = [
  { label: '3 日', days: 3 },
  { label: '1 週間', days: 7 },
  { label: '2 週間', days: 14 },
  { label: '1 か月', days: 30 },
  { label: '2 か月', days: 60 },
  { label: '3 か月', days: 90 },
];
// 「決めました」を読める間を置いてから、道を決める場面へ移る（控えめな場面転換）
export const ADD_TO_PLAN_MS = 900;

export type HeardDeadline = { date: Date; phrase: string };

const WEEK = '日月火水木金土';

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x;
}

function addDays(now: Date, n: number): Date {
  return deadlineFromDays(n, now);
}

// 今日より後の M/D（今年が過ぎていれば来年）。存在しない日は null
function monthDay(now: Date, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
    const x = new Date(y, m - 1, d);
    if (x.getMonth() !== m - 1) return null;
    const end = endOfDay(x);
    if (end.getTime() > now.getTime()) return end;
  }
  return null;
}

export function heardDeadline(said: string, now: Date = new Date()): HeardDeadline | null {
  const t = (said ?? '').normalize('NFKC');
  let m: RegExpMatchArray | null;

  if ((m = t.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/))) {
    const date = monthDay(now, Number(m[1]), Number(m[2]));
    return date ? { date, phrase: m[0] } : null;
  }
  if ((m = t.match(/(来週|再来週|今週)\s*の?\s*([日月火水木金土])\s*曜\s*日?/))) {
    const want = WEEK.indexOf(m[2]!);
    const today = now.getDay();
    // 週は月曜はじまり（日曜は週の最後）
    const idx = (w: number) => (w + 6) % 7;
    const weeks = m[1] === '今週' ? 0 : m[1] === '来週' ? 1 : 2;
    const diff = weeks * 7 + idx(want) - idx(today);
    if (diff <= 0) return null;
    return { date: addDays(now, diff), phrase: m[0] };
  }
  if ((m = t.match(/([日月火水木金土])\s*曜\s*日?/))) {
    const diff = (WEEK.indexOf(m[1]!) - now.getDay() + 7) % 7 || 7;
    return { date: addDays(now, diff), phrase: m[0] };
  }
  if ((m = t.match(/(\d{1,3})\s*日\s*(後|ご|で|以内|間)/))) {
    const n = Number(m[1]);
    return n >= 1 && n <= 365 ? { date: addDays(now, n), phrase: m[0] } : null;
  }
  if ((m = t.match(/(\d{1,2})\s*週間/))) {
    const n = Number(m[1]);
    return n >= 1 && n <= 52 ? { date: addDays(now, n * 7), phrase: m[0] } : null;
  }
  if ((m = t.match(/(\d{1,2})\s*[かヶカケヵ]\s*月/))) {
    const n = Number(m[1]);
    return n >= 1 && n <= 12 ? { date: addDays(now, n * 30), phrase: m[0] } : null;
  }
  if ((m = t.match(/明後日|あさって/))) return { date: addDays(now, 2), phrase: m[0] };
  if ((m = t.match(/明日|あした/))) return { date: addDays(now, 1), phrase: m[0] };
  if ((m = t.match(/今日中|今日まで/))) return { date: endOfDay(now), phrase: m[0] };
  return null;
}

// 期限だけを言い直した文か（「期限は来週の金曜で」など）。目標の文を置き換えない時に使う
export function onlyDeadline(said: string, heard: HeardDeadline | null): boolean {
  if (!heard) return false;
  const rest = said
    .normalize('NFKC')
    .replace(heard.phrase, '')
    .replace(/期限|締め?切り?|〆切?|試験|提出|日付|は|を|に|で|まで|して|する|にする|ください|です|ね|よ|[、。!?\s]/g, '');
  return rest.length <= 2;
}

// 話した文から期限の言い回しを抜いて、目標の文にする（「試験は来週の金曜」の「試験は…まで」ごと抜く）
export function goalFromSaid(said: string, heard: HeardDeadline | null): string {
  let t = (said ?? '').normalize('NFKC').trim();
  if (heard) {
    const esc = heard.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`(試験|期限|締め?切り?|〆切?|提出|本番)?\\s*(は|が)?\\s*${esc}\\s*(までに|まで|に|で)?`), '');
  }
  return t.replace(/^[、。,.\s]+|[、。,.\s]+$/g, '').replace(/[、。]{2,}/g, '。');
}
