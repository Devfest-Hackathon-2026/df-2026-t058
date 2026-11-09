// Google カレンダーの「予定を作る」URL を組み立てる。OAuth もサーバーも使わない。
// 外へ出すのは題と完了の目印だけ（個人の文は渡さない）。

const TITLE_MAX = 200;
const DETAILS_MAX = 500;

function cut(s: string, max: number): string {
  const chars = Array.from(s); // サロゲートペアを割らない
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

function utc(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** いまから最も近い 5 分刻みの時刻。 */
export function nearestFiveMinutes(now: Date): Date {
  const step = 5 * 60 * 1000;
  return new Date(Math.round(now.getTime() / step) * step);
}

export function calendarUrl(input: { title: string; startAt: Date; minutes: number; details?: string }): string {
  const end = new Date(input.startAt.getTime() + input.minutes * 60 * 1000);
  const parts = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(cut(input.title, TITLE_MAX))}`,
    `dates=${utc(input.startAt)}/${utc(end)}`,
  ];
  if (input.details) parts.push(`details=${encodeURIComponent(cut(input.details, DETAILS_MAX))}`);
  return `https://calendar.google.com/calendar/render?${parts.join('&')}`;
}
