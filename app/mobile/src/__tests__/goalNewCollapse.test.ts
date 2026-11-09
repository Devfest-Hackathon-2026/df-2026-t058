// 足す画面（goal/new・#315 準備のフロー）: 入口は話す 1 つ。カードに目標・期限・資料。決めたら道を決める場面へ
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
const src: string = fs.readFileSync(path.join(__dirname, '../app/goal/new.tsx'), 'utf8');

describe('goal/new 足す', () => {
  test('上は準備の帯（足す）と、やめるリンク', () => {
    expect(src).toMatch(/<SceneTop\s+scene="add"/);
    expect(src).toContain('COPY_PREP_QUIT');
  });

  test('下は大きなマイクの dock で、見せる（クリップ）を付ける', () => {
    expect(src).toContain('<MoltyDock');
    expect(src).toContain('onShow={() => setShowing(true)}');
  });

  test('話した文は画面の中で期限を読み取り、目標は本人の文のまま（AI は書かない・P1）', () => {
    expect(src).toContain('heardDeadline(s)');
    expect(src).toContain('goalFromSaid(s, h)');
    expect(src).not.toContain('api.agentChat');
  });

  test('期限が読めない時は札で選ぶ（その場の操作は部品で・決定 11/9）', () => {
    expect(src).toContain('testID="add-deadline-chips"');
    expect(src).toContain('chooseDays(c.days)');
  });

  test('1 日の時間は送らない（おまかせ・#265）。決めたら道を決める場面へ', () => {
    expect(src).not.toContain('minutesPerDay');
    expect(src).toContain('router.replace(`/plan/${g.id}`)');
  });

  test('見せる: 課題の一覧は取り込みへ、資料はこの目標の資料の欄へ', () => {
    expect(src).toContain("router.push('/goal/import')");
    expect(src).toContain('<MaterialsField');
  });
});
