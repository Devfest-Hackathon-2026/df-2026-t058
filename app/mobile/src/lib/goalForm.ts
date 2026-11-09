// 目標を書く画面の、期限・時間・例文の部品。画面から切り出して試験する。

export const MINUTES_MIN = 5; // サーバーが受ける範囲（契約 §3.3）
export const MINUTES_MAX = 600;

// 1 日の時間の決め方。既定は「おまかせ」（AI が案を出す時に決める）。
export type MinutesMode = 'auto' | 'own';

export const EXAMPLES = [
  '来週の小テストまでに二次方程式を解けるようにする',
  '来月の期末レポートまでに、参考文献 5 本を読んで構成を決める',
  '3 か月後の資格試験までに、過去問を 3 周して合格点を取れるようにする',
];

// 入力欄の薄い例は「例: 」を付け、入力済みの文字と見分けがつくようにする。
export const withExamplePrefix = (s: string): string => `例: ${s}`;

// 既定の期限（日数）。「くわしく決める」をたたんでいる間はこれで送る。
export const DEFAULT_DAYS = 7;

// たたんだ「くわしく決める」の行の右に出す 1 行。期限・時間・資料のどれも既定のままなら null（何も出さない）。
export function detailsSummary(p: {
  days: number | null;
  deadline: Date | null;
  minMode: MinutesMode;
  minutes: number | null | undefined;
  hasMaterials: boolean;
  now?: Date;
}): string | null {
  const parts: string[] = [];
  const deadlineChanged = p.days !== DEFAULT_DAYS;
  if (deadlineChanged && p.deadline) parts.push(`期限 ${formatDeadline(p.deadline, p.now)}`);
  else if (deadlineChanged) parts.push('期限を決める'); // 日付が未入力・不正のまま閉じた時（「次へ」が押せない理由）
  if (p.minMode === 'own') parts.push(typeof p.minutes === 'number' ? `${p.minutes} 分` : '時間を決める');
  else if (deadlineChanged && p.deadline) parts.push('おまかせ');
  if (p.hasMaterials) parts.push('資料あり');
  return parts.length ? parts.join('・') : null;
}

export function pickExample(rand: () => number = Math.random): string {
  const i = Math.min(EXAMPLES.length - 1, Math.floor(rand() * EXAMPLES.length));
  return EXAMPLES[i] ?? EXAMPLES[0] ?? '';
}

const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x;
};

// 今日から days 日後の終わり（23:59）。
export function deadlineFromDays(days: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return endOfDay(d);
}

// 「2027-01-31」「2027/1/31」を日付にする。形が違う・存在しない日・今日以前は null。
export function parseDateInput(s: string, now: Date = new Date()): Date | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  const end = endOfDay(d);
  return end.getTime() > endOfDay(now).getTime() ? end : null;
}

// 年・月・日の 3 つの数字欄から日付を作る。入力が足りない・存在しない日・今日以前は reason に理由を返す。
// 何も入れていない間は reason なし（まだ入力中なので責めない）。
export type DateCheck = { date: Date | null; reason: string | null; bad: { y: boolean; m: boolean; d: boolean } };

export function checkDateParts(y: string, m: string, d: string, now: Date = new Date()): DateCheck {
  const none = { y: false, m: false, d: false };
  if (!y && !m && !d) return { date: null, reason: null, bad: none };
  if (!y || !m || !d) return { date: null, reason: null, bad: none };
  const [yy, mm, dd] = [Number(y), Number(m), Number(d)];
  if (y.length !== 4) return { date: null, reason: '年は 4 桁（例 2027）', bad: { ...none, y: true } };
  if (mm < 1 || mm > 12) return { date: null, reason: '月は 1〜12', bad: { ...none, m: true } };
  const lastDay = new Date(yy, mm, 0).getDate();
  if (dd < 1 || dd > lastDay) return { date: null, reason: `${mm} 月は 1〜${lastDay} 日`, bad: { ...none, d: true } };
  const date = parseDateInput(`${yy}-${mm}-${dd}`, now);
  if (!date) return { date: null, reason: '明日以降の日付にしてください', bad: { y: true, m: true, d: true } };
  return { date, reason: null, bad: none };
}

// 数字以外を捨てて、桁数で切る（年 4・月日 2）。
export function sanitizeDigits(s: string, max: number): string {
  return s.replace(/\D/g, '').slice(0, max);
}

// 年をまたぐ時だけ年を付ける。
export function formatDeadline(d: Date, now: Date = new Date()): string {
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

// 1 日の時間の入力（文字）を分にする。整数で 5〜600 以外は null。
export function parseMinutes(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= MINUTES_MIN && n <= MINUTES_MAX ? n : null;
}

// 送る 1 日の時間。おまかせは null。自分で決める時は札の分か入力の分（5〜600）。入力が不正なら undefined（送れない）。
export function minutesToSend(mode: MinutesMode, chipMin: number | null, minText: string): number | null | undefined {
  if (mode === 'auto') return null;
  if (chipMin !== null) return chipMin;
  return parseMinutes(minText) ?? undefined;
}

// 入力中に数字以外と 4 桁目以降を捨てる（範囲外は parseMinutes が止める）。
export function sanitizeMinutesInput(s: string): string {
  return s.replace(/\D/g, '').slice(0, 3);
}
