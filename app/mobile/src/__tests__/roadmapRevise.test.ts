// ロードマップの見直し（#353・#359）: 進み具合の規則・持ちかけの条件・見本の直し方・置き換え・窓口・画面の作り
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import type { Checkpoint } from '../api/types';
import { allAgentLines, reviseOffer, sentences } from '../lib/agentLines';
import { COPY_REVISE_APPLY, COPY_REVISE_HINT, COPY_REVISE_KEEP, COPY_REVISE_OPEN } from '../lib/copy';
import { rememberReviseOffer, reviseOfferedOn } from '../lib/local';
import {
  fakeRevise,
  FINISH_STEP,
  jstDayKey,
  normalizeDraft,
  paceOf,
  remainingDraft,
  reviseRoadSteps,
  shouldOfferRevise,
} from '../lib/roadmapRevise';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
});

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, p), 'utf8');

const cp = (i: number, estimateMin: number, state: Checkpoint['state'] = 'todo'): Checkpoint => ({
  id: `c${i}`,
  order: i,
  title: `やること${i}`,
  doneMark: `目印${i}`,
  estimateMin,
  state,
  achievement: null,
});

// 日本時間 11/9 12:00
const NOW = Date.parse('2026-11-09T03:00:00Z');
// 日本時間の n 日後の 23:59
const deadlineIn = (n: number) => new Date(Date.parse('2026-11-09T14:59:00Z') + n * 86_400_000).toISOString();

describe('進み具合 paceOf（契約 §3.3 の規則）', () => {
  const rm = (cps: Checkpoint[]) => ({ checkpoints: cps });

  test('見込みが使える時間を超えると behind（今日を含む日数 × 1 日の時間）', () => {
    // 今日と明日の 2 日 × 30 分 = 60 分。残り 70 分
    expect(paceOf({ roadmap: rm([cp(1, 40), cp(2, 30)]), deadline: deadlineIn(1), minutesPerDay: 30, now: NOW })).toBe('behind');
    // ちょうど 60 分は behind ではない
    expect(paceOf({ roadmap: rm([cp(1, 30), cp(2, 30)]), deadline: deadlineIn(1), minutesPerDay: 30, now: NOW })).toBe('ok');
  });

  test('終わった物は数えない・見込みの無い行は 30・1 日の時間が null なら 60', () => {
    expect(paceOf({ roadmap: rm([cp(1, 500, 'done'), cp(2, 30)]), deadline: deadlineIn(0), minutesPerDay: 30, now: NOW })).toBe('ok');
    expect(paceOf({ roadmap: rm([cp(1, 0), cp(2, 0), cp(3, 0)]), deadline: deadlineIn(0), minutesPerDay: 60, now: NOW })).toBe('behind'); // 90 > 60
    expect(paceOf({ roadmap: rm([cp(1, 60)]), deadline: deadlineIn(0), minutesPerDay: null, now: NOW })).toBe('ok');
    expect(paceOf({ roadmap: rm([cp(1, 61)]), deadline: deadlineIn(0), minutesPerDay: null, now: NOW })).toBe('behind');
  });

  test('ahead は見込みが 3 分の 1 以下で、かつ期限まで 3 日以上', () => {
    // 3 日 × 60 = 180。60 分は 3 分の 1 ちょうど
    expect(paceOf({ roadmap: rm([cp(1, 60)]), deadline: deadlineIn(2), minutesPerDay: 60, now: NOW })).toBe('ahead');
    expect(paceOf({ roadmap: rm([cp(1, 61)]), deadline: deadlineIn(2), minutesPerDay: 60, now: NOW })).toBe('ok');
    // 2 日しかなければ、少なくても ok
    expect(paceOf({ roadmap: rm([cp(1, 5)]), deadline: deadlineIn(1), minutesPerDay: 60, now: NOW })).toBe('ok');
  });

  test('ロードマップが無い・期限が無い・期限を過ぎた・未完了が 0 は null', () => {
    expect(paceOf({ roadmap: null, deadline: deadlineIn(3), minutesPerDay: 30, now: NOW })).toBeNull();
    expect(paceOf({ roadmap: rm([cp(1, 30)]), deadline: null, minutesPerDay: 30, now: NOW })).toBeNull();
    expect(paceOf({ roadmap: rm([cp(1, 30)]), deadline: deadlineIn(-1), minutesPerDay: 30, now: NOW })).toBeNull();
    expect(paceOf({ roadmap: rm([cp(1, 30, 'done')]), deadline: deadlineIn(3), minutesPerDay: 30, now: NOW })).toBeNull();
  });
});

describe('持ちかけの条件 shouldOfferRevise', () => {
  test('遅れ・先行で、今日まだ持ちかけていない時だけ', () => {
    expect(shouldOfferRevise('behind', null, '2026-11-09')).toBe(true);
    expect(shouldOfferRevise('ahead', '2026-11-08', '2026-11-09')).toBe(true);
    expect(shouldOfferRevise('behind', '2026-11-09', '2026-11-09')).toBe(false);
    expect(shouldOfferRevise('ahead', '2026-11-09', '2026-11-09')).toBe(false);
  });
  test('ok・null・古いサーバー（pace 無し）は持ちかけない', () => {
    expect(shouldOfferRevise('ok', null, '2026-11-09')).toBe(false);
    expect(shouldOfferRevise(null, null, '2026-11-09')).toBe(false);
    expect(shouldOfferRevise(undefined, null, '2026-11-09')).toBe(false);
  });
  test('日は日本時間の暦日で数える', () => {
    expect(jstDayKey(Date.parse('2026-11-09T14:59:59Z'))).toBe('2026-11-09');
    expect(jstDayKey(Date.parse('2026-11-09T15:00:00Z'))).toBe('2026-11-10');
  });
  test('持ちかけた日を目標ごとに端末に覚える', async () => {
    expect(await reviseOfferedOn('g1')).toBeNull();
    await rememberReviseOffer('g1', '2026-11-09');
    expect(await reviseOfferedOn('g1')).toBe('2026-11-09');
    expect(await reviseOfferedOn('g2')).toBeNull();
  });
});

describe('見本の直し方とロードマップの絵', () => {
  const d3 = normalizeDraft([cp(1, 30), cp(2, 30), cp(3, 30)]);
  test('behind は最後の 1 個を外す・ahead は仕上げを足す・ok はそのまま', () => {
    expect(fakeRevise('behind', d3, 1)).toEqual(d3.slice(0, 2));
    expect(fakeRevise('ahead', d3, 0)).toEqual([...d3, FINISH_STEP]);
    expect(fakeRevise('ok', d3, 0)).toEqual(d3);
    expect(fakeRevise(null, d3, 0)).toEqual(d3);
  });
  test('合計が 3〜12 個から外れる時は外さない・足さない', () => {
    expect(fakeRevise('behind', d3, 0)).toEqual(d3); // 外すと 2 個
    expect(fakeRevise('ahead', d3, 9)).toEqual(d3); // 足すと 13 個
  });
  test('下書きの形: 空の行を外し、見込みは 5〜240', () => {
    expect(normalizeDraft([{ title: ' a ', doneMark: 'b', estimateMin: 1 }, { title: '', doneMark: 'x' }, { title: 'c', doneMark: 'd', estimateMin: 999 }])).toEqual([
      { title: 'a', doneMark: 'b', estimateMin: 5 },
      { title: 'c', doneMark: 'd', estimateMin: 240 },
    ]);
  });
  test('終わった物を済みの見た目で前に、下書きの残りをその後に', () => {
    const cps = [cp(1, 30, 'done'), cp(2, 30, 'doing'), cp(3, 30)];
    expect(remainingDraft(cps).map((c) => c.title)).toEqual(['やること2', 'やること3']);
    expect(reviseRoadSteps(cps, [{ title: '新', doneMark: '新しい目印' }])).toEqual([
      { title: 'やること1', doneMark: '目印1', done: true },
      { title: '新', doneMark: '新しい目印' },
    ]);
  });
});

describe('mock の見直しと置き換え', () => {
  async function planned(deadline: string, minutesPerDay: number) {
    let t = NOW;
    const api = createMockApi({ aiDelayMs: 0, now: () => t });
    const g = await api.createGoal({ text: '見本', deadline, minutesPerDay });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    return { api, g, rm, tick: (ms: number) => (t += ms) };
  }

  test('遅れ: pace は behind・最初の案は最後を外す・話した後は下書きのまま・保存しない', async () => {
    const { api, g, rm } = await planned(deadlineIn(1), 15);
    expect((await api.getGoal(g.id)).pace).toBe('behind');
    const r = await api.reviseRoadmap(g.id, {});
    expect(r.pace).toBe('behind');
    expect(r.draft.map((c) => c.title)).toEqual(rm.checkpoints.slice(0, -1).map((c) => c.title));
    expect(r.reply.length).toBeGreaterThan(0);
    const r2 = await api.reviseRoadmap(g.id, { message: 'これでいい', draft: r.draft, history: [{ from: 'agent', text: r.reply }] });
    expect(r2.draft).toEqual(r.draft);
    expect((await api.getGoal(g.id)).roadmap!.checkpoints).toHaveLength(rm.checkpoints.length);
  });

  test('先行: 仕上げを 1 個足す', async () => {
    const { api, g, rm } = await planned(deadlineIn(10), 120);
    expect((await api.getGoal(g.id)).pace).toBe('ahead');
    const r = await api.reviseRoadmap(g.id, {});
    expect(r.draft).toHaveLength(rm.checkpoints.length + 1);
    expect(r.draft[r.draft.length - 1]!.title).toBe(FINISH_STEP.title);
  });

  test('置き換え: 終わった物を前に残し、残りは新しい ID の todo・理由は変えない', async () => {
    const { api, g, rm, tick } = await planned(deadlineIn(10), 120);
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'a' });
    tick(20 * 60_000);
    await api.endSession(s.id);
    await api.reflect(s.id, { note: '', done: false, images: [{ mimeType: 'image/jpeg', dataBase64: 'A'.repeat(400) }], materials: '' }); // 偽の判定は 3＝完了
    const next = await api.replaceRemaining(g.id, [
      { title: 'まとめ', doneMark: 'まとめられた' },
      { title: '見直し', doneMark: '見直せた', estimateMin: 45 },
    ]);
    expect(next.checkpoints.map((c) => c.title)).toEqual([rm.checkpoints[0]!.title, 'まとめ', '見直し']);
    expect(next.checkpoints[0]!.id).toBe(rm.checkpoints[0]!.id);
    expect(next.checkpoints[0]!.state).toBe('done');
    expect(next.checkpoints.slice(1).every((c) => c.state === 'todo' && !rm.checkpoints.some((o) => o.id === c.id))).toBe(true);
    expect(next.checkpoints.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(next.checkpoints[1]!.estimateMin).toBe(30);
    expect(next.why).toBe(rm.why);
    expect(next.adopted).toBe(rm.adopted);
  });

  test('置き換え: 合計が 3 個未満は 400・進行中の集中があるチェックポイントが消える時は 409・道が無ければ 404', async () => {
    const { api, g, rm } = await planned(deadlineIn(10), 120);
    await expect(api.replaceRemaining(g.id, [{ title: 'a', doneMark: 'b' }])).rejects.toMatchObject({ status: 400 });
    await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[1]!.id, oneLine: 'a' });
    const three = [1, 2, 3].map((i) => ({ title: `t${i}`, doneMark: `d${i}` }));
    await expect(api.replaceRemaining(g.id, three)).rejects.toMatchObject({ status: 409, code: 'conflict' });
    const other = await api.createGoal({ text: '道なし', deadline: deadlineIn(3) });
    await expect(api.replaceRemaining(other.id, three)).rejects.toMatchObject({ status: 404 });
    await expect(api.reviseRoadmap(other.id, {})).rejects.toMatchObject({ status: 404 });
    expect((await api.getGoal(other.id)).pace).toBeNull();
  });

  test('revise の入力: message は 1〜300 字・下書きは 8 件まで', async () => {
    const { api, g } = await planned(deadlineIn(10), 120);
    await expect(api.reviseRoadmap(g.id, { message: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(api.reviseRoadmap(g.id, { message: 'あ'.repeat(301) })).rejects.toMatchObject({ status: 400 });
    const nine = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, doneMark: 'd' }));
    await expect(api.reviseRoadmap(g.id, { draft: nine })).rejects.toMatchObject({ status: 400 });
  });
});

describe('窓口（http）', () => {
  it('revise は POST …/roadmap/revise・remaining は PUT …/roadmap/remaining に { checkpoints }', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith('/revise') ? { reply: 'r', draft: [], pace: 'ok' } : { id: 'rm' };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    await api.reviseRoadmap('g 1', { message: 'm' });
    await api.replaceRemaining('g 1', [{ title: 'a', doneMark: 'b' }]);
    expect(calls[0]!.url).toBe('http://api.test/api/goals/g%201/roadmap/revise');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ message: 'm' });
    expect(calls[1]!.url).toBe('http://api.test/api/goals/g%201/roadmap/remaining');
    expect(calls[1]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ checkpoints: [{ title: 'a', doneMark: 'b' }] });
  });
});

describe('言葉と画面の作り', () => {
  test('持ちかけの一言は 2 文まで・一覧に入る・「道」と書かない', () => {
    for (const p of ['behind', 'ahead'] as const) {
      const l = reviseOffer(p);
      expect(sentences(l.text).length).toBeLessThanOrEqual(2);
      expect(allAgentLines().some((x) => x.text === l.text)).toBe(true);
      expect(l.text).not.toContain('道');
      expect(l.text).not.toMatch(/AI|[0-9]+ ?分/);
    }
    for (const c of [COPY_REVISE_OPEN, COPY_REVISE_APPLY, COPY_REVISE_KEEP, COPY_REVISE_HINT]) expect(c).not.toContain('道');
    expect(COPY_REVISE_OPEN).toBe('ロードマップを直す');
    expect(COPY_REVISE_APPLY).toBe('この形にする');
    expect(COPY_REVISE_KEEP).toBe('今のまま');
  });

  test('見直しの画面: 準備の帯・やめる・モルティ・ロードマップの絵（日付なし）・マイク・2 つのボタン', () => {
    const s = read('../app/revise/[goalId].tsx');
    expect(s).toContain('<SceneTop scene="plan"');
    expect(s).toContain('COPY_PREP_QUIT');
    expect(s).toContain('api.reviseRoadmap(goalId, {})');
    expect(s).toContain('<AgentSays');
    expect(s).toContain('deadlineLabel={null}');
    expect(s).toContain('<MicRow');
    expect(s).toContain('api.replaceRemaining(goalId, draft)');
    expect(s).toContain('COPY_REVISE_APPLY');
    expect(s).toContain('COPY_REVISE_KEEP');
    expect(s).not.toContain('formatDeadline');
    expect(s).not.toContain('estimateMin}');
  });

  test('振り返りの最後: 条件は純関数で決め、持ちかけは「今日の画面へ」の上', () => {
    const s = read('../app/reflect/[sessionId].tsx');
    expect(s).toContain('shouldOfferRevise(d.pace, last, today)');
    expect(s.indexOf('testID="revise-open"')).toBeGreaterThan(0);
    expect(s.indexOf('testID="revise-open"')).toBeLessThan(s.indexOf('testID="go-home"'));
  });
});
