import { createApp } from '../src/index.js';
import { loadConfig } from '../src/config.js';

// テスト用にポート 0 で起動し、base URL と後始末を返す。
export async function start(overrides = {}, env = {}) {
  const config = { ...loadConfig({ GEMINI_MODE: 'fake', AUTH_MODE: 'fake', ...env }) };
  const { server, ctx } = createApp({ config, ...overrides });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, ctx, close: () => new Promise((r) => server.close(r)) };
}
