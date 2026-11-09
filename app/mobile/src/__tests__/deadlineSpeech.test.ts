// 話した文から期限を読み取る（足す場面・#315）
import { goalFromSaid, heardDeadline, onlyDeadline } from '../lib/deadlineSpeech';

// 2026-11-09（月）の昼
const now = new Date(2026, 10, 9, 12, 0, 0);
const md = (d: Date | undefined) => (d ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}` : null);
const read = (s: string) => md(heardDeadline(s, now)?.date);

describe('heardDeadline', () => {
  test.each([
    ['線形代数の期末で 8 割取りたい。試験は来週の金曜', '11/20 23:59'],
    ['今週の金曜まで', '11/13 23:59'],
    ['金曜日まで', '11/13 23:59'],
    ['月曜', '11/16 23:59'],
    ['11/20 までにレポート', '11/20 23:59'],
    ['１１月２０日', '11/20 23:59'],
    ['3 日後', '11/12 23:59'],
    ['2週間で', '11/23 23:59'],
    ['1 か月', '12/9 23:59'],
    ['明日まで', '11/10 23:59'],
    ['あさって', '11/11 23:59'],
    ['1/10 の試験', '1/10 23:59'],
  ])('%s → %s', (s, want) => {
    expect(read(s)).toBe(want);
  });

  test('読めない・ありえない日は null', () => {
    expect(read('英語を頑張りたい')).toBeNull();
    expect(read('2/31')).toBeNull();
    expect(read('今週の月曜')).toBeNull();
  });
});

describe('onlyDeadline', () => {
  test('期限だけの言い直しか', () => {
    const s1 = '期限は来週の金曜で';
    expect(onlyDeadline(s1, heardDeadline(s1, now))).toBe(true);
    const s2 = '線形代数の期末で 8 割。来週の金曜';
    expect(onlyDeadline(s2, heardDeadline(s2, now))).toBe(false);
    expect(onlyDeadline('英語', null)).toBe(false);
  });
});

describe('goalFromSaid', () => {
  test('期限の言い回しを抜いて目標の文にする', () => {
    const s = '線形代数の期末で 8 割取りたい。試験は来週の金曜';
    const g = (x: string) => goalFromSaid(x, heardDeadline(x, now));
    expect(g(s)).toBe('線形代数の期末で 8 割取りたい');
    expect(g('11/20 までにレポートを出す')).toBe('レポートを出す');
    expect(g('英語を頑張りたい')).toBe('英語を頑張りたい');
  });
});
