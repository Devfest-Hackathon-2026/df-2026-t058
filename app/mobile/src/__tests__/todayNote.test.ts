// 今日の提案を本人の希望で組み直す（#222）: 送る前の整え方・窓口・mock・カードの原稿。
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import type { TodayResult } from '../api/types';
import * as copy from '../lib/copy';
import { TODAY_NOTE_MAX, todayNote } from '../lib/homeView';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockStore.set(k, v);
    },
    removeItem: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

describe('送る前の希望（todayNote）', () => {
  it('前後の空白（全角も）を切る・空なら送らない', () => {
    expect(todayNote('  英語を先に　')).toBe('英語を先に');
    expect(todayNote('')).toBeUndefined();
    expect(todayNote(' 　\n ')).toBeUndefined();
    // 中の全角の空白は落とさない
    expect(todayNote('英語　先')).toBe('英語　先');
  });
  it('200 字を超える分は切る', () => {
    expect(TODAY_NOTE_MAX).toBe(200);
    expect(Array.from(todayNote('あ'.repeat(250)) ?? '').length).toBe(200);
  });
});

describe('窓口（http）', () => {
  function capture() {
    const calls: { url: string; init: RequestInit }[] = [];
    const body: TodayResult = { greeting: 'a', minutes: 30, proposals: [], totalMinutes: 0, source: 'rules' };
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    const sent = (i: number) => JSON.parse(String(calls[i]?.init.body ?? '{}'));
    return { api, sent };
  }
  it('note があれば前後の空白を切って送る', async () => {
    const { api, sent } = capture();
    await api.today(30, '  統計を先に ');
    expect(sent(0)).toEqual({ minutes: 30, note: '統計を先に' });
  });
  it('note が無い・空白だけなら送らない（今までどおり）', async () => {
    const { api, sent } = capture();
    await api.today(60);
    await api.today(60, '　 ');
    expect(sent(0)).toEqual({ minutes: 60 });
    expect(sent(1)).toEqual({ minutes: 60 });
  });
});

describe('mock', () => {
  async function seeded() {
    const api = createMockApi({ aiDelayMs: 0, now: () => Date.parse('2026-11-08T01:00:00Z') });
    const ids: string[] = [];
    for (const [text, deadline] of [
      ['英語', '2026-11-10T14:59:00Z'],
      ['統計', '2026-11-15T14:59:00Z'],
    ] as const) {
      const g = await api.createGoal({ text, deadline });
      const { candidates } = await api.makeCandidates(g.id);
      await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
      ids.push(g.id);
    }
    return { api, ids };
  }
  it('希望の言葉に合う目標を先頭に寄せる（無ければ期限の順のまま）', async () => {
    const { api, ids } = await seeded();
    expect((await api.today(120)).proposals.map((p) => p.goalId)).toEqual([ids[0], ids[1]]);
    expect((await api.today(120, '今日は統計をやりたい')).proposals.map((p) => p.goalId)).toEqual([ids[1], ids[0]]);
    expect((await api.today(120, '関係ない')).proposals.map((p) => p.goalId)).toEqual([ids[0], ids[1]]);
  });
  it('200 字を超える希望は 400', async () => {
    const { api } = await seeded();
    await expect(api.today(30, 'あ'.repeat(201))).rejects.toMatchObject({ status: 400, code: 'invalid_argument' });
  });
});

describe('カードの原稿', () => {
  const s = read('components', 'TodayProposal.tsx');
  it('入力「今日やりたいこと」と薄いボタン「この希望で組み直す」', () => {
    expect(copy.COPY_TODAY_NOTE).toBe('今日やりたいこと');
    expect(copy.COPY_TODAY_NOTE_APPLY).toBe('この希望で組み直す');
    expect(s).toContain('label={COPY_TODAY_NOTE}');
    expect(s).toContain('maxLength={TODAY_NOTE_MAX}');
    expect(s).toMatch(/label=\{COPY_TODAY_NOTE_APPLY\}\s+variant="plain"\s+size="small"/);
  });
  it('組み直しは api.today(minutes なし, note) を lastOnly 越しに呼ぶ・送る前に todayNote で整える', () => {
    expect(s).toContain('api.today(undefined, a.note)');
    expect(s).toContain('lastOnly(');
    expect(s).toContain('todayNote(noteText)');
  });
  it('反映の 1 行と「元に戻す」', () => {
    expect(copy.COPY_TODAY_NOTE_APPLIED).toBe('希望を反映しました');
    expect(copy.COPY_TODAY_NOTE_UNDO).toBe('元に戻す');
    expect(s).toContain('{COPY_TODAY_NOTE_APPLIED}');
    expect(s).toContain('label={COPY_TODAY_NOTE_UNDO}');
    // 入力欄の下に出る
    expect(s.indexOf('testID="today-note-applied"')).toBeGreaterThan(s.indexOf('testID="today-note"', 0));
  });
  it('希望は端末に残さない（保存の関数を呼ばない）', () => {
    // 「入れた」印（#208）の保存に AsyncStorage を使うので、希望（note）を保存する呼び出しが無いことだけを見る
    expect(s).not.toMatch(/remember\w*\(\s*note|setItem\([^)]*note/i);
    const local = read('lib', 'local.ts');
    expect(local).not.toMatch(/todayNote|TODAY_NOTE/);
  });
});
