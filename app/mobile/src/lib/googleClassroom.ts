// Google Classroom の課題を読み取り専用で読む（Issue #209・Web だけ）。
// #199 と同じ GIS のトークン方式で許可を取り、ブラウザから直接 Classroom API を呼ぶ。
// サーバーには課題もトークンも送らない。トークンは呼び出しの中の変数だけに置き、保存しない。ログにも出さない。
// 読む物は クラス名・課題の題・期限・説明の先頭だけ（教員名・メール・添付ファイルの名前は読まない）。

import { CalendarError, loadGis, requestToken, type GoogleLike } from './googleCalendar';

export const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
].join(' ');
const API = 'https://classroom.googleapis.com/v1';
export const MAX_COURSES = 6;
export const MAX_WORKS = 40;
const DESCRIPTION_CHARS = 200;

export type ClassroomErrorKind = 'closed' | 'popup_blocked' | 'api_disabled' | 'forbidden' | 'empty' | 'expired' | 'network' | 'unknown';

export class ClassroomError extends Error {
  kind: ClassroomErrorKind;
  constructor(kind: ClassroomErrorKind) {
    super(kind); // 中身（トークン・課題）は入れない
    this.kind = kind;
  }
}

export async function requestClassroomToken(clientId: string, load: () => Promise<GoogleLike> = () => loadGis()): Promise<string> {
  try {
    return await requestToken(clientId, load, CLASSROOM_SCOPES);
  } catch (e) {
    throw new ClassroomError(e instanceof CalendarError ? e.kind : 'unknown');
  }
}

export type Course = { id?: string; name?: string };
export type CourseWork = {
  id?: string;
  courseId?: string;
  title?: string;
  description?: string;
  state?: string;
  dueDate?: { year?: number; month?: number; day?: number };
  dueTime?: { hours?: number; minutes?: number };
};
export type Submission = { courseWorkId?: string; state?: string };

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: FetchLike = (u, i) => fetch(u, i);

export const coursesUrl = (): string => `${API}/courses?courseStates=ACTIVE&studentId=me`;
export const courseWorkUrl = (courseId: string): string =>
  `${API}/courses/${encodeURIComponent(courseId)}/courseWork?orderBy=dueDate%20asc&pageSize=30`;
export const submissionsUrl = (courseId: string): string =>
  `${API}/courses/${encodeURIComponent(courseId)}/courseWork/-/studentSubmissions?userId=me`;

// HTTP の失敗を分ける。403 は本文で、API 無効／学校が Classroom を許していない／権限不足を見分ける
export function classroomHttpErrorKind(status: number, body: string): ClassroomErrorKind {
  if (status === 401) return 'expired';
  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/.test(body)) return 'api_disabled';
    if (/ClassroomApiDisabled|not permitted/i.test(body)) return 'empty';
    return 'forbidden';
  }
  return 'unknown';
}

async function getList<T>(url: string, key: string, token: string, fetchImpl: FetchLike): Promise<T[]> {
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  } catch {
    throw new ClassroomError('network');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ClassroomError(classroomHttpErrorKind(res.status, text));
  try {
    const list = (JSON.parse(text) as Record<string, unknown>)[key];
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    throw new ClassroomError('unknown');
  }
}

export const fetchCourses = (token: string, fetchImpl: FetchLike = defaultFetch) =>
  getList<Course>(coursesUrl(), 'courses', token, fetchImpl);
export const fetchCourseWork = (token: string, courseId: string, fetchImpl: FetchLike = defaultFetch) =>
  getList<CourseWork>(courseWorkUrl(courseId), 'courseWork', token, fetchImpl);
export const fetchSubmissions = (token: string, courseId: string, fetchImpl: FetchLike = defaultFetch) =>
  getList<Submission>(submissionsUrl(courseId), 'studentSubmissions', token, fetchImpl);

// まとめて読む: コースは 6 つまで・課題は全部で 40 件まで。コースが 0 件なら「読める課題がない」
export async function readClassroom(
  token: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<{ courses: Course[]; works: CourseWork[]; subs: Submission[] }> {
  const courses = (await fetchCourses(token, fetchImpl)).filter((c) => typeof c?.id === 'string').slice(0, MAX_COURSES);
  if (courses.length === 0) throw new ClassroomError('empty');
  const works: CourseWork[] = [];
  const subs: Submission[] = [];
  for (const c of courses) {
    if (works.length >= MAX_WORKS) break;
    const id = c.id ?? '';
    const w = await fetchCourseWork(token, id, fetchImpl);
    works.push(...w.slice(0, MAX_WORKS - works.length).map((x) => ({ ...x, courseId: x.courseId ?? id })));
    subs.push(...(await fetchSubmissions(token, id, fetchImpl)));
  }
  return { courses, works, subs };
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const two = (n: number): string => String(n).padStart(2, '0');
const DONE = new Set(['TURNED_IN', 'RETURNED']);

// 期限: dueDate/dueTime は UTC。時刻があれば端末の時刻へ直す。時刻なしは日付だけ（その日の終わりまで有効）
function due(w: CourseWork): { at: Date; withTime: boolean } | null {
  const d = w.dueDate;
  if (!d?.year || !d.month || !d.day) return null;
  if (w.dueTime) {
    const at = new Date(Date.UTC(d.year, d.month - 1, d.day, w.dueTime.hours ?? 0, w.dueTime.minutes ?? 0));
    return { at, withTime: true };
  }
  return { at: new Date(d.year, d.month - 1, d.day, 23, 59), withTime: false };
}

// 未提出で、期限が今日以降（期限なしも）の課題を 1 課題 1 行にする（40 件まで）
export function classroomToText(courses: Course[], works: CourseWork[], subs: Submission[], now: Date = new Date()): string {
  const names = new Map<string, string>();
  for (const c of courses ?? []) if (c?.id) names.set(c.id, clean(c.name));
  const done = new Set<string>();
  for (const s of subs ?? []) if (s?.courseWorkId && DONE.has(s.state ?? '')) done.add(s.courseWorkId);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const lines: string[] = [];
  for (const w of works ?? []) {
    if (lines.length >= MAX_WORKS) break;
    const title = clean(w?.title);
    if (!title || (w.id && done.has(w.id)) || (w.state && w.state !== 'PUBLISHED')) continue;
    const when = due(w);
    if (when && when.at.getTime() < today) continue;
    const a = when?.at;
    const day = a ? `${a.getFullYear()}-${two(a.getMonth() + 1)}-${two(a.getDate())}` : '';
    const stamp = a ? (when?.withTime ? `${day} ${two(a.getHours())}:${two(a.getMinutes())} ` : `${day} `) : '';
    const course = names.get(w.courseId ?? '') ?? '';
    const desc = clean(w.description).slice(0, DESCRIPTION_CHARS);
    lines.push(`${stamp}${course ? `${course}: ` : ''}${title}${desc ? `（${desc}）` : ''}`);
  }
  return lines.join('\n');
}

// 失敗の 1 行（押し直せば、もう一度試せる）
export function classroomErrorText(e: unknown): string {
  const kind = e instanceof ClassroomError ? e.kind : 'unknown';
  switch (kind) {
    case 'closed':
      return '許可されませんでした。もう一度押すと、やり直せます';
    case 'popup_blocked':
      return '許可の窓が開けませんでした。ポップアップを許してから、もう一度';
    case 'api_disabled':
      return 'Classroom の読み込みが、まだ使えない設定です。担当に伝えて、もう一度';
    case 'forbidden':
      return 'Classroom を読む許可が足りません。もう一度押して、許可してください';
    case 'empty':
      return '読める課題がありません。別のアカウントなら、もう一度';
    case 'expired':
      return '許可の期限が切れました。もう一度押してください';
    case 'network':
      return 'つながりませんでした。もう一度';
    default:
      return 'Classroom を読めませんでした。もう一度';
  }
}
