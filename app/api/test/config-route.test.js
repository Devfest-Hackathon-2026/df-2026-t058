import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

// GET /api/config（Issue #199）。ダミーの ID は実行時に組み立てる（本物の形にしない）。
const dummyId = () => ['dummy', 'client', String(Date.now())].join('-');

test('GET /api/config: 環境変数が無ければ googleClientId は null（認証なし）', async () => {
  const s = await start({}, { AUTH_MODE: 'real' }); // real＝認証つきの経路は常に 401
  const res = await fetch(`${s.base}/api/config`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { googleClientId: null });
  await s.close();
});

test('GET /api/config: GOOGLE_CLIENT_ID があればその値（前後の空白は落とす）', async () => {
  const id = dummyId();
  const s = await start({}, { AUTH_MODE: 'real', GOOGLE_CLIENT_ID: `  ${id}\n` });
  const res = await fetch(`${s.base}/api/config`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { googleClientId: id });
  await s.close();
});

test('GET /api/config: 空白だけは null', async () => {
  const s = await start({}, { GOOGLE_CLIENT_ID: '   ' });
  assert.deepEqual(await (await fetch(`${s.base}/api/config`)).json(), { googleClientId: null });
  await s.close();
});
