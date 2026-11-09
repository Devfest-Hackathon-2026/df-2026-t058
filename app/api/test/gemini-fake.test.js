import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoFakeResponses } from '../src/gemini/fake.js';
import { createGemini } from '../src/gemini/index.js';
import { toCandidates } from '../src/roadmap/candidates.js';
import { roadmapResponseSchema } from '../src/roadmap/schemas.js';
import { ACHIEVEMENT_SCHEMA, STUCK_SCHEMA, parseAchievement, parseNextSteps } from '../src/reflect/prompts.js';
import { REPLY_SCHEMA, buildInput, parseHelpLevel } from '../src/tutor/prompts.js';

// 窓口の約束の形（fake でも本物と同じ検査をする）
const IN = { system: 's', user: 'u' };

// 手元で GEMINI_MODE=fake で起動した時の見本の応答が、各機能の検査を通ること（画面の流れが 502 で止まらない）。
const g = createGemini({ mode: 'fake', fakeResponses: demoFakeResponses });

test('見本: roadmap は 3 案で、案の検査を通る', async () => {
  const out = await g.generate({ purpose: 'roadmap', input: IN, schema: roadmapResponseSchema() });
  assert.equal(toCandidates(out).length, 3);
});

test('見本: 相談は、やり方を聞くと medium・それ以外は small', async () => {
  const ask = (text, history = []) =>
    g.generate({ purpose: 'hint', input: buildInput({ kind: 'ask', text, history }), schema: REPLY_SCHEMA });
  assert.equal(parseHelpLevel((await ask('解き方を教えて')).helpLevel), 'medium');
  assert.equal(parseHelpLevel((await ask('こう考えたけど合ってる？')).helpLevel), 'small');
  // 過去のやり取りの語には引きずられない（今回の入力だけを見る）
  const past = [{ role: 'user', kind: 'ask', text: 'やり方は？' }];
  assert.equal((await ask('ここまで合ってる？', past)).helpLevel, 'small');
  // 安全網の項目（#191）: 見本は答えを含まない
  assert.equal((await ask('解き方を教えて')).answerRevealed, false);
  assert.equal((await ask('合ってる？')).answerRevealed, false);
});

test('見本: 調べるは出典なし（実在しない URL を作らない）', async () => {
  const out = await g.generate({ purpose: 'research', input: IN, schema: REPLY_SCHEMA, grounding: true });
  assert.deepEqual(out.sources, []);
  assert.equal(parseHelpLevel(out.helpLevel), 'small');
});

test('見本: 写真が無ければ判定できない・あれば 2', async () => {
  const judge = (images) => g.generate({ purpose: 'achievement', input: { ...IN, images }, schema: ACHIEVEMENT_SCHEMA });
  assert.deepEqual({ ...parseAchievement(await judge([])), reason: '' }, { judgeable: false, achievement: null, reason: '' });
  const ok = parseAchievement(await judge([{ mimeType: 'image/jpeg', dataBase64: '' }]));
  assert.equal(ok.judgeable, true);
  assert.equal(ok.achievement, 2);
});

test('見本: 次の一歩は 2 つで検査を通る', async () => {
  const out = await g.generate({ purpose: 'stuck', input: IN, schema: STUCK_SCHEMA });
  assert.equal(parseNextSteps(out).length, 2);
});
