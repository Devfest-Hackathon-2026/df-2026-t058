// Google Classroom の課題の読み込み（Issue #209）。ネットワークに出ない（GIS と fetch を差し替える）。課題はすべて作り物。
declare const require: (name: string) => any;
declare const __dirname: string;

import type { GoogleLike } from '../lib/googleCalendar';
import {
  CLASSROOM_SCOPES,
  ClassroomError,
  classroomErrorText,
  classroomHttpErrorKind,
  classroomToText,
  fetchCourses,
  fetchCourseWork,
  fetchSubmissions,
  MAX_COURSES,
  MAX_WORKS,
  readClassroom,
  requestClassroomToken,
  type CourseWork,
} from '../lib/googleClassroom';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ダミーの値は本物の形にしない（実行時に組み立てる）
const dummyToken = (): string => ['test', 'tok', String(Date.now())].join('_');
const dummyClient = (): string => ['test', 'client'].join('-');
const NOW = new Date(2026, 10, 8, 12, 0, 0);
const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

describe('URL と Authorization', () => {
  test('3 つの読み取りの URL・GET・Bearer', async () => {
    const token = dummyToken();
    const calls: { url: string; init: any }[] = [];
    const fake = async (url: string, init: any) => {
      calls.push({ url, init });
      return ok({});
    };
    await fetchCourses(token, fake);
    await fetchCourseWork(token, 'c1', fake);
    await fetchSubmissions(token, 'c1', fake);
    expect(calls.map((c) => c.url)).toEqual([
      'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&studentId=me',
      'https://classroom.googleapis.com/v1/courses/c1/courseWork?orderBy=dueDate%20asc&pageSize=30',
      'https://classroom.googleapis.com/v1/courses/c1/courseWork/-/studentSubmissions?userId=me',
    ]);
    for (const c of calls) {
      expect(c.init.method).toBe('GET');
      expect(c.init.headers.authorization).toBe(`Bearer ${token}`);
    }
  });
});

describe('classroomToText', () => {
  const courses = [{ id: 'c1', name: '数学' }];
  test('出した課題・期限切れ・下書きを外す・期限なしは日付なし・説明は 200 字', () => {
    const works: CourseWork[] = [
      { id: 'w1', courseId: 'c1', title: '問題集 3', dueDate: { year: 2026, month: 11, day: 20 }, description: 'あ'.repeat(300) },
      { id: 'w2', courseId: 'c1', title: '出した', dueDate: { year: 2026, month: 11, day: 21 } },
      { id: 'w3', courseId: 'c1', title: '返された', dueDate: { year: 2026, month: 11, day: 21 } },
      { id: 'w4', courseId: 'c1', title: '期限切れ', dueDate: { year: 2026, month: 11, day: 7 } },
      { id: 'w5', courseId: 'c1', title: '期限なし' },
      { id: 'w6', courseId: 'c1', title: '下書き', state: 'DRAFT' },
      { id: 'w7', courseId: 'c1', title: '今日', dueDate: { year: 2026, month: 11, day: 8 } },
    ];
    const subs = [
      { courseWorkId: 'w2', state: 'TURNED_IN' },
      { courseWorkId: 'w3', state: 'RETURNED' },
      { courseWorkId: 'w1', state: 'CREATED' },
    ];
    const lines = classroomToText(courses, works, subs, NOW).split('\n');
    expect(lines).toEqual([`2026-11-20 数学: 問題集 3（${'あ'.repeat(200)}）`, '数学: 期限なし', '2026-11-08 数学: 今日']);
  });

  test('期限の時刻は UTC から端末の時刻に直す', () => {
    const at = new Date(Date.UTC(2026, 10, 20, 14, 59));
    const w: CourseWork = { id: 'w', courseId: 'c1', title: 'レポート', dueDate: { year: 2026, month: 11, day: 20 }, dueTime: { hours: 14, minutes: 59 } };
    const two = (n: number) => String(n).padStart(2, '0');
    const want = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())} 数学: レポート`;
    expect(classroomToText(courses, [w], [], NOW)).toBe(want);
  });

  test('教員名・メール・添付の名前を含めない・40 件まで', () => {
    const w: any = {
      id: 'w',
      courseId: 'c1',
      title: '課題',
      creatorUserId: 'teacher-1',
      materials: [{ driveFile: { driveFile: { title: '添付の名前' } } }],
      alternateLink: 'x@example.invalid',
    };
    const c: any = [{ id: 'c1', name: '数学', ownerId: 'teacher-1', teacherGroupEmail: 'grp@example.invalid' }];
    const text = classroomToText(c, [w], [], NOW);
    expect(text).toBe('数学: 課題');
    expect(text).not.toMatch(/teacher|添付|example|@/);
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, courseId: 'c1', title: `t${i}` }));
    expect(classroomToText(courses, many, [], NOW).split('\n')).toHaveLength(MAX_WORKS);
  });
});

describe('readClassroom（上限と失敗）', () => {
  test('通信は最大 6 コース・課題は全部で 40 件まで', async () => {
    const urls: string[] = [];
    const fake = async (url: string) => {
      urls.push(url);
      if (url.includes('/studentSubmissions')) return ok({ studentSubmissions: [] });
      if (url.includes('/courseWork')) return ok({ courseWork: Array.from({ length: 30 }, (_, i) => ({ id: `${url}-${i}`, title: 't' })) });
      return ok({ courses: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `n${i}` })) });
    };
    const r = await readClassroom(dummyToken(), fake);
    expect(r.courses).toHaveLength(MAX_COURSES);
    expect(r.works).toHaveLength(MAX_WORKS);
    expect(urls.filter((u) => u.includes('/courseWork?')).length).toBeLessThanOrEqual(MAX_COURSES);
    expect(urls.filter((u) => u.includes('/courseWork?')).length).toBe(2); // 30 + 10 で 40 件に達したら止める
  });

  const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ClassroomError ? e.kind : 'other'));
  const failWith = (status: number, body: unknown) => async () => ({ ok: false, status, text: async () => JSON.stringify(body) });

  test('失敗の分類: コース 0 件・403（API 無効／学校が不許可／権限不足）・401・通信失敗', async () => {
    const t = dummyToken();
    expect(await kindOf(readClassroom(t, async () => ok({})))).toBe('empty');
    expect(await kindOf(readClassroom(t, failWith(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } })))).toBe('api_disabled');
    expect(await kindOf(readClassroom(t, failWith(403, { error: { message: '@ClassroomApiDisabled' } })))).toBe('empty');
    expect(await kindOf(readClassroom(t, failWith(403, { error: { status: 'PERMISSION_DENIED' } })))).toBe('forbidden');
    expect(await kindOf(readClassroom(t, failWith(401, {})))).toBe('expired');
    expect(await kindOf(readClassroom(t, failWith(500, {})))).toBe('unknown');
    expect(await kindOf(readClassroom(t, async () => Promise.reject(new Error('offline'))))).toBe('network');
    expect(classroomHttpErrorKind(403, 'SERVICE_DISABLED')).toBe('api_disabled');
  });
});

describe('requestClassroomToken（GIS を差し替える）', () => {
  type Reply = { token?: { access_token?: string; error?: string }; gisError?: { type: string } };
  const fakeGoogle = (reply: Reply, seen: any[] = []): GoogleLike => ({
    accounts: {
      oauth2: {
        initTokenClient: (c) => {
          seen.push(c);
          return { requestAccessToken: () => (reply.gisError ? c.error_callback?.(reply.gisError) : c.callback(reply.token ?? {})) };
        },
      },
    },
  });

  test('3 つの読み取り範囲を半角空白区切りで要求する', async () => {
    const token = dummyToken();
    const seen: any[] = [];
    expect(await requestClassroomToken(dummyClient(), async () => fakeGoogle({ token: { access_token: token } }, seen))).toBe(token);
    expect(seen[0].scope).toBe(CLASSROOM_SCOPES);
    expect(CLASSROOM_SCOPES.split(' ')).toEqual([
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
    ]);
  });

  test('拒否・窓を閉じた・ポップアップのブロック', async () => {
    const kind = (r: Reply) => requestClassroomToken(dummyClient(), async () => fakeGoogle(r)).then(() => 'ok', (e) => (e as ClassroomError).kind);
    expect(await kind({ token: { error: 'access_denied' } })).toBe('closed');
    expect(await kind({ gisError: { type: 'popup_closed' } })).toBe('closed');
    expect(await kind({ gisError: { type: 'popup_failed_to_open' } })).toBe('popup_blocked');
  });

  test('失敗の 1 行は短く、もう一度を促す', () => {
    for (const k of ['closed', 'popup_blocked', 'api_disabled', 'forbidden', 'empty', 'expired', 'network', 'unknown'] as const) {
      const t = classroomErrorText(new ClassroomError(k));
      expect(t).toMatch(/もう一度/);
      expect(t.length).toBeLessThanOrEqual(40);
    }
    expect(classroomErrorText(new ClassroomError('empty'))).toContain('読める課題がありません');
  });
});

describe('原稿の検査（トークンと課題を残さない・出さない）', () => {
  const lib = read('lib/googleClassroom.ts');
  const screen = read('app/goal/import.tsx');
  test('保存先・ログに書かない', () => {
    for (const src of [lib, screen]) expect(src).not.toMatch(/localStorage|sessionStorage|AsyncStorage|console\./);
  });
  test('トークンを状態に置かない・課題をサーバーに送らない・ID が無ければ出さない', () => {
    const start = screen.indexOf('async function readGoogleClassroom');
    const fn = screen.slice(start, screen.indexOf('async function create', start));
    expect(fn).toContain('requestClassroomToken(googleClientId)');
    expect(fn).toContain('if (!googleClientId) return;');
    expect(fn).not.toMatch(/set\w*\(token|api\./);
    const btn = screen.indexOf('import-google-classroom');
    expect(screen.lastIndexOf('showGoogleButton(Platform.OS, googleClientId)', btn)).toBeGreaterThan(-1);
    expect(screen).toContain('読み取りだけです');
  });
});
