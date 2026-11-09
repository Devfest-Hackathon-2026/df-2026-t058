import { decideRequest, decideTargetLine, modeAfterChoose, type PlanMode } from '../lib/planView';

const step = { title: ' やる ', doneMark: ' 済 ', estimateMin: 10 };
const A = { id: 'cand-a' };
const B = { id: 'cand-b' };

describe('案のタップで対象が合う', () => {
  it('「自分で作る」の後に案をタップすると pick に戻り、案の ID を送る（自作は残る）', () => {
    let mode: PlanMode = 'own';
    const own = [step];
    mode = modeAfterChoose();
    expect(mode).toBe('pick');
    const r = decideRequest({ mode, chosen: B, ratio: 0, steps: [step], why: 'w' });
    expect(r.source).toBe('candidate');
    expect(r.candidateId).toBe('cand-b');
    expect(own).toHaveLength(1);
  });

  it('「直す」の後に別の案をタップ: pick・別の案の ID・元の案の直した中身は残る', () => {
    const edits: Record<string, unknown[]> = { 'cand-a': [step, step] };
    const mode = modeAfterChoose();
    expect(mode).toBe('pick');
    expect(decideRequest({ mode, chosen: B, ratio: 0, steps: [step], why: 'w' }).candidateId).toBe('cand-b');
    expect(edits['cand-a']).toHaveLength(2);
  });
});

describe('decideTargetLine と decideRequest の一致', () => {
  it('pick', () => {
    expect(decideTargetLine({ mode: 'pick', chosenName: 'A', ratio: 0 })).toBe('「A」で決めます');
    const r = decideRequest({ mode: 'pick', chosen: A, ratio: 0, steps: [step], why: 'w' });
    expect([r.source, r.candidateId]).toEqual(['candidate', 'cand-a']);
  });
  it('edit 割合 > 0', () => {
    expect(decideTargetLine({ mode: 'edit', chosenName: 'A', ratio: 0.4 })).toBe('「A」を 40% 直して決めます');
    const r = decideRequest({ mode: 'edit', chosen: A, ratio: 0.4, steps: [step], why: 'w' });
    expect([r.source, r.candidateId]).toEqual(['edited', 'cand-a']);
  });
  it('edit 割合 0', () => {
    expect(decideTargetLine({ mode: 'edit', chosenName: 'A', ratio: 0 })).toBe('「A」で決めます');
    const r = decideRequest({ mode: 'edit', chosen: A, ratio: 0, steps: [step], why: 'w' });
    expect([r.source, r.candidateId]).toEqual(['candidate', 'cand-a']);
  });
  it('own: candidateId を送らない（案が選ばれていても）', () => {
    expect(decideTargetLine({ mode: 'own', chosenName: 'A', ratio: 0 })).toBe('自分で作った道で決めます');
    const r = decideRequest({ mode: 'own', chosen: A, ratio: 0, steps: [step], why: 'w' });
    expect(r.source).toBe('own');
    expect('candidateId' in r).toBe(false);
    // 自作は案から来た行が無いので、分を付けない（サーバーが決める・#268）
    expect(r.checkpoints[0]).toEqual({ title: 'やる', doneMark: '済' });
  });
  it('見積りの分（#268）: 案から来た行は元の分あり・足した行と直した行は分なし', () => {
    const cand = {
      id: 'cand-a',
      checkpoints: [
        { title: 'やる', doneMark: '済', estimateMin: 10 },
        { title: '読む', doneMark: '読めた', estimateMin: 25 },
        { title: '書く', doneMark: '書けた', estimateMin: 40 },
      ],
    };
    const steps = [
      { title: ' 読む ', doneMark: '読めた', estimateMin: 25 }, // 並べ替えた元の行（前後の空白は無視）
      { title: '直した題', doneMark: '済', estimateMin: 10 }, // 題を直した行（手元の古い分は送らない）
      { title: '足した', doneMark: '足せた' }, // ＋ 足す の行
      { title: '書く', doneMark: '書けた', estimateMin: 999 }, // 元の行は元の分を使う
    ];
    const r = decideRequest({ mode: 'edit', chosen: cand, ratio: 0.5, steps, why: 'w' });
    expect(r.checkpoints).toEqual([
      { title: '読む', doneMark: '読めた', estimateMin: 25 },
      { title: '直した題', doneMark: '済' },
      { title: '足した', doneMark: '足せた' },
      { title: '書く', doneMark: '書けた', estimateMin: 40 },
    ]);
    expect(r.checkpoints.map((c) => 'estimateMin' in c)).toEqual([true, false, false, true]);
  });
  it('未選択では行が出ない（own 以外）', () => {
    expect(decideTargetLine({ mode: 'pick', chosenName: null, ratio: 0 })).toBeNull();
    expect(decideTargetLine({ mode: 'edit', chosenName: null, ratio: 0 })).toBeNull();
  });
});
