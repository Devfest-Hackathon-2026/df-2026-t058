// 下の dock は、どの場面も「打ち込む（キーボード）・大きなマイク・見せる（クリップ）」の並び（#315・本人 11/9）
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (f: string): string => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('dock の丸ボタン', () => {
  test.each([
    ['components/MoltyDock.tsx', 'KeyboardIcon'],
    ['components/TutorChat.tsx', '<MicRow'],
    ['app/reflect/[sessionId].tsx', '<MicRow'],
  ])('%s', (f, mark) => {
    expect(read(f)).toContain(mark);
  });
  test('集中・振り返りに文字の「打ち込む」札は残っていない', () => {
    expect(read('components/TutorChat.tsx')).not.toContain('COPY_TYPE_OPEN');
    expect(read('app/reflect/[sessionId].tsx')).not.toContain('COPY_TYPE_OPEN');
  });
});
