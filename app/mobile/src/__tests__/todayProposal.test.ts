// 今日の提案（#187）: 時間の札の保存・取り直し（最後の 1 回だけ）・主ボタン・失敗・空の初回・キャラの出る所・窓口と mock。
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import type { Checkpoint, HomeData, Session, TodayMinutes, TodayResult } from '../api/types';
import * as copy from '../lib/copy';
import { footerGoalName, lastOnly, primaryAction, primaryLabel, proposalKey, proposalStart } from '../lib/homeView';

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
  },
}));
const store = mockStore;

type Entry = HomeData['goals'][number];
const cp = (id: string, estimateMin = 25, state: Checkpoint['state'] = 'todo') =>
  ({ id, order: 1, title: id, doneMark: '', estimateMin, state, achievement: null }) as Checkpoint;
const entry = (id: string, cps: Checkpoint[]): Entry =>
  ({
    goal: { id, userId: 'u', text: `目標${id}`, deadline: '2026-11-20', minutesPerDay: null, status: 'active' },
    roadmap: { id: `r${id}`, goalId: id, userId: 'u', adopted: 'own', why: '', checkpoints: cps, createdAt: '' },
  }) as Entry;
const idle = { active: null, toReflect: [] as Session[] };

// #265: 時間の札（15/30/60/120）はやめた。ホームを開いたら時間を聞かずに、そのまま提案を呼ぶ
describe('時間を先に聞かない', () => {
  const s = read('components', 'TodayProposal.tsx');
  it('カードに時間の札が無い・時間を覚えない', () => {
    expect(s).not.toContain('today-min-');
    expect(s).not.toMatch(/TODAY_MINUTES|todayMinutes|rememberTodayMinutes|<Chip/);
    expect('COPY_TODAY_MINUTES' in copy).toBe(false);
    expect(read('lib', 'local.ts')).not.toMatch(/export (async function|const) \w*[Tt]odayMinutes|TODAY_MINUTES/);
  });
  it('開いたら minutes なしで api.today を呼ぶ（目標の次の一歩が変わった時だけ取り直す）', () => {
    expect(s).toContain('api.today(undefined, a.note)');
    expect(s).toMatch(/useEffect\(\(\) => \{\s*fetchNow\(\);[\s\S]*?\}, \[key\]\);/);
  });
  it('提案の行の見積り分の表示は残す', () => {
    expect(s).toContain('`${p.minutes} 分　${p.reason}`');
  });
  it('前に保存した時間が端末に残っていても、送らない（読み捨て）', async () => {
    store.set('todayMinutes.v1', JSON.stringify(120));
    const calls: RequestInit[] = [];
    const body: TodayResult = { greeting: 'a', minutes: 60, proposals: [], totalMinutes: 0, source: 'rules' };
    const f = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    await api.today();
    await api.today(undefined, ' 英語 ');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({});
    expect(JSON.parse(String(calls[1]!.body))).toEqual({ note: '英語' });
  });
});

describe('札を変えた時の取り直しは最後の 1 回だけ', () => {
  const deferred = () => {
    let resolve!: (v: string) => void;
    let reject!: (e: unknown) => void;
    const p = new Promise<string>((a, b) => {
      resolve = a;
      reject = b;
    });
    return { p, resolve, reject };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('先に送った応答が後から届いても捨てる', async () => {
    const pending: Record<number, ReturnType<typeof deferred>> = {};
    const applied: unknown[] = [];
    const r = lastOnly(
      (m: number) => {
        pending[m] = deferred();
        return pending[m]!.p;
      },
      (x) => applied.push(x),
      0,
    );
    r.request(15);
    r.request(60);
    pending[60]!.resolve('60 の提案');
    pending[15]!.resolve('15 の提案');
    await flush();
    expect(applied).toEqual([{ ok: true, value: '60 の提案' }]);
  });

  it('古い依頼の失敗も捨てる。最後の依頼の失敗は伝える', async () => {
    const pending: Record<number, ReturnType<typeof deferred>> = {};
    const applied: unknown[] = [];
    const r = lastOnly(
      (m: number) => {
        pending[m] = deferred();
        return pending[m]!.p;
      },
      (x) => applied.push(x),
      0,
    );
    r.request(15);
    r.request(30);
    pending[15]!.reject(new Error('x'));
    pending[30]!.reject(new Error('y'));
    await flush();
    expect(applied).toEqual([{ ok: false }]);
  });

  it('連打した時は、少し待ってから最後の値だけを送る', async () => {
    jest.useFakeTimers();
    try {
      const sent: number[] = [];
      const r = lastOnly(
        async (m: number) => {
          sent.push(m);
          return m;
        },
        () => undefined,
        250,
      );
      r.request(15);
      r.request(60);
      r.request(120);
      jest.advanceTimersByTime(300);
      expect(sent).toEqual([120]);
      r.request(30);
      r.cancel();
      jest.advanceTimersByTime(300);
      expect(sent).toEqual([120]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('目標の次の一歩が変わった時だけ、取り直しの目印が変わる', () => {
    const a = [entry('a', [cp('a1')]), entry('b', [cp('b1')])];
    expect(proposalKey(a)).toBe(proposalKey([entry('a', [cp('a1')]), entry('b', [cp('b1')])]));
    expect(proposalKey(a)).not.toBe(proposalKey([entry('a', [cp('a1', 25, 'done')]), entry('b', [cp('b1')])]));
  });
});

describe('主ボタンは常に 1 つ（提案ありなら 1 件目）', () => {
  const goals = [entry('a', [cp('a1', 20)]), entry('b', [cp('b1', 40)])];
  const open = goals[1]!;
  const props = [
    { goalId: 'a', checkpointId: 'a1' },
    { goalId: 'b', checkpointId: 'b1' },
  ];

  it('提案があれば、下の主ボタンは 1 件目を始める（開いたカードより先）', () => {
    const a = primaryAction(idle, open, open.roadmap!.checkpoints[0]!, proposalStart(props, goals));
    expect(a).toMatchObject({ kind: 'start', goalId: 'a', checkpoint: { id: 'a1' }, fromProposal: true });
    expect(primaryLabel(a)).toBe('始める　20 分');
    // 1 行目に目標の名前（目標が 1 件でも出す）
    expect(footerGoalName(a, goals)).toBe('目標a');
    expect(footerGoalName(a, [goals[0]!])).toBe('目標a');
  });

  it('集中中・振り返り待ちは今のまま優先', () => {
    const first = proposalStart(props, goals);
    expect(primaryAction({ active: { id: 's1' } as Session, toReflect: [] }, open, null, first).kind).toBe('resume');
    expect(primaryAction({ active: null, toReflect: [{ id: 's2' } as Session] }, open, null, first).kind).toBe('reflect');
  });

  it('提案が 0 件・古い提案なら、今の動き（開いたカードの始める）', () => {
    const today = open.roadmap!.checkpoints[0]!;
    expect(proposalStart([], goals)).toBeNull();
    expect(proposalStart([{ goalId: 'x', checkpointId: 'y' }], goals)).toBeNull();
    expect(proposalStart([{ goalId: 'a', checkpointId: 'a1' }], [entry('a', [cp('a1', 20, 'done')])])).toBeNull();
    const a = primaryAction(idle, open, today, proposalStart([], goals));
    expect(a).toEqual({ kind: 'start', goalId: 'b', checkpoint: today });
    expect(footerGoalName(a, [open])).toBeNull();
  });

  it('ホームは今日の提案をモルティの言葉とボタンにして、目標の一覧より上に置く（UI 刷新・11/9）', () => {
    const s = read('app', '(tabs)', 'index.tsx');
    expect(s).toContain('moltyHome(data, proposals, pickedId)');
    expect(s).toContain('api.today()');
    expect(s.indexOf('<AgentSays')).toBeLessThan(s.indexOf('testID="other-goals"'));
  });
});

describe('カードの中身（原稿の検査）', () => {
  const s = read('components', 'TodayProposal.tsx');
  it('あいさつは直径 36 のエビの丸と吹き出し', () => {
    expect(s).toContain('export const GREETING_ICON_SIZE = 36;');
    expect(s).toContain('<Mascot size={GREETING_ICON_SIZE}');
    expect(s).toContain('{result.greeting}');
  });
  it('行の「始める」は薄いボタンで、/start/:goalId/:checkpointId へ', () => {
    expect(s).toMatch(/label=\{COPY_START\}\s+variant="plain"\s+size="small"/);
    expect(s).toContain('router.push(`/start/${p.goalId}/${p.checkpointId}`)');
  });
  it('待っている間は骨組み、失敗はカードを消さずに 1 行と「もう一度」', () => {
    expect(s).toContain('<Skeleton height={56} />');
    expect(s).toContain('{COPY_TODAY_FAILED}');
    expect(s).toMatch(/label=\{COPY_RETRY\}[\s\S]*testID="today-retry"/);
    // Card は条件なしで返す（失敗しても消えない）
    expect(s).toMatch(/return \(\s*<Card testID="today-proposal"/);
    expect(copy.COPY_TODAY_FAILED).toBe('提案を取れませんでした');
    expect(copy.COPY_RETRY).toBe('もう一度');
  });
  it('文言は copy の定数、色は theme の値だけ', () => {
    expect(s).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/);
    expect(s).toContain('{COPY_TODAY_FAILED}');
  });
});

describe('キャラはこのカードと相談の画面だけ', () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir) as string[]) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name !== '__tests__') out.push(...walk(full));
      } else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }
  // #257: 各画面のエビの発言の部品 AgentSays も使う（画面は AgentSays 越し）
  it('<Mascot を使うのは TodayProposal と TutorChat と AgentSays だけ', () => {
    const users = walk(SRC)
      .filter((f) => /<Mascot(?:\s|\/|>)/.test(read(path.relative(SRC, f))))
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(users).toEqual(
      [path.join('components', 'TodayProposal.tsx'), path.join('components', 'TutorChat.tsx'), path.join('components', 'AgentSays.tsx')].sort(),
    );
  });
  it('ホームの画面そのものは Mascot を使わない（カード越しだけ）', () => {
    const s = read('app', '(tabs)', 'index.tsx');
    expect(s).not.toContain('Mascot');
  });
});

describe('窓口と mock', () => {
  it('http は POST /api/today に minutes を送る', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const body: TodayResult = { greeting: 'a', minutes: 30, proposals: [], totalMinutes: 0, source: 'rules' };
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    expect(await api.today(30)).toEqual(body);
    expect(calls[0]!.url).toBe('http://api.test/api/today');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ minutes: 30 });
  });

  it('目標が 0 件なら proposals は空で、決まったあいさつ', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    const r = await api.today(30);
    expect(r).toEqual({ greeting: '目標を足すと、今日の提案が出ます', minutes: 30, proposals: [], totalMinutes: 0, source: 'rules' });
  });

  it('目標が複数あれば、期限の近い順に時間に収まる分（1 件目は必ず・3 件まで）', async () => {
    const t = Date.parse('2026-11-08T01:00:00Z');
    const api = createMockApi({ aiDelayMs: 0, now: () => t });
    const ids: string[] = [];
    for (const [text, deadline] of [
      ['遠い', '2026-11-30T14:59:00Z'],
      ['近い', '2026-11-10T14:59:00Z'],
      ['中', '2026-11-15T14:59:00Z'],
    ] as const) {
      const g = await api.createGoal({ text, deadline });
      const { candidates } = await api.makeCandidates(g.id);
      await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
      ids.push(g.id);
    }
    const r120 = await api.today(120);
    expect(r120.source).toBe('ai');
    expect(r120.greeting.length).toBeGreaterThan(0);
    expect(r120.proposals.map((p) => p.goalId)).toEqual([ids[1], ids[2], ids[0]]);
    expect(r120.proposals[0]!.reason).toBe('期限まであと 2 日');
    expect(r120.totalMinutes).toBe(90);
    // 15 分でも 1 件目は出す
    const r15 = await api.today(15);
    expect(r15.proposals).toHaveLength(1);
    // 60 分なら 2 件（合計 60 分以内）
    const r60 = await api.today(60);
    expect(r60.proposals).toHaveLength(2);
    expect(r60.totalMinutes).toBeLessThanOrEqual(60);
  });

  it('選べない時間は 400', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    await expect(api.today(45 as TodayMinutes)).rejects.toMatchObject({ status: 400, code: 'invalid_argument' });
  });

  it('minutes を省くと、合計の目安 60 分で期限の近い順（#265）', async () => {
    const t = Date.parse('2026-11-08T01:00:00Z');
    const api = createMockApi({ aiDelayMs: 0, now: () => t });
    for (const [text, deadline] of [
      ['遠い', '2026-11-30T14:59:00Z'],
      ['近い', '2026-11-10T14:59:00Z'],
      ['中', '2026-11-15T14:59:00Z'],
    ] as const) {
      const g = await api.createGoal({ text, deadline });
      const { candidates } = await api.makeCandidates(g.id);
      await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    }
    const r = await api.today();
    expect(r.minutes).toBe(60);
    expect(r.proposals).toEqual((await api.today(60)).proposals);
    expect(r.proposals[0]!.reason).toBe('期限まであと 2 日');
  });
});
