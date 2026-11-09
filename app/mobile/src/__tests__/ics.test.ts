// .ics の読み込み（Issue #198）。予定はすべて作り物。
declare const require: (name: string) => any;
declare const __dirname: string;

import { icsFileToText, icsToText, ICS_MAX_EVENTS, parseIcs, upcomingEvents } from '../lib/ics';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const NOW = new Date(2026, 10, 8, 12, 0, 0);
const ev = (lines: string[]): string => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

describe('parseIcs', () => {
  test('3 種類の日時の形と TZID', () => {
    const out = parseIcs(
      [
        ev(['SUMMARY:日付だけ', 'DTSTART;VALUE=DATE:20261120']),
        ev(['SUMMARY:端末の時刻', 'DTSTART:20261121T093000']),
        ev(['SUMMARY:世界時', 'DTSTART:20261122T000000Z']),
        ev(['SUMMARY:場所つき', 'DTSTART;TZID=Asia/Tokyo:20261123T101500']),
        ev(['SUMMARY:引用符つき', 'DTSTART;TZID="Asia/Tokyo":20261124T101500']),
      ].join('\r\n'),
    );
    expect(out).toHaveLength(5);
    expect(out[0]?.start).toEqual(new Date(2026, 10, 20, 0, 0, 0));
    expect(out[1]?.start).toEqual(new Date(2026, 10, 21, 9, 30, 0));
    expect(out[2]?.start).toEqual(new Date(Date.UTC(2026, 10, 22, 0, 0, 0)));
    expect(out[3]?.start).toEqual(new Date(2026, 10, 23, 10, 15, 0));
    expect(out[4]?.start).toEqual(new Date(2026, 10, 24, 10, 15, 0));
  });

  test('行の折り返しを戻す・エスケープを戻す・詳細は 200 字まで', () => {
    const out = parseIcs(
      ev(['SUMMARY:レポート\\, 第1回\\; 提', ' 出', 'DTSTART:20261120T090000', `DESCRIPTION:一行目\\n二行目\\\\${'あ'.repeat(300)}`]),
    );
    expect(out[0]?.summary).toBe('レポート, 第1回; 提出');
    expect(out[0]?.description.startsWith('一行目 二行目\\')).toBe(true);
    expect(out[0]?.description).toHaveLength(200);
  });

  test('壊れた予定は飛ばす・空のファイルでも落ちない', () => {
    const bad = [
      ev(['SUMMARY:日付なし']),
      ev(['SUMMARY:日付が壊れた', 'DTSTART:あした']),
      ev(['SUMMARY:2 月 30 日', 'DTSTART:20260230']),
      ev(['DTSTART:20261120']),
      ev(['SUMMARY:正常', 'DTSTART:20261120']),
    ].join('\r\n');
    expect(parseIcs(bad).map((e) => e.summary)).toEqual(['正常']);
    expect(parseIcs('')).toEqual([]);
    expect(parseIcs('ゴミの文')).toEqual([]);
    expect(icsFileToText('', NOW)).toBe('');
  });

  test('RRULE は展開しない・VALARM の DESCRIPTION は読まない・場所や参加者は取らない', () => {
    const out = parseIcs(
      [
        'BEGIN:VEVENT',
        'SUMMARY:毎週の会',
        'DTSTART:20261120T090000',
        'RRULE:FREQ=WEEKLY;COUNT=10',
        'LOCATION:どこかの部屋',
        'ATTENDEE:mailto:someone@example.invalid',
        'BEGIN:VALARM',
        'DESCRIPTION:通知の文',
        'END:VALARM',
        'DESCRIPTION:本文',
        'END:VEVENT',
      ].join('\n'),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.description).toBe('本文');
    expect(icsToText(out)).not.toMatch(/どこかの部屋|example|mailto/);
  });
});

describe('upcomingEvents / icsToText', () => {
  const at = (days: number, h = 9): Date => new Date(2026, 10, 8 + days, h, 0, 0);

  test('今日から 60 日以内だけ（今日の朝は入る・昨日と 61 日後は外す）', () => {
    const events = [
      { summary: '昨日', start: at(-1), description: '' },
      { summary: '今日の朝', start: at(0, 7), description: '' },
      { summary: '60 日後', start: at(60), description: '' },
      { summary: '61 日後', start: at(61), description: '' },
    ];
    expect(upcomingEvents(events, NOW).map((e) => e.summary)).toEqual(['今日の朝', '60 日後']);
  });

  test('開始の近い順・50 件まで', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({ summary: `予定${i}`, start: at(1 + ((i * 7) % 59)), description: '' }));
    const out = upcomingEvents(events, NOW);
    expect(out).toHaveLength(ICS_MAX_EVENTS);
    const times = out.map((e) => e.start.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('1 予定 1 行・詳細があれば括弧で足す', () => {
    const text = icsToText([
      { summary: 'レポート', start: new Date(2026, 10, 20, 9, 5), description: '第 3 回' },
      { summary: '小テスト', start: new Date(2026, 10, 21, 0, 0), description: '' },
    ]);
    expect(text).toBe('2026-11-20 09:05 レポート（第 3 回）\n2026-11-21 00:00 小テスト');
  });

  test('ファイル → 文（全部つないだ流れ）', () => {
    const file = ev(['SUMMARY:課題の提出', 'DTSTART:20261201T230000', 'DESCRIPTION:作り物の説明']);
    expect(icsFileToText(file, NOW)).toBe('2026-12-01 23:00 課題の提出（作り物の説明）');
  });
});

describe('画面の原稿（goal/import.tsx）', () => {
  const src = read('app/goal/import.tsx');
  test('ボタンは Web だけ・.ics だけを選べる', () => {
    expect(src).toContain("Platform.OS === 'web'");
    expect(src).toContain('カレンダーのファイルを選ぶ');
    expect(src).toContain('.ics,text/calendar');
    const web = src.indexOf("Platform.OS === 'web'");
    expect(web).toBeLessThan(src.indexOf('import-ics', web));
  });
  test('読んだ結果は入力欄に入れる・注意の 1 行がある', () => {
    expect(src).toContain('icsFileToText(');
    expect(src).toContain('setText(out.slice(0, MAX_IMPORT_TEXT))');
    expect(src).toContain('送る前に、入った文を見直してください');
  });
  test('サーバーに送るのは入力欄の文だけ（ファイルの中身は送らない）', () => {
    expect(src.split('api.extractGoals(').length - 1).toBe(1);
    expect(src).toContain('api.extractGoals(body)');
    const pick = src.slice(src.indexOf('function pickIcs'), src.indexOf('async function extract'));
    expect(pick).not.toMatch(/api\.|fetch\(/);
  });
});
