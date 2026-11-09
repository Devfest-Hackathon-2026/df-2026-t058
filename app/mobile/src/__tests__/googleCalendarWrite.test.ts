// Google カレンダーに今日の提案を書き込む（Issue #208）。ネットワークに出ない（GIS と fetch を差し替える）。
declare const require: (name: string) => any;
declare const __dirname: string;

import {
  ADDED_KEY,
  addProposalToCalendar,
  buildEventBody,
  CALENDAR_SCOPE,
  CALENDAR_WRITE_SCOPE,
  CalendarError,
  calendarErrorText,
  insertEvent,
  markAdded,
  nextFreeStart,
  requestWriteToken,
  tokyoIso,
  type GoogleLike,
  type MarkStore,
} from '../lib/googleCalendar';
import * as copy from '../lib/copy';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ダミーの値は本物の形にしない（実行時に組み立てる）
const dummyToken = (): string => ['test', 'tok', String(Date.now())].join('_');
const dummyClient = (): string => ['test', 'client'].join('-');
const ORIGIN = ['https:', '', 'app.example.invalid'].join('/');
// 2026-11-08 12:20（東京）
const NOW = new Date(Date.parse('2026-11-08T12:20:00+09:00'));
const item = { goalId: 'g1', checkpointId: 'c1', title: '英単語 50 個', reason: '期限まで\nあと 2 日', minutes: 25 };

const memStore = () => {
  const m = new Map<string, string>();
  const store: MarkStore = {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
  return { m, store };
};
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof CalendarError ? e.kind : 'other'));

describe('空いている時刻', () => {
  test('予定が無ければ次の正時', () => {
    expect(tokyoIso(nextFreeStart(NOW, 25).getTime())).toBe('2026-11-08T13:00:00+09:00');
    const onHour = new Date(Date.parse('2026-11-08T13:00:00+09:00'));
    expect(tokyoIso(nextFreeStart(onHour, 25).getTime())).toBe('2026-11-08T14:00:00+09:00');
  });
  test('分かっている予定とは重ねない', () => {
    const busy = [{ start: Date.parse('2026-11-08T13:10:00+09:00'), end: Date.parse('2026-11-08T15:10:00+09:00') }];
    expect(tokyoIso(nextFreeStart(NOW, 25, busy).getTime())).toBe('2026-11-08T16:00:00+09:00');
    // 25 分なら 13:30 の予定の前に収まる
    const later = [{ start: Date.parse('2026-11-08T13:30:00+09:00'), end: Date.parse('2026-11-08T15:10:00+09:00') }];
    expect(tokyoIso(nextFreeStart(NOW, 25, later).getTime())).toBe('2026-11-08T13:00:00+09:00');
  });
});

describe('buildEventBody', () => {
  test('題・説明（理由の 1 行）・開始と終了（所要分）・東京時間・アプリで開く', () => {
    const b = buildEventBody(item, '2026-11-08T04:00:00.000Z', 25, ORIGIN);
    expect(b.summary).toBe('英単語 50 個');
    expect(b.summary).not.toContain('モル塔');
    expect(b.description).toBe('期限まで あと 2 日');
    expect(b.start).toEqual({ dateTime: '2026-11-08T13:00:00+09:00', timeZone: 'Asia/Tokyo' });
    expect(b.end).toEqual({ dateTime: '2026-11-08T13:25:00+09:00', timeZone: 'Asia/Tokyo' });
    expect(b.source).toEqual({ title: 'アプリで開く', url: ORIGIN });
  });
  test('origin が http(s) でなければ source を付けない', () => {
    expect(buildEventBody(item, '2026-11-08T04:00:00.000Z', 25, undefined).source).toBeUndefined();
  });
});

describe('insertEvent', () => {
  test('URL・POST・Authorization・本文', async () => {
    const token = dummyToken();
    const calls: { url: string; init: any }[] = [];
    const link = ['https:', '', 'calendar.example.invalid', 'e'].join('/');
    const body = buildEventBody(item, NOW.toISOString(), 25, ORIGIN);
    const r = await insertEvent(token, body, async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'x', htmlLink: link }) };
    });
    expect(r.htmlLink).toBe(link);
    expect(calls[0]?.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual(body);
  });

  test('失敗の分類: 403（API 無効・権限不足）・401・通信失敗', async () => {
    const t = dummyToken();
    const b = buildEventBody(item, NOW.toISOString(), 25, ORIGIN);
    const failWith = (status: number, body: unknown) => async () => ({ ok: false, status, text: async () => JSON.stringify(body) });
    expect(await kindOf(insertEvent(t, b, failWith(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } })))).toBe('api_disabled');
    expect(await kindOf(insertEvent(t, b, failWith(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } })))).toBe('forbidden');
    expect(await kindOf(insertEvent(t, b, failWith(401, {})))).toBe('expired');
    const offline = async () => {
      throw new Error('offline');
    };
    expect(await kindOf(insertEvent(t, b, offline))).toBe('network');
  });
});

describe('requestWriteToken（GIS を差し替える）', () => {
  type Reply = { token?: { access_token?: string; error?: string; scope?: string }; gisError?: { type: string } };
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

  test('書く範囲で、読む許可とは別のトークンを取る', async () => {
    const token = dummyToken();
    const seen: any[] = [];
    expect(await requestWriteToken(dummyClient(), async () => fakeGoogle({ token: { access_token: token } }, seen))).toBe(token);
    expect(seen[0].scope).toBe('https://www.googleapis.com/auth/calendar.events');
    expect(CALENDAR_WRITE_SCOPE).not.toBe(CALENDAR_SCOPE);
  });

  test('窓を閉じた・拒否・ポップアップのブロック・書く許可だけ外された', async () => {
    const kind = (r: Reply) => kindOf(requestWriteToken(dummyClient(), async () => fakeGoogle(r)));
    expect(await kind({ token: { error: 'access_denied' } })).toBe('closed');
    expect(await kind({ gisError: { type: 'popup_closed' } })).toBe('closed');
    expect(await kind({ gisError: { type: 'popup_failed_to_open' } })).toBe('popup_blocked');
    expect(await kind({ token: { access_token: dummyToken(), scope: CALENDAR_SCOPE } })).toBe('forbidden');
  });

  test('入れる時の失敗の 1 行は短く、もう一度を促す', () => {
    for (const k of ['closed', 'popup_blocked', 'api_disabled', 'forbidden', 'expired', 'network', 'unknown'] as const) {
      const t = calendarErrorText(new CalendarError(k), 'write');
      expect(t).toMatch(/もう一度/);
      expect(t.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('入れる流れ（二重登録の防止・トークンを残さない）', () => {
  test('入れたら印を残し、2 回目は何もしない', async () => {
    const { m, store } = memStore();
    const token = dummyToken();
    let tokens = 0;
    const bodies: any[] = [];
    const deps = {
      clientId: dummyClient(),
      store,
      now: NOW,
      origin: ORIGIN,
      getToken: async () => {
        tokens++;
        return token;
      },
      insert: async (_t: string, b: any) => {
        bodies.push(b);
        return { htmlLink: null };
      },
    };
    expect((await addProposalToCalendar(item, deps)).status).toBe('added');
    expect(bodies[0]?.start.dateTime).toBe('2026-11-08T13:00:00+09:00');
    expect((await addProposalToCalendar(item, deps)).status).toBe('already');
    expect(tokens).toBe(1);
    expect(bodies).toHaveLength(1);
    // 保存先には印（提案の ID）だけ。トークンも予定の文も書かない
    expect(JSON.parse(m.get(ADDED_KEY) ?? '[]')).toEqual(['g1:c1']);
    const all = [...m.values()].join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain(item.title);
  });

  test('失敗したら印を残さない（もう一度押せる）', async () => {
    const { m, store } = memStore();
    const fail = async () => {
      throw new CalendarError('expired');
    };
    expect(await kindOf(addProposalToCalendar(item, { clientId: dummyClient(), store, getToken: async () => dummyToken(), insert: fail }))).toBe(
      'expired',
    );
    expect(m.get(ADDED_KEY)).toBeUndefined();
    await markAdded(store, 'g1:c1');
    await markAdded(store, 'g1:c1');
    expect(JSON.parse(m.get(ADDED_KEY) ?? '[]')).toEqual(['g1:c1']);
  });
});

describe('原稿の検査', () => {
  const lib = read('lib/googleCalendar.ts');
  const card = read('components/TodayProposal.tsx');
  test('ログに出さない・ライブラリは保存先を名指ししない', () => {
    expect(lib).not.toMatch(/localStorage|sessionStorage|AsyncStorage|console\./);
    expect(card).not.toMatch(/localStorage|sessionStorage|console\./);
  });
  test('ID が null や Web 以外ではボタンを出さない（今のまま）・トークンを状態に置かない', () => {
    expect(card).toContain('showGoogleButton(Platform.OS, googleClientId)');
    expect(card).toMatch(/\{canWrite \? \(/);
    expect(card).not.toMatch(/set\w*\(token|useState<string \| null>\(null\); \/\/ token/);
    const fn = card.slice(card.indexOf('async function addToGoogleCalendar'), card.indexOf('const nameOf'));
    expect(fn).not.toMatch(/api\./);
  });
  test('文言は copy の定数', () => {
    expect(card).toContain('label={COPY_ADD_CALENDAR}');
    expect(card).toContain('{COPY_CALENDAR_ADDED}');
    expect(card).toContain('{COPY_OPEN_GOOGLE_CALENDAR}');
    expect(copy.COPY_CALENDAR_ADDED).toBe('入れました');
    expect(copy.COPY_OPEN_GOOGLE_CALENDAR).toBe('Google カレンダーで開く');
  });
});
