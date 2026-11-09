import { MAX_REFLECT_BODY_BYTES, reflectBodyBytes, utf8Bytes } from '../lib/bodySize';
import { MAX_BYTES } from '../lib/photo';
import { stepsProblem } from '../lib/roadmapLimits';

describe('本文の大きさ', () => {
  test('UTF-8 のバイト数', () => {
    expect(utf8Bytes('a')).toBe(1);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('あ')).toBe(3);
    expect(utf8Bytes('😀')).toBe(4);
  });

  test('1 枚の上限いっぱいの写真 3 枚＋メモと資料の上限でも、本文は 6MB に収まる', () => {
    const b64Len = Math.ceil(MAX_BYTES / 3) * 4;
    const img = { mimeType: 'image/jpeg', dataBase64: 'A'.repeat(b64Len) };
    const body = {
      note: 'あ'.repeat(1000),
      done: false,
      images: [img, img, img],
      materials: 'あ'.repeat(2000),
      stuck: { cause: 'other', note: 'あ'.repeat(300) },
    };
    expect(reflectBodyBytes(body)).toBeLessThan(MAX_REFLECT_BODY_BYTES);
    expect(reflectBodyBytes(body)).toBe(utf8Bytes(JSON.stringify(body)));
  });
});

describe('ロードマップの欄', () => {
  const step = { title: 'a', doneMark: 'b', estimateMin: 30 };
  test('個数・空欄・字数・見積り', () => {
    expect(stepsProblem([step, step, step])).toBeNull();
    expect(stepsProblem([step, step])).toMatch(/3 つ以上/);
    expect(stepsProblem(Array(13).fill(step))).toMatch(/12 個まで/);
    expect(stepsProblem([step, step, { ...step, doneMark: ' ' }])).toBe('空の欄があります');
    expect(stepsProblem([step, step, { ...step, title: 'x'.repeat(101) }])).toMatch(/100 字/);
    expect(stepsProblem([step, step, { ...step, estimateMin: 0 }])).toMatch(/1〜6000/);
  });
});
