// 集中の画面の「取り組み中の場面」の札（#194）: intent・送れる条件・メモの保存・振り返りの初期値
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { createMockApi } from '../api/mock';
import type { TutorRequest } from '../api/types';
import { addFocusMemo, focusMemos, memoNote } from '../lib/local';
import { askTutor } from '../lib/tutorExamples';
import {
  applyStarter,
  canSend,
  hintOf,
  intentOf,
  sendText,
  STUCK_STARTERS,
  THINK_CARDS,
  TUTOR_SEND_INTENT,
  withIntent,
} from '../lib/thinkCards';
import { COPY_CHECK_PHOTO_ONLY, COPY_HINT_CHECK, COPY_HINT_STUCK } from '../lib/copy';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
});

const fs = require('fs');
const path = require('path');
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('札で intent が決まる', () => {
  test('手が止まった＝stuck・合ってるか確認＝check・札なしとメモ＝なし', () => {
    expect(THINK_CARDS.map((c) => c.label)).toEqual(['手が止まった', '合ってるか確認', 'メモ']);
    expect(intentOf('stuck')).toBe('stuck');
    expect(intentOf('check')).toBe('check');
    expect(intentOf(null)).toBeUndefined();
    expect(intentOf('memo')).toBeUndefined();
  });

  test('送る本文に intent が付く（送る設定の時）。札なしは付かない', async () => {
    const seen: TutorRequest[] = [];
    const call = async (_id: string, b: TutorRequest) => {
      seen.push(b);
      return { messages: [], helpTotal: { small: 0, medium: 0 } };
    };
    await askTutor(withIntent(call, 'stuck', true), 's', [], '分かっているのは式の形', []);
    await askTutor(withIntent(call, 'check', true), 's', [], 'x=3', []);
    await askTutor(withIntent(call, undefined, true), 's', [], '自由に', []);
    expect(seen.map((b) => b.intent)).toEqual(['stuck', 'check', undefined]);
    expect('intent' in (seen[2] ?? {})).toBe(false);
  });

  test('サーバーが intent を受けるまでは送らない（札の動きだけ）', async () => {
    expect(TUTOR_SEND_INTENT).toBe(false);
    const seen: TutorRequest[] = [];
    const call = async (_id: string, b: TutorRequest) => {
      seen.push(b);
      return { messages: [], helpTotal: { small: 0, medium: 0 } };
    };
    await askTutor(withIntent(call, 'stuck'), 's', [], 'a', []);
    expect('intent' in (seen[0] ?? {})).toBe(false);
  });

  test('mock は intent を受け、知らない値は 400', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 30 });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'a' });
    const r = await api.tutor(s.id, { kind: 'ask', text: 'x=3?', intent: 'check' });
    expect(r.messages).toHaveLength(2);
    await expect(api.tutor(s.id, { kind: 'ask', text: 'a', intent: 'nope' as any })).rejects.toMatchObject({ status: 400 });
  });
});

describe('送れる条件', () => {
  test('手が止まった・合ってるか確認は、本文が空だと送れない', () => {
    expect(canSend('stuck', '', 0)).toBe(false);
    expect(canSend('stuck', '　 ', 0)).toBe(false);
    expect(canSend('check', '', 0)).toBe(false);
    expect(canSend(null, '', 0)).toBe(false);
  });

  test('手が止まった: 書き出しだけでは送れず、続きを書けば送れる', () => {
    for (const s of STUCK_STARTERS) expect(canSend('stuck', s, 0)).toBe(false);
    expect(canSend('stuck', `${STUCK_STARTERS[0] ?? ''}式の形`, 0)).toBe(true);
    // 写真だけでは送れない（自分の考えが要る）
    expect(canSend('stuck', '', 1)).toBe(false);
  });

  test('合ってるか確認は写真だけでも送れ、本文は決まった一文になる', () => {
    expect(canSend('check', '', 1)).toBe(true);
    expect(sendText('check', '', 1)).toBe(COPY_CHECK_PHOTO_ONLY);
    expect(sendText('check', ' x=3 ', 1)).toBe('x=3');
    expect(sendText(null, ' q ', 0)).toBe('q');
  });

  test('薄い例と書き出しの札', () => {
    expect(hintOf('stuck', '既定')).toBe(COPY_HINT_STUCK);
    expect(hintOf('check', '既定')).toBe(COPY_HINT_CHECK);
    expect(hintOf(null, '既定')).toBe('既定');
    expect(STUCK_STARTERS).toEqual(['分かっているのは', '次に思いつくのは']);
    expect(applyStarter('', '分かっているのは')).toBe('分かっているのは');
    expect(applyStarter('書いた文', '分かっているのは')).toBe('書いた文');
  });
});

describe('メモ（端末だけ）', () => {
  test('集中ごとに保存して取り出せる。空は残さない', async () => {
    expect(await focusMemos('s-a')).toEqual([]);
    await addFocusMemo('s-a', '符号に気をつける');
    await addFocusMemo('s-a', '　');
    await addFocusMemo('s-b', '別の集中');
    expect(await addFocusMemo('s-a', ' 解の公式を使う ')).toEqual(['符号に気をつける', '解の公式を使う']);
    expect(await focusMemos('s-b')).toEqual(['別の集中']);
  });

  test('振り返りのメモ欄の初期値は 1 行ずつ・上限で切る', () => {
    expect(memoNote(['a', 'b'])).toBe('a\nb');
    expect(memoNote(['x'.repeat(1200)])).toHaveLength(1000);
    const r = read('app', 'reflect', '[sessionId].tsx');
    expect(r).toContain('focusMemos(sessionId)');
    expect(r).toContain('setNote((cur) => cur || memoNote(m))');
  });
});

describe('集中の画面の札', () => {
  test('部品に 3 つの札・書き出し・メモの数があり、送ったら札が戻る', () => {
    const s = read('components', 'TutorChat.tsx');
    for (const id of ['think-cards', 'think-card-', 'stuck-starters', 'stuck-starter-', 'memo-count']) expect(s).toContain(id);
    expect(s).toContain('selected={card === c.card}');
    expect(s).toContain('canSend(card, text, photos.length)');
    // 送った時に札を外す
    const at = s.indexOf('async function send()');
    expect(at).toBeGreaterThan(0);
    expect(s.indexOf('setCard(null);', at)).toBeGreaterThan(at);
    // メモはサーバーへ送らない
    const memo = s.indexOf('async function saveMemo()');
    expect(s.slice(memo, at)).not.toContain('api.');
  });
});

describe('札の名前は課題に合わせる（11/9）', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { cardsFor, THINK_CARDS } = require('../lib/thinkCards');
  it('解く・書く・読む・覚えるで名前が変わり、働き（stuck/check/memo）の順は同じ', () => {
    const labels = (title: string) => cardsFor({ title, doneMark: '' }).map((c: { label: string }) => c.label);
    expect(labels('例題を 3 問解く')).toEqual(['解き方が浮かばない', '答えを確かめたい', '解き方をメモ']);
    expect(labels('レポートを書く')).toEqual(['書き出せない', '構成が合ってるか', '案をメモ']);
    expect(labels('教科書 p.40 を読む')[0]).toBe('内容がつかめない');
    expect(labels('英単語を 30 個覚える')[0]).toBe('覚えられない');
    expect(cardsFor({ title: '例題を解く' }).map((c: { card: string }) => c.card)).toEqual(['stuck', 'check', 'memo']);
  });
  it('どれにも当たらない・課題が無い時は今の札', () => {
    expect(cardsFor({ title: '散歩' })).toBe(THINK_CARDS);
    expect(cardsFor(null)).toBe(THINK_CARDS);
  });
});
