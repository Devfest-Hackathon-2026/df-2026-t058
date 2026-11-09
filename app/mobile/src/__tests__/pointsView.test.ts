// 考えポイントの画面（#271）: 整形・ホームの帯・シート・振り返り・建物・週のまとめ・窓口と mock。
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import type { PointItem, PointsData } from '../api/types';
import { allAgentLines, pointsGained } from '../lib/agentLines';
import { COPY_POINTS_BY_GOAL } from '../lib/copy';
import {
  goalRows,
  homeBandText,
  itemLine,
  POINTS_NOTE,
  ptText,
  reflectBreakdown,
  sheetRows,
  weeklyPointsLine,
} from '../lib/pointsView';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const item = (pt: number, label = '30 分集中した', kind: PointItem['kind'] = 'focus'): PointItem => ({
  at: '2026-11-08T03:00:00.000Z',
  kind,
  pt,
  label,
});

describe('ptText', () => {
  it('「12 shell」。負・NaN・未指定は 0', () => {
    expect(ptText(12)).toBe('12 shell');
    expect(ptText(0)).toBe('0 shell');
    expect(ptText(-3)).toBe('0 shell');
    expect(ptText(NaN)).toBe('0 shell');
    expect(ptText(undefined)).toBe('0 shell');
    expect(ptText(4.9)).toBe('4 shell');
  });
});

describe('itemLine・sheetRows', () => {
  it('1 行にする', () => {
    expect(itemLine(item(6))).toBe('30 分集中した　＋6 shell');
  });
  it('0 以下は出さない・順は保つ', () => {
    const rows = sheetRows([item(6), item(0, 'a'), item(-1, 'b'), item(10, '終えた', 'done')]);
    expect(rows.map((r) => r.text)).toEqual(['30 分集中した　＋6 shell', '終えた　＋10 shell']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(sheetRows(undefined)).toEqual([]);
  });
});

describe('ホームの帯', () => {
  it('今日が 0・無い・NaN なら出さない', () => {
    expect(homeBandText({ today: 0 })).toBeNull();
    expect(homeBandText(undefined)).toBeNull();
    expect(homeBandText({ today: NaN })).toBeNull();
    expect(homeBandText({ today: 12 })).toBe('今日 12 shell');
  });
  it('ホームには数字の帯を置かない（UI 刷新・11/9。ポイントは建物タブで見る）', () => {
    const s = read('app', '(tabs)', 'index.tsx');
    expect(s).not.toContain('homeBandText(');
    expect(s).not.toContain('<PointsSheet');
  });
});

describe('シート', () => {
  const s = read('components', 'PointsSheet.tsx');
  it('累計・今週・内訳・注記 1 行（順位や「あと◯pt」は無い）', () => {
    expect(s).toContain('累計 ${ptText(data?.total)}');
    expect(s).toContain('今週 ${ptText(data?.week)}');
    expect(s).toContain('sheetRows(data?.items)');
    expect(s).toContain('POINTS_NOTE');
    expect(POINTS_NOTE).toBe('考えた分だけ増えます。モルティに聞いても減りません');
    expect(s).not.toMatch(/順位|ランキング|あと/);
  });
});

describe('振り返りの結果', () => {
  it('集中・考えてから聞いた・達成の内訳と、合計', () => {
    const r = reflectBreakdown({ focusMin: 30, achievement: 2, pt: 6 + 4 + 10 });
    expect(r.total).toBe('20 shell');
    expect(r.lines).toEqual(['集中 6 shell', '考えてから聞いた 4 shell', '達成 10 shell']);
  });
  it('0 の行は出さない・pt が無ければ集中＋達成で数える・負は出ない', () => {
    expect(reflectBreakdown({ focusMin: 12, achievement: null })).toEqual({ total: '2 shell', lines: ['集中 2 shell'] });
    expect(reflectBreakdown({ focusMin: 0, achievement: 0, pt: 0 })).toEqual({ total: '0 shell', lines: [] });
    expect(reflectBreakdown({ focusMin: 30, achievement: 1, pt: 0 }).lines).toEqual(['集中 6 shell', '達成 5 shell']);
  });
  it('振り返りの画面には数字を並べず、モルティの一言で伝える（#315・数字は建物タブに 1 か所）', () => {
    const s = read('app', 'reflect', '[sessionId].tsx');
    expect(s).not.toContain('testID="reflect-points-total"');
    expect(s).toContain('builtLine(builtPt, lit, builtColor, f?.floors ?? null)');
  });
});

describe('建物・週のまとめ', () => {
  it('階の記録に「考えポイント」の 1 行', () => {
    const s = read('app', '(tabs)', 'tower.tsx');
    expect(s).toContain('<Row label="シェル" value={ptText(rec.floor.pt)} />');
  });
  it('週のまとめ: 今週の pt を事実だけで 1 行（0・無いなら出さない）', () => {
    expect(weeklyPointsLine({ week: 45 })).toBe('今週のシェル　45 shell');
    expect(weeklyPointsLine({ week: 0 })).toBeNull();
    expect(weeklyPointsLine(null)).toBeNull();
    // UI 刷新（11/9）: 建物の上は数字の 1 行（分・階・pt）にまとめた
    const w = read('components', 'WeeklyCard.tsx');
    expect(w).toContain('testID="weekly-facts"');
    expect(w).toContain('points.week > 0');
    expect(read('app', '(tabs)', 'tower.tsx')).toContain('points={pts.data}');
  });
});

describe('目標ごとの内訳（#351）', () => {
  it('goalRows: サーバーの並びのまま（多い順にしない）・pt 0 以下は出さない・やめた印を保つ・無ければ空', () => {
    const rows = goalRows([
      { goalId: 'a', text: '英検', pt: 3, archived: false },
      { goalId: 'b', text: '数学', pt: 20, archived: true },
      { goalId: 'c', text: 'ゼロ', pt: 0, archived: false },
    ]);
    expect(rows).toEqual([
      { key: 'a', text: '英検', pt: '3 shell', archived: false },
      { key: 'b', text: '数学', pt: '20 shell', archived: true },
    ]);
    expect(goalRows(undefined)).toEqual([]);
    expect(goalRows([])).toEqual([]);
  });
  it('建物タブに総得点と内訳（見出しは copy.ts・1 行に切る・やめた目標は薄く・順位や番号は無い）', () => {
    const t = read('app', '(tabs)', 'tower.tsx');
    expect(t).toContain('<TowerPoints data={pts.data} />');
    const s = read('components', 'PointsSheet.tsx');
    expect(s).toContain('COPY_POINTS_BY_GOAL');
    expect(s).toContain('numberOfLines={1}');
    expect(s).toContain('r.archived && styles.archived');
    expect(s).toContain('if (rows.length === 0) return null;');
    expect(s).not.toMatch(/順位|ランキング|番目/);
    expect(COPY_POINTS_BY_GOAL).toBe('目標ごと');
  });
  it('ホームには内訳を出さない', () => {
    const h = read('app', '(tabs)', 'index.tsx');
    expect(h).not.toContain('byGoal');
    expect(h).not.toContain('TowerPoints');
    expect(h).not.toContain('GoalPointsList');
  });
});

describe('エビの一言', () => {
  it('増えた時だけ・短く・「！」や答えは無い', () => {
    expect(pointsGained(0)).toBeNull();
    expect(pointsGained(NaN)).toBeNull();
    const l = pointsGained(12)!;
    expect(l.text).toContain('12 shell');
    expect(l.text).not.toMatch(/[！!]/);
    expect(allAgentLines().some((x) => x.text === l.text)).toBe(true);
  });
});

describe('窓口と mock', () => {
  it('http は GET /api/points', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const body: PointsData = { total: 30, today: 12, week: 20, items: [item(6)] };
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    expect(await api.points()).toEqual(body);
    expect(calls[0]!.url).toBe('http://api.test/api/points');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('mock: 何も無ければ 0・集中して振り返ると増える（減らない）', async () => {
    let t = Date.parse('2026-11-08T03:00:00Z');
    const api = createMockApi({ aiDelayMs: 0, now: () => t });
    expect(await api.points()).toEqual({ total: 0, today: 0, week: 0, items: [], byGoal: [] });
    const g = await api.createGoal({ text: '見本の目標', deadline: '2026-11-20T14:59:00Z' });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: '始める' });
    t += 30 * 60_000;
    await api.endSession(s.id);
    const p = await api.points();
    expect(p.today).toBeGreaterThan(0);
    expect(p.total).toBe(p.today);
    expect(p.items.every((x) => x.pt > 0 && x.label !== '')).toBe(true);
    // AI に聞いても減らない
    await api.tutor(s.id, { kind: 'ask', text: 'やり方を教えて' }).catch(() => undefined);
    expect((await api.points()).total).toBeGreaterThanOrEqual(p.total);
  });
});

// 階が積まれなかった時（集中が短すぎた）は、色と窓を言わない（建物の絵と食い違わない・11/9 本人の指摘）
import { builtLine as builtLineNoFloor } from '../lib/agentLines';
describe('階が 0 の時の一言', () => {
  it('色と窓を言わず、pt だけ伝える', () => {
    const l = builtLineNoFloor(10, 2, 'silver', 0);
    expect(l.text).toBe('考えた分が 10 shell。今回は短かったので、階はまだ積んでいません。');
    expect(l.text).not.toContain('窓');
    expect(builtLineNoFloor(0, 0, null, 0).text).not.toContain('積みました');
  });
  it('階が積まれた時は今までどおり', () => {
    expect(builtLineNoFloor(10, 2, 'silver', 1).text).toBe('考えた分が 10 shell、銀の階で窓が 2 つ灯りました。');
  });
});
