import { createHttpApi } from '../api/http';
import type { ReflectImage } from '../api/types';
import { addPhotos, MAX_TUTOR_PHOTOS, photoRoom, tutorBody } from '../lib/tutorPhotos';

const img = (n: number): ReflectImage => ({ mimeType: 'image/jpeg', dataBase64: `dummy${n}` });

describe('相談に付ける写真', () => {
  test('画像が本文に載り、kind は 1 か所（当面 ask）で付く', () => {
    const b = tutorBody('ここが分からない', [img(1), img(2)]);
    expect(b.images).toHaveLength(2);
    expect(b.kind).toBe('ask');
  });

  test('写真が 0 枚なら images を付けない', () => {
    expect('images' in tutorBody('x', [])).toBe(false);
  });

  test('2 枚を超えない', () => {
    expect(MAX_TUTOR_PHOTOS).toBe(2);
    expect(tutorBody('x', [img(1), img(2), img(3)]).images).toHaveLength(2);
    expect(addPhotos([1, 2], [3])).toEqual([1, 2]);
    expect(addPhotos([1], [2, 3])).toEqual([1, 2]);
    expect(photoRoom(0)).toBe(2);
    expect(photoRoom(2)).toBe(0);
  });

  test('http: 本文に images がそのまま載る', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [], helpTotal: { small: 0, medium: 0 } }) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });
    await api.tutor('s1', tutorBody('q', [img(1)]));
    expect(JSON.parse(String(calls[0]?.init.body)).images).toEqual([img(1)]);
  });
});
