import { calendarUrl, nearestFiveMinutes } from '../lib/calendarLink';

const start = new Date(Date.UTC(2026, 10, 7, 1, 5, 0));

describe('calendarUrl', () => {
  it('日付は UTC の YYYYMMDDTHHMMSSZ で、長さぶん後が終わり', () => {
    const u = calendarUrl({ title: 'a', startAt: start, minutes: 45, details: 'd' });
    expect(u.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&')).toBe(true);
    expect(u).toContain('dates=20261107T010500Z/20261107T015000Z');
  });
  it('日本語と記号をエンコードする', () => {
    const u = calendarUrl({ title: '英単語 & 文法', startAt: start, minutes: 10, details: '10問 解けた' });
    expect(u).toContain(`text=${encodeURIComponent('英単語 & 文法')}`);
    expect(u).toContain(`details=${encodeURIComponent('10問 解けた')}`);
    expect(u).not.toContain(' ');
  });
  it('title は 200 字・details は 500 字に切る', () => {
    const u = new URL(calendarUrl({ title: 'あ'.repeat(300), startAt: start, minutes: 10, details: 'い'.repeat(600) }));
    expect(u.searchParams.get('text')).toHaveLength(200);
    expect(u.searchParams.get('details')).toHaveLength(500);
  });
  it('details が空なら付けない', () => {
    expect(calendarUrl({ title: 'a', startAt: start, minutes: 5 })).not.toContain('details=');
  });
});

describe('nearestFiveMinutes', () => {
  it('最も近い 5 分刻みに丸める', () => {
    expect(nearestFiveMinutes(new Date(Date.UTC(2026, 10, 7, 1, 2, 29))).toISOString()).toBe('2026-11-07T01:00:00.000Z');
    expect(nearestFiveMinutes(new Date(Date.UTC(2026, 10, 7, 1, 2, 31))).toISOString()).toBe('2026-11-07T01:05:00.000Z');
  });
});
