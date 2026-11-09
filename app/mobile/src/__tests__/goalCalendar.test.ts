// 目標の期限とステップを Google カレンダーに入れる（Issue #291）。ネットワークに出ない（fetch と許可を差し替える）。
declare const require: (name: string) => any;
declare const __dirname: string;

// 端末の保存先は使わない（試験では memStore を渡す）。読み込みで止まらないよう空にする
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));

import { CalendarError, calendarErrorText, writeEvent, type AllDayBody, type MarkStore } from '../lib/googleCalendar';
import {
  diffEvents,
  GOAL_CAL_DESCRIPTION,
  goalCalKey,
  goalEvents,
  removeGoalFromCalendar,
  savedEvents,
  sig,
  syncGoalToCalendar,
  tokyoDate,
} from '../lib/goalCalendar';
import * as copy from '../lib/copy';
import { PRIVACY_SECTIONS } from '../lib/privacyText';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ダミーの値は本物の形にしない（実行時に組み立てる）
const dummyToken = (): string => ['test', 'tok', String(Date.now())].join('_');
const dummyClient = (): string => ['test', 'client'].join('-');
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof CalendarError ? e.kind : 'other'));

const goal = { id: 'g1', text: '英検 2 級', deadline: '2026-11-30T14:59:00.000Z' }; // 東京の 11/30 23:59

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

// 書き込みの偽物: 呼ばれた順を残し、POST には連番の ID を返す
const fakeWrite = (opts: { gone?: string[]; failOn?: number } = {}) => {
  const calls: { method: string; eventId: string | null; body: AllDayBody | null }[] = [];
  let n = 0;
  const write = async (_t: string, method: 'POST' | 'PATCH' | 'DELETE', eventId: string | null, body: AllDayBody | null) => {
    calls.push({ method, eventId, body });
    if (opts.failOn === calls.length) throw new CalendarError('expired');
    if (eventId && opts.gone?.includes(eventId)) return { id: null, gone: true };
    return { id: method === 'POST' ? `ev${++n}` : eventId, gone: false };
  };
  return { calls, write };
};

describe('予定の本文を作る', () => {
  test('東京の日付にする', () => {
    expect(tokyoDate(goal.deadline)).toBe('2026-11-30');
    expect(tokyoDate('2026-11-30T15:00:00.000Z')).toBe('2026-12-01');
    expect(tokyoDate('2026-12-03')).toBe('2026-12-03');
    expect(tokyoDate('')).toBeNull();
    expect(tokyoDate('あした')).toBeNull();
    expect(tokyoDate(null)).toBeNull();
  });

  test('目標の期限とステップの日を終日の予定にする・時刻は付けない・期限なしは除く', () => {
    const evs = goalEvents(goal, [
      { id: 'c1', title: '単語 ', due: '2026-11-20T14:59:00.000Z' },
      { id: 'c2', title: '過去問' },
      { id: 'c3', title: '面接', due: null },
    ]);
    expect(evs.map((e) => e.key)).toEqual(['goal', 'step:c1']);
    expect(evs[0]?.body).toEqual({
      summary: '英検 2 級',
      description: GOAL_CAL_DESCRIPTION,
      start: { date: '2026-11-30' },
      end: { date: '2026-12-01' },
    });
    expect(evs[1]?.body.summary).toBe('英検 2 級：単語');
    expect(evs[1]?.body.description.indexOf('モル塔から入れた予定です', 0)).toBe(0);
    expect(JSON.stringify(evs)).not.toMatch(/dateTime/);
    expect(goalEvents({ text: 'x', deadline: undefined }, [])).toEqual([]);
  });
});

describe('差分の計算', () => {
  test('無い物は足す・日付か題が変わった物は直す・無くなった物は消す', () => {
    const planned = goalEvents(goal, [
      { id: 'c1', title: '単語', due: '2026-11-20' },
      { id: 'c2', title: '長文', due: '2026-11-25' },
      { id: 'c4', title: '新しい', due: '2026-11-26' },
    ]);
    const saved = {
      goal: { id: 'e0', date: '2026-11-30', sig: sig('英検 2 級') },
      'step:c1': { id: 'e1', date: '2026-11-19', sig: sig('英検 2 級：単語') },
      'step:c2': { id: 'e2', date: '2026-11-25', sig: sig('英検 2 級：前の題') },
      'step:c3': { id: 'e3', date: '2026-11-22', sig: sig('英検 2 級：消えた') },
    };
    const d = diffEvents(planned, saved);
    expect(d.keep).toEqual(['goal']);
    expect(d.update.map((u) => u.eventId)).toEqual(['e1', 'e2']);
    expect(d.add.map((a) => a.key)).toEqual(['step:c4']);
    expect(d.remove).toEqual([{ key: 'step:c3', eventId: 'e3' }]);
  });
});

describe('まとめて入れる・二重に入れない・外す', () => {
  test('1 回目は入れ、2 回目は変わった所だけ。保存は ID と日付だけ', async () => {
    const { m, store } = memStore();
    const token = dummyToken();
    let tokens = 0;
    const w = fakeWrite();
    const deps = {
      clientId: dummyClient(),
      store,
      getToken: async () => {
        tokens++;
        return token;
      },
      write: w.write,
    };
    const steps = [{ id: 'c1', title: '単語', due: '2026-11-20' }];
    expect(await syncGoalToCalendar(goal, steps, deps)).toEqual({ count: 2 });
    expect(w.calls.map((c) => c.method)).toEqual(['POST', 'POST']);
    // 同じ中身で押し直しても、増やさない（許可も求めない）
    expect(await syncGoalToCalendar(goal, steps, deps)).toEqual({ count: 2 });
    expect(w.calls).toHaveLength(2);
    expect(tokens).toBe(1);
    // 期限が変わった・ステップが無くなった
    await syncGoalToCalendar({ ...goal, deadline: '2026-12-05' }, [], deps);
    expect(w.calls.slice(2).map((c) => [c.method, c.eventId])).toEqual([
      ['DELETE', 'ev2'],
      ['PATCH', 'ev1'],
    ]);
    expect(Object.keys(await savedEvents(store, 'g1'))).toEqual(['goal']);
    const all = [...m.values()].join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain('英検');
    // 外す
    expect(await removeGoalFromCalendar('g1', deps)).toEqual({ count: 1 });
    expect(w.calls[w.calls.length - 1]).toEqual({ method: 'DELETE', eventId: 'ev1', body: null });
    expect(m.get(goalCalKey('g1'))).toBe('{}');
    expect(await removeGoalFromCalendar('g1', deps)).toEqual({ count: 0 });
  });

  test('カレンダー側で消されていたら入れ直す', async () => {
    const { store } = memStore();
    await store.setItem(goalCalKey('g1'), JSON.stringify({ goal: { id: 'old', date: '2026-11-01', sig: 'x' } }));
    const w = fakeWrite({ gone: ['old'] });
    await syncGoalToCalendar(goal, [], { clientId: dummyClient(), store, getToken: async () => dummyToken(), write: w.write });
    expect(w.calls.map((c) => c.method)).toEqual(['PATCH', 'POST']);
    expect((await savedEvents(store, 'g1')).goal?.id).toBe('ev1');
  });

  test('途中で失敗しても、できた分は覚える・許可が無ければ何も書かない', async () => {
    const { store } = memStore();
    const w = fakeWrite({ failOn: 2 });
    const deps = { clientId: dummyClient(), store, getToken: async () => dummyToken(), write: w.write };
    const steps = [{ id: 'c1', title: '単語', due: '2026-11-20' }];
    expect(await kindOf(syncGoalToCalendar(goal, steps, deps))).toBe('expired');
    expect(Object.keys(await savedEvents(store, 'g1'))).toEqual(['goal']);

    const denied = fakeWrite();
    const closed = async () => {
      throw new CalendarError('closed');
    };
    const empty = memStore();
    expect(await kindOf(syncGoalToCalendar(goal, [], { clientId: dummyClient(), store: empty.store, getToken: closed, write: denied.write }))).toBe('closed');
    expect(denied.calls).toHaveLength(0);
    expect(empty.m.size).toBe(0);
    expect(calendarErrorText(new CalendarError('closed'), 'write')).toMatch(/もう一度/);
  });
});

describe('writeEvent（fetch を差し替える）', () => {
  const body = goalEvents(goal, [])[0]!.body;
  test('入れる: POST・Authorization・本文・ID を返す', async () => {
    const token = dummyToken();
    const calls: { url: string; init: any }[] = [];
    const r = await writeEvent(token, 'POST', null, body, async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'abc' }) };
    });
    expect(r).toEqual({ id: 'abc', gone: false });
    expect(calls[0]?.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual(body);
  });

  test('直す・消す: 予定の ID を URL に付ける。消す時は本文なし。無い予定は gone', async () => {
    const urls: string[] = [];
    const inits: any[] = [];
    const ok = async (url: string, init: any) => {
      urls.push(url);
      inits.push(init);
      return { ok: true, status: 204, text: async () => '' };
    };
    await writeEvent(dummyToken(), 'PATCH', 'a/b', body, ok);
    await writeEvent(dummyToken(), 'DELETE', 'e1', null, ok);
    expect(urls[0]).toMatch(/\/events\/a%2Fb$/);
    expect(inits[0]?.method).toBe('PATCH');
    expect(inits[1]?.method).toBe('DELETE');
    expect(inits[1]?.body).toBeUndefined();
    const gone = async () => ({ ok: false, status: 410, text: async () => '' });
    expect(await writeEvent(dummyToken(), 'DELETE', 'e1', null, gone)).toEqual({ id: null, gone: true });
  });

  test('失敗の分類: 403（API 無効・権限不足）・401・通信失敗', async () => {
    const t = dummyToken();
    const failWith = (status: number, b: unknown) => async () => ({ ok: false, status, text: async () => JSON.stringify(b) });
    expect(await kindOf(writeEvent(t, 'POST', null, body, failWith(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } })))).toBe('api_disabled');
    expect(await kindOf(writeEvent(t, 'POST', null, body, failWith(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } })))).toBe('forbidden');
    expect(await kindOf(writeEvent(t, 'PATCH', 'e1', body, failWith(401, {})))).toBe('expired');
    const offline = async () => {
      throw new Error('offline');
    };
    expect(await kindOf(writeEvent(t, 'POST', null, body, offline))).toBe('network');
  });
});

describe('原稿の検査', () => {
  const lib = read('lib/goalCalendar.ts');
  const screen = read('app/plan/[goalId].tsx');
  test('ログに出さない・保存先は渡された物だけ', () => {
    expect(lib).not.toMatch(/localStorage|sessionStorage|console\./);
    // 端末の保存先は、画面に渡すための 1 か所だけで名指しする（読み書きは渡された store を通す）
    expect(lib.match(/AsyncStorage/g) ?? []).toHaveLength(2);
    const writes = lib.match(/\.setItem\(([^,)]*),/g) ?? [];
    expect(writes.every((w: string) => w.includes('goalCalKey'))).toBe(true);
  });
  test('画面: Web でクライアント ID がある時だけ・文言は copy の定数・トークンを状態に置かない', () => {
    expect(screen).toContain('showGoogleButton(Platform.OS, clientId)');
    expect(screen).toContain('label={COPY_ADD_CALENDAR}');
    expect(screen).toContain('label={COPY_GOAL_CALENDAR_REMOVE}');
    expect(screen).not.toMatch(/set\w*\(token/);
    expect(copy.copyGoalCalendarAdded(3)).toBe('3 件入れました');
    expect(copy.COPY_GOAL_CALENDAR_REMOVE).toBe('カレンダーから外す');
  });
  test('プライバシー: 押した時だけ目標の期限とステップの日を書き込む', () => {
    const text = JSON.stringify(PRIVACY_SECTIONS);
    expect(text).toContain('押した時だけ、目標の期限とステップの日を予定として書き込みます');
  });
});
