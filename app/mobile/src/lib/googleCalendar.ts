// Google カレンダーを読み取り専用で読む（Issue #199・Web だけ）。
// Google Identity Services（GIS）のトークン方式で許可を取り、ブラウザから直接 Calendar API を呼ぶ。
// サーバーには予定もトークンも送らない。トークンは呼び出しの中の変数だけに置き、保存しない。ログにも出さない。

import { eventLine, ICS_DESCRIPTION_CHARS, ICS_MAX_EVENTS, ICS_WINDOW_DAYS } from './ics';

// Web 専用。tsc がブラウザの型を持たない場合に備えて宣言する
declare const document: any;
declare const window: any;

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const GIS_SRC ='https://accounts.google.com/gsi/client';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export type CalendarErrorKind = 'closed' | 'popup_blocked' | 'api_disabled' | 'forbidden' | 'expired' | 'network' | 'unknown';

export class CalendarError extends Error {
  kind: CalendarErrorKind;
  constructor(kind: CalendarErrorKind) {
    super(kind); // 中身（トークン・予定）は入れない
    this.kind = kind;
  }
}

// ボタンを出すか: Web で、サーバーがクライアント ID を返した時だけ
export const showGoogleButton = (platform: string, clientId: string | null | undefined): boolean =>
  platform === 'web' && typeof clientId === 'string' && clientId.length > 0;

type TokenResponse = { access_token?: string; error?: string; scope?: string };
type GisError = { type?: string };
export type GoogleLike = {
  accounts: {
    oauth2: {
      initTokenClient(c: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: GisError) => void;
      }): { requestAccessToken(): void };
    };
    // Google でログイン（#213・lib/googleSignIn.ts）。同じスクリプトに入っている
    id?: {
      initialize(c: { client_id: string; callback: (r: { credential?: string }) => void }): void;
      renderButton(el: any, opts: Record<string, unknown>): void;
    };
  };
};

// GIS のスクリプトを、必要になった時だけ 1 回読み込む（カレンダーとログインで共通）
let gisLoading: Promise<GoogleLike> | null = null;
export function loadGis(doc: any = document, win: any = window): Promise<GoogleLike> {
  if (win?.google?.accounts) return Promise.resolve(win.google as GoogleLike);
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<GoogleLike>((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (win?.google?.accounts ? resolve(win.google as GoogleLike) : reject(new CalendarError('network')));
    s.onerror = () => reject(new CalendarError('network'));
    doc.head.appendChild(s);
  }).catch((e) => {
    gisLoading = null; // 次の押下で読み直せるように
    throw e;
  });
  return gisLoading;
}

// 許可の窓を出して、アクセストークンを 1 回取る（prompt は既定）。返した値は呼び出し側の変数だけに置く。
// scope は Classroom（#209）と共通に使うため差し替えられる（既定はカレンダーの読み取り）
export function requestToken(
  clientId: string,
  load: () => Promise<GoogleLike> = () => loadGis(),
  scope: string = CALENDAR_SCOPE,
): Promise<string> {
  return requestScopedToken(clientId, scope, load);
}

// 書く許可（#208）。読む許可とは別に、書く時に初めて求める（増分の同意）。トークンはメモリだけ
export function requestWriteToken(clientId: string, load: () => Promise<GoogleLike> = () => loadGis()): Promise<string> {
  return requestScopedToken(clientId, CALENDAR_WRITE_SCOPE, load);
}

async function requestScopedToken(clientId: string, scope: string, load: () => Promise<GoogleLike>): Promise<string> {
  const google = await load();
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (r) => {
        // 細かい同意で書く許可だけ外された時は、権限不足として扱う
        if (r?.access_token && typeof r.scope === 'string' && !r.scope.split(' ').includes(scope)) reject(new CalendarError('forbidden'));
        else if (r?.access_token) resolve(r.access_token);
        else reject(new CalendarError(r?.error === 'access_denied' ? 'closed' : 'unknown'));
      },
      error_callback: (e) => reject(new CalendarError(gisErrorKind(e))),
    });
    client.requestAccessToken();
  });
}

export function gisErrorKind(e: GisError | null | undefined): CalendarErrorKind {
  if (e?.type === 'popup_failed_to_open') return 'popup_blocked';
  if (e?.type === 'popup_closed') return 'closed';
  return 'unknown';
}

export function eventsUrl(now: Date): string {
  const timeMax = new Date(now.getTime() + ICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const q = [
    'singleEvents=true',
    'orderBy=startTime',
    `maxResults=${ICS_MAX_EVENTS}`,
    `timeMin=${encodeURIComponent(now.toISOString())}`,
    `timeMax=${encodeURIComponent(timeMax.toISOString())}`,
  ];
  return `${EVENTS_URL}?${q.join('&')}`;
}

// HTTP の失敗を分ける（403 は本文の理由で、API が無効か権限不足かを見分ける）
export function httpErrorKind(status: number, body: string): CalendarErrorKind {
  if (status === 401) return 'expired';
  if (status === 403) return /accessNotConfigured|SERVICE_DISABLED/.test(body) ? 'api_disabled' : 'forbidden';
  return 'unknown';
}

export type CalendarItem = {
  status?: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
};

export async function fetchEvents(
  token: string,
  now: Date,
  fetchImpl: (url: string, init: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = (u, i) => fetch(u, i),
): Promise<CalendarItem[]> {
  let res;
  try {
    res = await fetchImpl(eventsUrl(now), { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  } catch {
    throw new CalendarError('network');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new CalendarError(httpErrorKind(res.status, text));
  try {
    const items = (JSON.parse(text) as { items?: unknown }).items;
    return Array.isArray(items) ? (items as CalendarItem[]) : [];
  } catch {
    throw new CalendarError('unknown');
  }
}

const clean = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';

// 予定 → 入力欄の文（.ics と同じ形）。取るのは題・開始・詳細の先頭だけ（場所・参加者・メールは読まない）
export function eventsToText(items: CalendarItem[]): string {
  const lines: string[] = [];
  for (const it of items ?? []) {
    if (lines.length >= ICS_MAX_EVENTS) break;
    if (it?.status === 'cancelled') continue;
    const summary = clean(it?.summary);
    if (!summary) continue;
    const description = clean(it?.description).slice(0, ICS_DESCRIPTION_CHARS);
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(it?.start?.date ?? '');
    if (date) {
      const start = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
      lines.push(eventLine({ summary, start, description, allDay: true }));
      continue;
    }
    const start = new Date(it?.start?.dateTime ?? '');
    if (Number.isNaN(start.getTime())) continue;
    lines.push(eventLine({ summary, start, description }));
  }
  return lines.join('\n');
}

// ---- 書く向き（#208）: 今日の提案を予定として入れる ----

const HOUR = 60 * 60 * 1000;
const JST = 9 * HOUR; // Asia/Tokyo は夏時間なし

export type BusyRange = { start: number; end: number }; // ミリ秒

// 次の正時から、空いている枠を探す（予定が分かっていれば重ならない所・無ければ次の正時）。2 日先まで
export function nextFreeStart(now: Date, minutes: number, busy: BusyRange[] = []): Date {
  const first = Math.floor(now.getTime() / HOUR) * HOUR + HOUR;
  const len = Math.max(1, minutes) * 60 * 1000;
  for (let i = 0; i < 48; i++) {
    const s = first + i * HOUR;
    if (!busy.some((b) => b.start < s + len && s < b.end)) return new Date(s);
  }
  return new Date(first);
}

// 東京の時刻の文（例 2026-11-08T13:00:00+09:00）
export function tokyoIso(ms: number): string {
  return `${new Date(ms + JST).toISOString().slice(0, 19)}+09:00`;
}

export type EventBody = {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  source?: { title: string; url: string };
};

// 題＝取り組みの題・説明＝理由の 1 行・開始と終了は東京時間・「アプリで開く」は今の origin
export function buildEventBody(
  item: { title: string; reason: string },
  startIso: string,
  minutes: number,
  origin: string | undefined = typeof window !== 'undefined' ? window?.location?.origin : undefined,
): EventBody {
  const start = Date.parse(startIso);
  const body: EventBody = {
    summary: item.title.trim(),
    description: item.reason.replace(/\s+/g, ' ').trim(),
    start: { dateTime: tokyoIso(start), timeZone: 'Asia/Tokyo' },
    end: { dateTime: tokyoIso(start + Math.max(1, minutes) * 60 * 1000), timeZone: 'Asia/Tokyo' },
  };
  if (typeof origin === 'string' && /^https?:\/\//.test(origin)) body.source = { title: 'アプリで開く', url: origin };
  return body;
}

export async function insertEvent(
  token: string,
  body: EventBody,
  fetchImpl: (url: string, init: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = (u, i) => fetch(u, i),
): Promise<{ htmlLink: string | null }> {
  let res;
  try {
    res = await fetchImpl(EVENTS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CalendarError('network');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new CalendarError(httpErrorKind(res.status, text));
  try {
    const link = (JSON.parse(text) as { htmlLink?: unknown }).htmlLink;
    return { htmlLink: typeof link === 'string' && link.startsWith('https://') ? link : null };
  } catch {
    return { htmlLink: null };
  }
}

// ---- 目標の期限とステップ（#291）: 終日の予定を入れる・直す・消す ----
export type AllDayBody = { summary: string; description: string; start: { date: string }; end: { date: string } };
type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// POST＝入れる・PATCH＝直す・DELETE＝消す。相手の予定がもう無い（404・410）時は gone を返す
export async function writeEvent(
  token: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  eventId: string | null,
  body: AllDayBody | null,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<{ id: string | null; gone: boolean }> {
  const url = eventId ? `${EVENTS_URL}/${encodeURIComponent(eventId)}` : EVENTS_URL;
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetchImpl(url, body ? { method, headers, body: JSON.stringify(body) } : { method, headers });
  } catch {
    throw new CalendarError('network');
  }
  const text = await res.text().catch(() => '');
  if (eventId && (res.status === 404 || res.status === 410)) return { id: null, gone: true };
  if (!res.ok) throw new CalendarError(httpErrorKind(res.status, text));
  try {
    const id = (JSON.parse(text) as { id?: unknown }).id;
    return { id: typeof id === 'string' ? id : null, gone: false };
  } catch {
    return { id: null, gone: false };
  }
}

// 「入れた」印（提案の ID だけ。トークンや予定の文は置かない）。保存先は呼び出し側が渡す
export type MarkStore = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };
export const ADDED_KEY = 'calendarAdded.v1';
const ADDED_MAX = 200;
export const proposalMarkId = (p: { goalId: string; checkpointId: string }): string => `${p.goalId}:${p.checkpointId}`;

export async function addedMarks(store: MarkStore): Promise<string[]> {
  try {
    const v = JSON.parse((await store.getItem(ADDED_KEY)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function markAdded(store: MarkStore, id: string): Promise<string[]> {
  const cur = await addedMarks(store);
  const next = cur.includes(id) ? cur : [...cur, id].slice(-ADDED_MAX);
  try {
    await store.setItem(ADDED_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても、この画面の中では印を付ける
  }
  return next;
}

// 1 件入れる流れ。印があれば何もしない（二重登録の防止）。トークンはこの中の変数だけ
export async function addProposalToCalendar(
  p: { goalId: string; checkpointId: string; title: string; reason: string; minutes: number },
  deps: {
    clientId: string;
    store: MarkStore;
    now?: Date;
    busy?: BusyRange[];
    getToken?: (clientId: string) => Promise<string>;
    insert?: (token: string, body: EventBody) => Promise<{ htmlLink: string | null }>;
    origin?: string;
  },
): Promise<{ status: 'added' | 'already'; htmlLink: string | null }> {
  const id = proposalMarkId(p);
  if ((await addedMarks(deps.store)).includes(id)) return { status: 'already', htmlLink: null };
  const token = await (deps.getToken ?? requestWriteToken)(deps.clientId);
  const start = nextFreeStart(deps.now ?? new Date(), p.minutes, deps.busy ?? []);
  const body = 'origin' in deps ? buildEventBody(p, start.toISOString(), p.minutes, deps.origin) : buildEventBody(p, start.toISOString(), p.minutes);
  const { htmlLink } = await (deps.insert ?? ((t, b) => insertEvent(t, b)))(token, body);
  await markAdded(deps.store, id);
  return { status: 'added', htmlLink };
}

// 失敗の 1 行（押し直せば、もう一度試せる）。mode='write' は入れる時の言い方
export function calendarErrorText(e: unknown, mode: 'read' | 'write' = 'read'): string {
  const kind = e instanceof CalendarError ? e.kind : 'unknown';
  if (mode === 'write') {
    if (kind === 'api_disabled') return 'カレンダーに書く設定が、まだです。担当に伝えて、もう一度';
    if (kind === 'forbidden') return 'カレンダーに書く許可が足りません。もう一度押して、許可を';
    if (kind === 'unknown') return 'カレンダーに入れられませんでした。もう一度';
  }
  switch (kind) {
    case 'closed':
      return '許可されませんでした。もう一度押すと、やり直せます';
    case 'popup_blocked':
      return '許可の窓が開けませんでした。ポップアップを許してから、もう一度';
    case 'api_disabled':
      return 'カレンダーの読み込みが、まだ使えない設定です。担当に伝えて、もう一度';
    case 'forbidden':
      return 'カレンダーを読む許可が足りません。もう一度押して、許可してください';
    case 'expired':
      return '許可の期限が切れました。もう一度押してください';
    case 'network':
      return 'つながりませんでした。もう一度';
    default:
      return 'カレンダーを読めませんでした。もう一度';
  }
}
