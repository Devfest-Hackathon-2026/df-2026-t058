import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, timeoutFor } from '../src/config.js';

test('時間切れ: 既定は 30 秒、roadmap だけ 60 秒', () => {
  const c = loadConfig({});
  assert.equal(timeoutFor(c, 'hint'), 30000);
  assert.equal(timeoutFor(c, 'achievement'), 30000);
  assert.equal(timeoutFor(c, 'roadmap'), 60000);
});

test('時間切れ: GEMINI_TIMEOUT_MS は roadmap 以外の既定を変える', () => {
  const c = loadConfig({ GEMINI_TIMEOUT_MS: '20000' });
  assert.equal(timeoutFor(c, 'hint'), 20000);
  assert.equal(timeoutFor(c, 'roadmap'), 60000);
});

test('時間切れ: GEMINI_TIMEOUT_ROADMAP_MS で roadmap を変えられる', () => {
  assert.equal(timeoutFor(loadConfig({ GEMINI_TIMEOUT_ROADMAP_MS: '90000' }), 'roadmap'), 90000);
});

test('時間切れ: 不正な値は既定に戻る', () => {
  for (const bad of ['abc', '0', '-5', '1.5', '']) {
    assert.equal(timeoutFor(loadConfig({ GEMINI_TIMEOUT_ROADMAP_MS: bad }), 'roadmap'), 60000, bad);
  }
});
