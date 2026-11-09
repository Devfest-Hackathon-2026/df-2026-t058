// 週のまとめ（#202）: 建物の上の「今週」のカード（数字 3 つ・AI の文・null の時・読み込み/失敗）と窓口・mock。
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import type { WeeklyResult } from '../api/types';
import * as copy from '../lib/copy';
import { weeklyNumbers } from '../components/WeeklyCard';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const stats = { focusMinutes: 46, sessions: 2, floorsAdded: 3, streak: 2, helpSmall: 1, helpMedium: 0, selfDecided: 70 };

describe('カードの表示', () => {
  const s = read('components', 'WeeklyCard.tsx');
  it('数字は 3 つ（集中した分・積んだ階・連続日数）', () => {
    expect(weeklyNumbers(stats)).toEqual([
      { label: '集中した分', value: '46 分' },
      { label: '積んだ階', value: '3 階' },
      { label: '連続日数', value: '2 日' },
    ]);
    expect(copy.COPY_WEEKLY_TITLE).toBe('今週');
  });
  it('週のまとめの文（Gemini）は普通のカードに出す。文が無い週は数字の 1 行だけ（11/9）', () => {
    expect(s).toContain('firstSentences(data.summary, 2)');
    expect(s).toContain('<Card');
    expect(s).not.toContain('AgentSays');
    expect(s).not.toContain('towerWeekLine');
  });
  it('読み込み中は骨組み、失敗は小さな ErrorBox と「もう一度」', () => {
    expect(s).toContain('testID="weekly-loading"');
    expect(s).toContain('<Skeleton');
    expect(s).toContain('<ErrorBox text={COPY_WEEKLY_FAILED} onRetry={onRetry} />');
    expect(copy.COPY_WEEKLY_FAILED).toBe('今週のまとめを取れませんでした');
  });
  it('色は theme の値だけ', () => {
    expect(s).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/);
  });
  it('建物の画面は、カードを塔の下に置く', () => {
    const t = read('app', '(tabs)', 'tower.tsx');
    expect(t).toContain('useLoad(() => api.weekly())');
    const narrow = t.indexOf('<Screen');
    expect(narrow).toBeGreaterThan(0);
    expect(t.indexOf('{weekly}', narrow)).toBeGreaterThan(t.indexOf('{measured}', narrow));
  });
  it('建物・友達・設定の 3 つのタブに AgentSays（モルティの吹き出し）が無い', () => {
    for (const f of [
      read('app', '(tabs)', 'tower.tsx'),
      read('app', '(tabs)', 'friends.tsx'),
      read('app', 'settings.tsx'),
    ]) {
      expect(f).not.toContain('AgentSays');
    }
    expect(read('app', '(tabs)', 'tower.tsx')).not.toContain('tallyText');
  });
});

describe('窓口と mock', () => {
  it('http は GET /api/weekly', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const body: WeeklyResult = { from: 'a', to: 'b', stats, summary: null, source: 'rules' };
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    expect(await api.weekly()).toEqual(body);
    expect(calls[0]!.url).toBe('http://api.test/api/weekly');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('集中が 0 件の週は summary null・source rules', async () => {
    const t = Date.parse('2026-11-08T03:00:00Z');
    const api = createMockApi({ aiDelayMs: 0, now: () => t });
    const r = await api.weekly();
    expect(r.summary).toBeNull();
    expect(r.source).toBe('rules');
    expect(r.stats).toEqual({ focusMinutes: 0, sessions: 0, floorsAdded: 0, streak: 0, helpSmall: 0, helpMedium: 0, selfDecided: null });
    expect(r.from).toBe('2026-11-01T15:00:00.000Z'); // 今日を含む 7 日（日本時間 11/2 0:00 から）
  });

  it('集中を終えると、回数・連続日数が数えられ、文が付く', async () => {
    const t = Date.parse('2026-11-08T03:00:00Z');
    const api = createMockApi({ aiDelayMs: 0, now: () => t });
    const g = await api.createGoal({ text: '見本の目標', deadline: '2026-11-20T14:59:00Z' });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: '始める' });
    await api.endSession(s.id);
    const r = await api.weekly();
    expect(r.stats.sessions).toBe(1);
    expect(r.stats.streak).toBe(1);
    expect(typeof r.stats.selfDecided).toBe('number');
    expect(r.source).toBe('ai');
    expect(r.summary).toEqual(expect.any(String));
  });
});
