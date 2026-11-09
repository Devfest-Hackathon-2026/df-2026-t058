// カレンダーの書き出しファイル（.ics）を読んで、課題の候補にする文へ直す（純粋関数・端末の中だけで動く）。
// 取る物は SUMMARY（題）・DTSTART（開始）・DESCRIPTION（先頭 200 字）だけ。場所・参加者・電話・メールは読まない。
// 繰り返し（RRULE）は展開しない（最初の 1 回だけ）。壊れた予定は飛ばす。TZID は読むが、時刻はその文字のまま（端末の時刻として）扱う。

export type IcsEvent = { summary: string; start: Date; description: string };

export const ICS_WINDOW_DAYS = 60;
export const ICS_MAX_EVENTS = 50;
export const ICS_DESCRIPTION_CHARS = 200;

const unfold = (s: string): string => s.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '');

function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

// "NAME;PARAM=x:value" を名前と値に分ける（引用符の中の ":" は無視する）
function splitLine(line: string): { name: string; value: string } | null {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      const name = (line.slice(0, i).split(';')[0] ?? '').trim().toUpperCase();
      return name ? { name, value: line.slice(i + 1) } : null;
    }
  }
  return null;
}

// YYYYMMDD / YYYYMMDDTHHMMSS / YYYYMMDDTHHMMSSZ（Z は UTC → 端末の時刻へ）
function parseStart(v: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const s = Number(m[6] ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const date = m[7] ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(date.getTime())) return null;
  if (!m[7] && date.getDate() !== d) return null; // 2 月 30 日など
  return date;
}

export function parseIcs(ics: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: { summary?: string; start?: Date; description?: string } | null = null;
  let nested = 0; // VEVENT の中の VALARM などの入れ子
  for (const line of unfold(String(ics ?? '')).split('\n')) {
    const p = splitLine(line);
    if (!p) continue;
    const { name, value } = p;
    if (name === 'BEGIN') {
      const kind = value.trim().toUpperCase();
      if (kind === 'VEVENT') {
        cur = {}; // 閉じ忘れの予定は捨てる
        nested = 0;
      } else if (cur) nested++;
    } else if (name === 'END') {
      const kind = value.trim().toUpperCase();
      if (kind === 'VEVENT') {
        if (cur?.start && cur.summary) out.push({ summary: cur.summary, start: cur.start, description: cur.description ?? '' });
        cur = null;
      } else if (cur && nested > 0) nested--;
    } else if (cur && nested === 0) {
      if (name === 'SUMMARY') cur.summary = unescapeText(value).replace(/\s+/g, ' ').trim();
      else if (name === 'DTSTART' && !cur.start) cur.start = parseStart(value) ?? undefined; // 最初の 1 回だけ
      else if (name === 'DESCRIPTION') {
        cur.description = unescapeText(value).replace(/\s+/g, ' ').trim().slice(0, ICS_DESCRIPTION_CHARS);
      }
    }
  }
  return out;
}

// 今日 0 時から 60 日以内・開始の近い順・50 件まで
export function upcomingEvents(events: IcsEvent[], now: Date = new Date()): IcsEvent[] {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = from + (ICS_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000; // 60 日後の日の終わりまで含む
  return events
    .filter((e) => e.start.getTime() >= from && e.start.getTime() < to)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, ICS_MAX_EVENTS);
}

const two = (n: number): string => String(n).padStart(2, '0');

// 1 予定 1 行: 「YYYY-MM-DD HH:MM 題（詳細の先頭）」。allDay の時は時刻なし（Google カレンダーの終日の予定・#199 と共通）
export function eventLine(e: IcsEvent & { allDay?: boolean }): string {
  const d = e.start;
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const when = e.allDay ? day : `${day} ${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${when} ${e.summary}${e.description ? `（${e.description}）` : ''}`;
}

export function icsToText(events: IcsEvent[]): string {
  return events.map(eventLine).join('\n');
}

// ファイルの中身 → 入力欄に入れる文
export const icsFileToText = (ics: string, now: Date = new Date()): string => icsToText(upcomingEvents(parseIcs(ics), now));
