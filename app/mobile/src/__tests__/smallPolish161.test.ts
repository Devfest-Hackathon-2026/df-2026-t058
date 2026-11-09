import { showWhyRequired, startLine, WHY_REQUIRED } from '../lib/planView';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', 'app', ...p), 'utf8');

describe('理由が空の時の 1 行', () => {
  it('空のまま押した後、書くまで出す', () => {
    expect(WHY_REQUIRED).toBe('理由を 1 つ選ぶか、書いてください');
    expect(showWhyRequired(false, '')).toBe(false);
    expect(showWhyRequired(true, '  ')).toBe(true);
    expect(showWhyRequired(true, '書いた')).toBe(false);
  });
  it('案の画面は理由を会話で聞く（UI 刷新 2・11/9）。長い文は語の切れ目で折り返す', () => {
    const src = read('plan', '[goalId].tsx');
    expect(src).toContain('decideWith(');
    expect(src).toContain("wordBreak: 'auto-phrase'");
  });
});

describe('始める画面の一行', () => {
  it('入力が空なら今のチェックポイント名を使う', () => {
    expect(startLine('', '過去問を解く')).toBe('過去問を解く');
    expect(startLine('  今日は 1 問', '過去問を解く')).toBe('今日は 1 問');
    expect(startLine('', null)).toBe('');
  });
  it('聞かずに始める: 前の振り返りの次の一歩があればそれ、無ければチェックポイントの名前（#315）', () => {
    const src = read('start', '[goalId]', '[checkpointId].tsx');
    expect(src).toContain('goLine(next, found?.title)');
  });
});

describe('ログインの欄', () => {
  it('コードの欄は「招待コード」', () => {
    expect(read('login.tsx')).toContain('label={COPY_INVITE_CODE}');
  });
});
