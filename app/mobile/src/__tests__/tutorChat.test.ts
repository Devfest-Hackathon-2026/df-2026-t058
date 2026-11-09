import { createMockApi } from '../api/mock';
import { askTutor, chatIsActive, COMPACT_EXAMPLES, pickExample } from '../lib/tutorExamples';
import { photoRoom, TUTOR_SEND_KIND, tutorBody } from '../lib/tutorPhotos';
import { splitSources } from '../lib/sources';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('相談の部品 TutorChat を両方の画面で使う', () => {
  test('相談の画面は部品を呼ぶだけ（API を直接呼ばない）', () => {
    const s = read('app', 'tutor', '[sessionId].tsx');
    expect(s).toContain('<TutorChat sessionId={sessionId} />');
    expect(s).not.toContain('api.tutor');
  });

  test('集中の画面: 部品を compact で置き、「AI に聞く」ボタンと相談の画面への移動が無い', () => {
    const s = read('app', 'focus', '[sessionId].tsx');
    expect(s).toContain('<TutorChat sessionId={sessionId} compact');
    expect(s).not.toContain('label="AI に聞く"');
    expect(s).not.toContain('ask-ai');
    expect(s).not.toContain('/tutor/');
    expect(s).toContain('KeyboardAvoidingView');
    // 確認の段は今のまま
    expect(s).toContain('testID="end-confirm"');
    expect(s).toContain('testID="end"');
  });

  test('部品に入力欄・送信・例の札・切り替え・写真・手助けの棒・待ちの表示がある', () => {
    const s = read('components', 'TutorChat.tsx');
    for (const id of ['tutor-input', 'tutor-send', 'tutor-example-', 'tutor-photo-add', 'tutor-examples-compact']) {
      expect(s).toContain(id);
    }
    // 切り替えの札・kind の状態が無い。入力欄と送るボタンは 1 つ
    for (const gone of ['kind-research', 'setKind', 'useState<TutorKind>', 'COPY_KIND_', '質問する', '調べてもらう', 'kind ===']) {
      expect(s).not.toContain(gone);
    }
    expect(s.split('testID="tutor-input"')).toHaveLength(2);
    expect(s.split('testID="tutor-send"')).toHaveLength(2);
    expect(s).toContain('COPY_ASK_AI');
    expect(s).not.toContain('kind');
    expect(s).toContain('<HelpBars');
    expect(s).toContain('<ThinkingDots');
    expect(s).toContain("'いま詰まっていること'");
    // 札の intent を足す包みを通して api.tutor を呼ぶ（#194）
    expect(s).toContain('askTutor(withIntent(api.tutor');
  });
});

describe('相談の決まり', () => {
  test('例の札を押すと、その文が入力欄に入る（写真は外さない）', () => {
    expect(pickExample({ text: 'どこで止まっている？' })).toEqual({ text: 'どこで止まっている？' });
    expect(COMPACT_EXAMPLES).toBe(3);
  });

  test('送る時の kind は 1 か所で決まり、写真は常に付けられる', () => {
    expect(TUTOR_SEND_KIND).toBe('ask');
    expect(tutorBody('q', [])).toEqual({ kind: TUTOR_SEND_KIND, text: 'q' });
    expect(photoRoom(0)).toBe(2);
    // kind を決めるのは tutorPhotos.ts だけ
    for (const f of [['components', 'TutorChat.tsx'], ['lib', 'tutorExamples.ts']]) {
      expect(read(...f)).not.toMatch(/kind:\s*'(ask|research)'/);
    }
  });

  test('出典がある返事にだけ出典が出る', () => {
    const base = { id: 'm', sessionId: 's', role: 'ai' as const, kind: 'ask' as const, text: '答え', helpLevel: 'none' as const, at: '2026-11-08T00:00:00Z' };
    expect(splitSources({ ...base, sources: [{ title: '公式', url: 'https://example.com/a' }] }).sources.length).toBeGreaterThan(0);
    expect(splitSources(base).sources).toEqual([]);
    const s = read('components', 'TutorChat.tsx');
    expect(s).toContain('sources.length > 0');
  });

  test('会話がある・返事待ち・入力中の時だけ、会話が主役になる', () => {
    expect(chatIsActive(0, false, false)).toBe(false);
    expect(chatIsActive(2, false, false)).toBe(true);
    expect(chatIsActive(0, true, false)).toBe(true);
    expect(chatIsActive(0, false, true)).toBe(true);
  });

  test('送ると api.tutor が呼ばれ、返事が会話の後ろに出る（mock）', async () => {
    const api = createMockApi({ now: () => Date.parse('2026-11-05T01:00:00Z'), aiDelayMs: 0 });
    const goal = await api.createGoal({ text: '二次方程式を解けるようにする', deadline: '2026-11-12T14:59:00Z', minutesPerDay: 30 });
    const { candidates } = await api.makeCandidates(goal.id);
    const c = candidates[0]!;
    const rm = await api.decideRoadmap(goal.id, { source: 'candidate', candidateId: c.id, why: '短いから', checkpoints: [] });
    const s = await api.startSession({ goalId: goal.id, checkpointId: rm.checkpoints[0]!.id, oneLine: '例題' });

    const calls: string[] = [];
    const call = (id: string, body: Parameters<typeof api.tutor>[1]) => {
      calls.push(body.text);
      return api.tutor(id, body);
    };
    const r = await askTutor(call, s.id, [], 'やり方を教えて', []);
    expect(calls).toEqual(['やり方を教えて']);
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'ai']);
    expect(r.messages[1]?.text.length ?? 0).toBeGreaterThan(0);

    const r2 = await askTutor(call, s.id, r.messages, '因数分解', []);
    expect(r2.messages).toHaveLength(4);
    expect(r2.help.small + r2.help.medium).toBeGreaterThan(0);
  });

  test('送るのに失敗した時（混雑の 503 も）は、エラーの文を出し、送った文と写真を入力欄に戻す（#226）', () => {
    const s = read('components', 'TutorChat.tsx');
    const start = s.indexOf('async function send()');
    expect(start).toBeGreaterThan(-1);
    const at = s.indexOf('} catch (e) {', start);
    expect(at).toBeGreaterThan(start);
    const block = s.slice(at, s.indexOf('} finally {', at));
    expect(block).toContain('setError(errorText(e))');
    expect(block).toContain('setText(');
    expect(block).toContain('setPhotos(sending)');
  });
});
