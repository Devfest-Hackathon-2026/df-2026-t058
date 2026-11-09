import { createMockApi } from '../api/mock';
import { optionAsk, thoughtLine } from '../lib/reflectView';
import { copyThoughtLine } from '../lib/copy';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

async function started() {
  let t = Date.parse('2026-11-05T01:00:00Z');
  const api = createMockApi({ now: () => t, aiDelayMs: 0 });
  const g = await api.createGoal({ text: '英単語', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
  const { candidates } = await api.makeCandidates(g.id);
  const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: '確実', checkpoints: [] });
  const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: '10 個' });
  return { api, s, advance: (min: number) => void (t += min * 60_000) };
}

describe('thoughtLine（考えてから聞いた ◯/◯ 回）', () => {
  test('0 回は出さない', () => {
    expect(thoughtLine(0, 0)).toBeNull();
    expect(thoughtLine(undefined, undefined)).toBeNull();
  });
  test('全部・一部・考えなし', () => {
    expect(thoughtLine(3, 3)).toBe('考えてから聞いた 3/3 回');
    expect(thoughtLine(4, 1)).toBe('考えてから聞いた 1/4 回');
    expect(thoughtLine(2, 0)).toBe('考えてから聞いた 0/2 回');
    expect(thoughtLine(2, undefined)).toBe('考えてから聞いた 0/2 回');
  });
  test('不正な数: 相談の回数が数でない・負は出さない。考えの回数は 0〜相談の回数に収める', () => {
    expect(thoughtLine(NaN, 1)).toBeNull();
    expect(thoughtLine(Infinity, 1)).toBeNull();
    expect(thoughtLine(-2, 1)).toBeNull();
    expect(thoughtLine(3, 9)).toBe('考えてから聞いた 3/3 回');
    expect(thoughtLine(3, -1)).toBe('考えてから聞いた 0/3 回');
    expect(thoughtLine(3, NaN)).toBe('考えてから聞いた 0/3 回');
  });
  test('責める語・評価の語を入れない', () => {
    const s = copyThoughtLine(2, 1);
    for (const w of ['だけ', 'しか', '少ない', '足りない', '良い', '悪い', '偉い', 'すごい']) expect(s).not.toContain(w);
  });
});

describe('optionAsk（候補を押した時に送る内容）', () => {
  test('質問文は「札の名前: 候補」・thought は候補の文・intent は札のとおり', () => {
    expect(optionAsk('手が止まった', 'stuck', '途中で考えが合わない', '')).toEqual({
      text: '手が止まった: 途中で考えが合わない',
      thought: '途中で考えが合わない',
      intent: 'stuck',
    });
    expect(optionAsk('合ってるか確認', 'check', '途中の手順', '').intent).toBe('check');
  });
  test('ひとこと足したら thought の後ろに足す（空白だけなら足さない）', () => {
    expect(optionAsk('手が止まった', 'stuck', '用語が思い出せない', ' 判別式 ').thought).toBe('用語が思い出せない 判別式');
    expect(optionAsk('手が止まった', 'stuck', '用語が思い出せない', '   ').thought).toBe('用語が思い出せない');
  });
});

describe('mock: stuckOptions と asks / thoughtAsks', () => {
  test('札ごとに 3〜4 個の候補（id と label）・固定', async () => {
    const { api, s } = await started();
    for (const intent of ['stuck', 'check'] as const) {
      const r = await api.stuckOptions(s.id, intent);
      expect(r.source).toBe('fixed');
      expect(r.options.length).toBeGreaterThanOrEqual(3);
      expect(r.options.length).toBeLessThanOrEqual(4);
      for (const o of r.options) expect(o.label.length).toBeLessThanOrEqual(24);
    }
  });
  test('無い集中は 404・終わった集中は 409・intent が違えば 400', async () => {
    const { api, s, advance } = await started();
    await expect(api.stuckOptions('nope', 'stuck')).rejects.toMatchObject({ status: 404 });
    await expect(api.stuckOptions(s.id, 'free' as any)).rejects.toMatchObject({ status: 400 });
    advance(6);
    await api.endSession(s.id);
    await expect(api.stuckOptions(s.id, 'stuck')).rejects.toMatchObject({ status: 409 });
  });
  test('thought 付きの相談を数え、階に asks / thoughtAsks が載る', async () => {
    const { api, s, advance } = await started();
    await api.tutor(s.id, { text: '手が止まった: 途中の手順', intent: 'stuck', thought: '途中の手順' });
    await api.tutor(s.id, { text: '普通に聞く' });
    await api.tutor(s.id, { text: 'もう 1 回', thought: '   ' });
    advance(6);
    const e = await api.endSession(s.id);
    expect(e.floor.asks).toBe(3);
    expect(e.floor.thoughtAsks).toBe(1);
  });
  test('thought が 300 字超・型違いは 400', async () => {
    const { api, s } = await started();
    await expect(api.tutor(s.id, { text: 'a', thought: 'あ'.repeat(301) })).rejects.toMatchObject({ status: 400 });
    await expect(api.tutor(s.id, { text: 'a', thought: 5 as any })).rejects.toMatchObject({ status: 400 });
  });
});

describe('画面の部品（TutorChat・振り返り・建物）', () => {
  const chat = read('components', 'TutorChat.tsx');
  test('札で候補を読み込み、読み込み中は Skeleton（固定の候補で先に出さない）', () => {
    expect(chat).toContain('api\n      .stuckOptions(sessionId, card)');
    expect(chat).toContain('stuck-options-loading');
    expect(chat).toContain('<Skeleton');
  });
  test('候補を押すと thought と intent を付けて送る', () => {
    expect(chat).toContain('stuck-option-${i}');
    expect(chat).toContain('onPress={() => void sendOption(o.label)}');
    expect(chat).toContain('api.tutor(id, { ...body, intent: a.intent, thought: a.thought })');
    expect(chat).toContain('optionAsk(cardLabel, intent, label, extra)');
  });
  test('ひとこと足す欄があり、普通に聞く道（thought なし）は今までどおり残る', () => {
    expect(chat).toContain('stuck-option-extra');
    expect(chat).toContain('COPY_OPTION_NOTE');
    expect(chat).toContain('askTutor(withIntent(api.tutor, intentOf(sentCard))');
    expect(chat).toContain('testID="tutor-input"');
    expect(chat).toContain('testID="tutor-send"');
  });
  test('建物の階の記録に 1 行ある（振り返りは数字や行を並べず、モルティの一言で伝える・#315）', () => {
    expect(read('app', '(tabs)', 'tower.tsx')).toContain('thoughtLine(rec.floor.asks, rec.floor.thoughtAsks)');
  });
  test('http の stuckOptions は契約のパスと body', () => {
    const h = read('api', 'http.ts');
    expect(h).toContain('/stuck-options`, { intent }');
  });
});
