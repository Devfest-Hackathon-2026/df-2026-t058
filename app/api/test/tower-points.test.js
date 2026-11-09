// 階の pt（契約 §3.6b）: GET /api/tower の各階に、集中の分の pt＋振り返りの達成度の pt を付ける（窓の明かり・決定 11/9）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { pointsForAchievement, pointsForSession } from '../src/score/points.js';
import { scoredAchievement } from '../src/score/rules.js';

const H = { 'x-dev-user': 'u1', 'content-type': 'application/json' };
const get = async (s, path) => (await fetch(`${s.base}${path}`, { headers: H })).json();

test('見本の階それぞれに pt が付き、集中＋振り返りの足し算と一致する', async () => {
  const s = await start({}, { DEMO_SEED: 'on' });
  assert.equal((await fetch(`${s.base}/api/demo/seed`, { method: 'POST', headers: H, body: '{}' })).status, 201);
  const tower = await get(s, '/api/tower');
  assert.ok(tower.floors.length > 0);
  for (const f of tower.floors) {
    assert.equal(typeof f.pt, 'number');
    // 達成度の pt は本人と AI の判定の低い方（契約 §3.6）
    assert.equal(f.pt, pointsForSession({ focusMin: f.focusMin }) + pointsForAchievement(scoredAchievement(f.achievement, f.aiAchievement ?? null)));
    assert.ok(f.pt >= 0);
  }
  await s.close();
});
