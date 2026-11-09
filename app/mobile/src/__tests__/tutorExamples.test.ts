import { BAR_MARK, tutorExamples } from '../lib/tutorExamples';

describe('tutorExamples', () => {
  it('今日の題と目印から、1 種類の札を作る（頭の語・種類は無い）', () => {
    const ex = tutorExamples({ title: '二次方程式の解の公式', doneMark: '3 問解けた' });
    expect(ex).toHaveLength(2);
    expect(ex.every((e) => Object.keys(e).join() === 'text')).toBe(true);
    expect(ex[0]!.text).toBe('二次方程式の解の公式のどこで止まっているか確かめたい');
    expect(ex[1]!.text).toContain('3 問解けた');
    for (const e of ex) expect(e.text).not.toMatch(/^(質問する|調べてもらう|聞く:|調べる:)/);
  });
  it('長い題は切る・空の物は出さない', () => {
    expect(tutorExamples({ title: 'あ'.repeat(100), doneMark: ' ' })).toHaveLength(1);
    expect(tutorExamples({ title: 'あ'.repeat(100) })[0]!.text.startsWith('あ'.repeat(40) + '…')).toBe(true);
    expect(tutorExamples(null)).toEqual([]);
  });
  it('棒の言葉は、ヒントとやり方で違う', () => {
    expect(BAR_MARK.small).toBe('ヒント');
    expect(BAR_MARK.medium).toBe('やり方');
    expect(BAR_MARK.small).not.toBe(BAR_MARK.medium);
  });
});
