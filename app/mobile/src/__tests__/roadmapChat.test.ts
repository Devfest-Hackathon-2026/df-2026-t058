// ロードマップをモルティに頼んで直す（#262 の画面・11/9）。確定は「これで決める」だけ（P1）
declare const require: (name: string) => any;
declare const __dirname: string;
import { createMockApi } from '../api/mock';

const fs = require('fs');
const path = require('path');
const planSrc: string = fs.readFileSync(path.join(__dirname, '..', 'app', 'plan', '[goalId].tsx'), 'utf8');

describe('画面の原稿', () => {
  it('話しかける欄 1 つで進む: 理由を聞いている段＝決める／案を選んだ・自分で作る＝道を直す／選ぶ前＝案を出し直す', () => {
    const fn = planSrc.slice(planSrc.indexOf('async function sendTalk'), planSrc.indexOf('const talkLine'));
    expect(fn.indexOf('decideWith(message)')).toBeLessThan(fn.indexOf('askMolty()'));
    expect(fn.indexOf('askMolty()')).toBeLessThan(fn.indexOf('make(candidatesBody(message).note)'));
    expect(planSrc).toContain('api.roadmapChat(goalId, { message, draft: base, history: askHistory.current })');
  });
  it('そのままの案を頼んで直したら「直す」に切り替わる（直した割合が出る）。確定はしない', () => {
    const fn = planSrc.slice(planSrc.indexOf('async function askMolty'), planSrc.indexOf('setAsking(false)'));
    expect(fn).toContain("setMode('edit')");
    expect(fn).not.toContain('decideRoadmap');
  });
  it('「これにする」の後は理由を聞き、話すか一言で決まる（理由は必須のまま・P1・札は並べない）', () => {
    expect(planSrc).toContain('setConfirming(true)');
    expect(planSrc).not.toContain('onPress={() => void decideWith(t)}');
    const fn = planSrc.slice(planSrc.indexOf('async function decideWith'), planSrc.indexOf('async function sendTalk'));
    expect(fn).toContain('if (!w || busy) return;');
    expect(fn).toContain('decideRequest({ mode, chosen, ratio, steps, why: w })');
  });
});

describe('モック', () => {
  it('下書きを 3〜6 件で返し、「短く」なら 3 件。確定後は 409', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    const g = await api.createGoal({ text: '英検2級', deadline: new Date(Date.now() + 7 * 864e5).toISOString() } as never);
    const steps = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, doneMark: `d${i}` }));
    const r = await api.roadmapChat(g.id, { message: '短くして', draft: steps });
    expect(r.draft).toHaveLength(3);
    expect(r.reply.length).toBeGreaterThan(0);
    const r2 = await api.roadmapChat(g.id, { message: '整えて', draft: [] });
    expect(r2.draft).toHaveLength(3);
    await expect(api.roadmapChat(g.id, { message: '' })).rejects.toMatchObject({ status: 400 });
  });
});
