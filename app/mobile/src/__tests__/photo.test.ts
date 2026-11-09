import { base64Bytes, MAX_BYTES, shrinkToLimit, STEPS } from '../lib/photo';

describe('写真を縮める', () => {
  test('base64 のバイト数', () => {
    expect(base64Bytes('QUJD')).toBe(3); // "ABC"
    expect(base64Bytes('QUI=')).toBe(2);
    expect(base64Bytes('QQ==')).toBe(1);
  });

  test('上限に収まった段で止まる', async () => {
    const tried: number[] = [];
    const shrink = async (_uri: string, width: number) => {
      tried.push(width);
      // 幅 1024 で初めて上限に収まる
      return 'A'.repeat(width > 1024 ? MAX_BYTES * 2 : 1000);
    };
    await shrinkToLimit('file://x.jpg', shrink, 4000);
    expect(tried).toEqual([1600, 1280, 1024]);
  });

  test('元が小さければ引き伸ばさない', async () => {
    const tried: number[] = [];
    await shrinkToLimit('file://x.jpg', async (_u, w) => (tried.push(w), 'AAAA'), 900);
    expect(tried).toEqual([900]);
  });

  test('最後まで収まらなければ失敗', async () => {
    const shrink = async () => 'A'.repeat(MAX_BYTES * 2);
    await expect(shrinkToLimit('file://x.jpg', shrink)).rejects.toThrow('too_large');
    expect(STEPS.length).toBeGreaterThan(1);
  });
});
