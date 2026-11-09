import { ApiError, errorFromBody, errorText } from '../api/errors';
import { createHttpApi } from '../api/http';
import { readConfig } from '../api/config';

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: string, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
  }) as unknown as typeof fetch;
}

const deps = (f: typeof fetch) => ({ baseUrl: 'http://api.test/', getUserId: async () => 'dev-abc', fetchImpl: f });

describe('API のエラーの扱い', () => {
  test('契約の形のエラーを読む', async () => {
    const api = createHttpApi(deps(fakeFetch(409, JSON.stringify({ error: { code: 'conflict', message: '進行中' } }))));
    await expect(api.startSession({ goalId: 'g', checkpointId: 'c', oneLine: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: '進行中',
    });
  });

  test('JSON でない失敗は状態の番号から code を決める', async () => {
    const api = createHttpApi(deps(fakeFetch(429, '<html>Too Many</html>')));
    const err = await api.home().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('rate_limited');
  });

  test('つながらない時は network', async () => {
    const failing = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const err = await createHttpApi(deps(failing)).home().catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: 'network' });
    expect(errorText(err)).toBe('ネットにつながっていません。つながってから、もう一度');
  });

  test('成功なのに JSON でない応答は internal', async () => {
    const err = await createHttpApi(deps(fakeFetch(200, 'not json'))).home().catch((e) => e);
    expect(err).toMatchObject({ code: 'internal' });
  });

  test('x-dev-user と本文と URL を正しく送る', async () => {
    const calls: Call[] = [];
    const api = createHttpApi(deps(fakeFetch(201, JSON.stringify({ id: 'e1' }), calls)));
    await api.sendEvent('s/1', 'leave');
    expect(calls[0]?.url).toBe('http://api.test/api/sessions/s%2F1/events');
    expect(calls[0]?.init.method).toBe('POST');
    const h = calls[0]?.init.headers as Record<string, string>;
    expect(h['x-dev-user']).toBe('dev-abc');
    expect(h['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ type: 'leave' });
  });

  test('GET は本文を付けない', async () => {
    const calls: Call[] = [];
    await createHttpApi(deps(fakeFetch(200, '{"ok":true}', calls))).health();
    expect(calls[0]?.init.body).toBeUndefined();
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  test('errorFromBody は error の形が崩れていても落ちない', () => {
    expect(errorFromBody(400, '{"error":"bad"}').code).toBe('invalid_argument');
    expect(errorFromBody(500, '').code).toBe('internal');
    expect(errorFromBody(502, '{}').code).toBe('upstream_invalid');
  });

  test('画面の文は短い', () => {
    expect(errorText(new ApiError(429, 'rate_limited', ''))).toBe('今日はここまでです。明日また使えます');
    expect(errorText(new Error('x'))).toBe('うまくいきませんでした');
  });

  test('AI 側の混雑（503 upstream_busy・#226）は自前の上限（429）と別の文', () => {
    const busy = errorFromBody(503, '{"error":{"code":"upstream_busy","message":"x"}}');
    expect(busy.code).toBe('upstream_busy');
    expect(errorText(busy)).toBe('いま混み合っています。少し待ってから、もう一度押してください');
    expect(errorFromBody(503, '<html>').code).toBe('upstream_busy');
    expect(errorText(new ApiError(429, 'rate_limited', ''))).not.toBe(errorText(busy));
  });
});

describe('同じ場所から呼ぶ（same-origin）', () => {
  test('readConfig: same-origin は baseUrl が空文字、それ以外は今まで通り', () => {
    expect(readConfig({ EXPO_PUBLIC_API_URL: 'same-origin' }).baseUrl).toBe('');
    expect(readConfig({ EXPO_PUBLIC_API_URL: ' same-origin ' }).baseUrl).toBe('');
    expect(readConfig({ EXPO_PUBLIC_API_URL: 'http://api.test' }).baseUrl).toBe('http://api.test');
    expect(readConfig({}).baseUrl).toBe('http://localhost:8080');
    expect(readConfig({ EXPO_PUBLIC_API_URL: '' }).baseUrl).toBe('http://localhost:8080');
  });

  test('baseUrl が空文字なら /api/... の相対パスで呼ぶ', async () => {
    const calls: Call[] = [];
    const api = createHttpApi({
      baseUrl: readConfig({ EXPO_PUBLIC_API_URL: 'same-origin' }).baseUrl,
      getUserId: async () => 'dev-abc',
      fetchImpl: fakeFetch(200, JSON.stringify({ ok: true }), calls),
    });
    await api.health();
    expect(calls[0]?.url).toBe('/api/health');
  });
});
