// Google カレンダーの読み込み（Issue #199）。ネットワークに出ない（GIS と fetch を差し替える）。予定はすべて作り物。
declare const require: (name: string) => any;
declare const __dirname: string;

import {
  CALENDAR_SCOPE,
  CalendarError,
  calendarErrorText,
  eventsToText,
  fetchEvents,
  GIS_SRC,
  httpErrorKind,
  loadGis,
  requestToken,
  showGoogleButton,
  type GoogleLike,
} from '../lib/googleCalendar';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ダミーの値は本物の形にしない（実行時に組み立てる）
const dummyToken = (): string => ['test', 'tok', String(Date.now())].join('_');
const dummyClient = (): string => ['test', 'client'].join('-');
const NOW = new Date(2026, 10, 8, 12, 0, 0);

describe('eventsToText', () => {
  test('終日は時刻なし・時刻ありは HH:MM・詳細は 200 字まで', () => {
    const at = new Date(2026, 10, 21, 9, 30);
    const text = eventsToText([
      { summary: '提出日', start: { date: '2026-11-20' } },
      { summary: '小テスト', start: { dateTime: at.toISOString() }, description: 'あ'.repeat(300) },
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('2026-11-20 提出日');
    expect(lines[1]).toBe(`2026-11-21 09:30 小テスト（${'あ'.repeat(200)}）`);
  });

  test('場所・参加者・作成者は含めない・取消と題なし・壊れた日時は飛ばす', () => {
    const items = [
      {
        summary: '会',
        start: { date: '2026-11-22' },
        location: 'どこかの部屋',
        attendees: [{ email: 'someone@example.invalid' }],
        creator: { email: 'owner@example.invalid' },
      },
      { summary: '取り消した', status: 'cancelled', start: { date: '2026-11-23' } },
      { start: { date: '2026-11-24' } },
      { summary: '日時なし' },
      { summary: '壊れた', start: { dateTime: 'あした' } },
    ];
    const text = eventsToText(items as any);
    expect(text).toBe('2026-11-22 会');
    expect(text).not.toMatch(/部屋|example|@/);
  });

  test('詳細の HTML の札は落とす・空なら空文字', () => {
    expect(eventsToText([{ summary: 'a', start: { date: '2026-11-20' }, description: '<b>第 3 回</b><br>範囲' }])).toBe(
      '2026-11-20 a（第 3 回 範囲）',
    );
    expect(eventsToText([])).toBe('');
  });
});

describe('fetchEvents', () => {
  test('URL と Authorization の組み立て（読み取り・60 日・50 件・開始順）', async () => {
    const token = dummyToken();
    const calls: { url: string; init: any }[] = [];
    const fake = async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ summary: 'x', start: { date: '2026-11-20' } }] }) };
    };
    const items = await fetchEvents(token, NOW, fake);
    expect(items).toHaveLength(1);
    const c = calls[0];
    expect(c?.init.method).toBe('GET');
    expect(c?.init.headers.authorization).toBe(`Bearer ${token}`);
    const u = new URL(c?.url ?? '');
    expect(`${u.origin}${u.pathname}`).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(u.searchParams.get('singleEvents')).toBe('true');
    expect(u.searchParams.get('orderBy')).toBe('startTime');
    expect(u.searchParams.get('maxResults')).toBe('50');
    expect(u.searchParams.get('timeMin')).toBe(NOW.toISOString());
    expect(Date.parse(u.searchParams.get('timeMax') ?? '') - NOW.getTime()).toBe(60 * 24 * 60 * 60 * 1000);
  });

  const failWith = (status: number, body: unknown) => async () => ({ ok: false, status, text: async () => JSON.stringify(body) });
  const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof CalendarError ? e.kind : 'other'));

  test('失敗の分類: 403（API 無効・権限不足）・401・通信失敗・その他', async () => {
    const t = dummyToken();
    const disabled = { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } };
    expect(await kindOf(fetchEvents(t, NOW, failWith(403, disabled)))).toBe('api_disabled');
    expect(await kindOf(fetchEvents(t, NOW, failWith(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } })))).toBe(
      'forbidden',
    );
    expect(await kindOf(fetchEvents(t, NOW, failWith(401, { error: { code: 401 } })))).toBe('expired');
    expect(await kindOf(fetchEvents(t, NOW, failWith(500, {})))).toBe('unknown');
    const offline = async () => {
      throw new Error('offline');
    };
    expect(await kindOf(fetchEvents(t, NOW, offline))).toBe('network');
    expect(httpErrorKind(403, 'SERVICE_DISABLED')).toBe('api_disabled');
  });
});

describe('requestToken（GIS を差し替える）', () => {
  type Reply = { token?: { access_token?: string; error?: string }; gisError?: { type: string } };
  const fakeGoogle = (reply: Reply, seen: any[] = []): GoogleLike => ({
    accounts: {
      oauth2: {
        initTokenClient: (c) => {
          seen.push(c);
          return {
            requestAccessToken: () => (reply.gisError ? c.error_callback?.(reply.gisError) : c.callback(reply.token ?? {})),
          };
        },
      },
    },
  });

  test('読み取り専用の範囲でトークンを 1 回取る', async () => {
    const token = dummyToken();
    const id = dummyClient();
    const seen: any[] = [];
    expect(await requestToken(id, async () => fakeGoogle({ token: { access_token: token } }, seen))).toBe(token);
    expect(seen).toHaveLength(1);
    expect(seen[0].client_id).toBe(id);
    expect(seen[0].scope).toBe(CALENDAR_SCOPE);
    expect(CALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar.events.readonly');
    expect(seen[0].prompt).toBeUndefined();
  });

  test('拒否・窓を閉じた・ポップアップのブロック', async () => {
    const kind = (r: Reply) =>
      requestToken(dummyClient(), async () => fakeGoogle(r)).then(
        () => 'ok',
        (e) => (e as CalendarError).kind,
      );
    expect(await kind({ token: { error: 'access_denied' } })).toBe('closed');
    expect(await kind({ gisError: { type: 'popup_closed' } })).toBe('closed');
    expect(await kind({ gisError: { type: 'popup_failed_to_open' } })).toBe('popup_blocked');
    expect(await kind({ gisError: { type: 'unknown' } })).toBe('unknown');
  });

  test('失敗の 1 行は短く、もう一度を促す', () => {
    for (const k of ['closed', 'popup_blocked', 'api_disabled', 'forbidden', 'expired', 'network', 'unknown'] as const) {
      const t = calendarErrorText(new CalendarError(k));
      expect(t).toMatch(/もう一度/);
      expect(t.length).toBeLessThanOrEqual(40);
    }
    expect(calendarErrorText(new Error('x'))).toMatch(/もう一度/);
  });
});

describe('loadGis', () => {
  test('スクリプトは 1 回だけ足す・読めたら google を返す', async () => {
    const added: any[] = [];
    const win: any = {};
    const doc = { createElement: () => ({}), head: { appendChild: (s: any) => added.push(s) } };
    const a = loadGis(doc, win);
    const b = loadGis(doc, win);
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe(GIS_SRC);
    win.google = { accounts: { oauth2: {} } };
    added[0].onload();
    expect(await a).toBe(win.google);
    expect(await b).toBe(win.google);
    expect(await loadGis(doc, win)).toBe(win.google);
    expect(added).toHaveLength(1);
  });
});

describe('ボタンを出すか', () => {
  test('ID が null・空・Web 以外では出さない', () => {
    expect(showGoogleButton('web', dummyClient())).toBe(true);
    expect(showGoogleButton('web', null)).toBe(false);
    expect(showGoogleButton('web', '')).toBe(false);
    expect(showGoogleButton('ios', dummyClient())).toBe(false);
    expect(showGoogleButton('android', dummyClient())).toBe(false);
  });
});

describe('原稿の検査（トークンと予定を残さない・出さない）', () => {
  const lib = read('lib/googleCalendar.ts');
  const screen = read('app/goal/import.tsx');
  test('保存先・ログに書かない', () => {
    for (const src of [lib, screen]) {
      expect(src).not.toMatch(/localStorage|sessionStorage|AsyncStorage|console\./);
    }
  });
  test('トークンを状態に置かない・予定をサーバーに送らない', () => {
    const fn = screen.slice(screen.indexOf('async function readGoogleCalendar'), screen.indexOf('async function create'));
    expect(fn).toContain('requestToken(googleClientId)');
    expect(fn).not.toMatch(/set\w*\(token|api\./);
    expect(screen).toMatch(/showGoogleButton\(Platform\.OS, googleClientId\)/);
    expect(screen).toContain('読み取りだけです');
  });
});
