import { columnsFor, TWO_COLUMN_MIN_WIDTH } from '../lib/navLayout';
import { createMockApi } from '../api/mock';
import {
  candidatesBody,
  decideAction,
  emphasizedAt,
  planLayoutFor,
  REMAKE_NOTE_MAX,
  selectionAfterRemake,
  whyEmpty,
  WHY_EXAMPLE,
} from '../lib/planView';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const planSrc: string = fs.readFileSync(path.join(__dirname, '..', 'app', 'plan', '[goalId].tsx'), 'utf8');

describe('案の画面の並べ方', () => {
  it.each([
    [375, 1],
    [768, 1],
    [1366, 2],
  ])('幅 %i の列の数は %i', (w, n) => {
    expect(columnsFor(w)).toBe(n);
    expect(planLayoutFor(w).columns).toBe(n);
  });

  it('2 列になるのは 900 から', () => {
    expect(TWO_COLUMN_MIN_WIDTH).toBe(900);
    expect(columnsFor(899)).toBe(1);
    expect(columnsFor(900)).toBe(2);
  });

  it('スマホ幅の固定帯は「これで決める」1 つで、理由の欄は中身の末尾', () => {
    for (const w of [375, 768]) {
      expect(planLayoutFor(w).footer).toEqual(['decide']);
      expect(planLayoutFor(w).whyInScroll).toBe(true);
    }
  });

  it('PC 幅は右の列の下に理由の欄とボタン', () => {
    expect(planLayoutFor(1366)).toEqual({ columns: 2, footer: ['why', 'decide'], whyInScroll: false });
  });

  it('画面は幅を useWindowDimensions で取り、planLayoutFor で並べ方を決める', () => {
    expect(planSrc).toContain('useWindowDimensions()');
    expect(planSrc).toContain('planLayoutFor(width)');
  });

  it('スマホ: 下に固定のボタンは無く、札 → レーダー → 中身 → モルティと話す の 1 本の流れ（UI 刷新 2・11/9）', () => {
    expect(planSrc).toContain('<Screen scroll={false}>');
    expect(planSrc).not.toContain('footer={decideButton}');
    const narrow = planSrc.slice(planSrc.indexOf('testID="plan-columns-1"'));
    const scroll = narrow.slice(narrow.indexOf('<ScrollView'), narrow.indexOf('</ScrollView>'));
    const order = ['{cards}', '{radar}', '{content}', '{talk}'].map((k) => scroll.indexOf(k));
    expect(order.every((x) => x > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('理由は会話で聞く（UI 刷新 2・11/9）: 空では決まらない。札は並べず、話すか一言で決まる', () => {
    expect(decideAction({ why: '', hasTarget: true, problem: null })).toBe('flash');
    expect(planSrc).not.toContain('testID="why-tags"');
    expect(planSrc).toContain("placeholder={confirming ? WHY_EXAMPLE");
  });

  it('既存の操作（直す・自分で作る）は会話の下のリンクと「これにする」で残る', () => {
    for (const id of ['mode-own', 'manual-edit', 'own-without-candidates', 'edit-ratio', 'decide', 'roadmap-ask-input']) {
      expect(planSrc).toContain(`testID="${id}"`);
    }
  });
});

describe('案の札と見積りの分（#268）', () => {
  it('案は上の横のタブ（案 1・2・3）で切り替え、選んだ案の名前と説明を全文でタブの下に出す（11/9 本人）', () => {
    expect(planSrc).toContain('testID="candidate-cards"');
    const at = planSrc.indexOf('const cards');
    expect(at).toBeGreaterThan(-1);
    const cards = planSrc.slice(at, planSrc.indexOf('const remake', at));
    expect(cards).toContain('{copyPlanTab(i)}');
    expect(cards).toContain('choose(i)');
    expect(cards).toContain('accessibilityLabel={`${copyPlanTab(i)}: ${candidateName(c, i)}`}');
    expect(cards).toContain('{candidateName(chosen, sel)}');
    // 並びはタブ → 名前 → レーダー
    expect(planSrc.indexOf('{chosenHead}')).toBeLessThan(planSrc.lastIndexOf('{radar}'));
    expect(cards).toContain('accessibilityState={{ selected: on }}');
    // 名前は行数を制限しない（全部見える）
    expect(cards).not.toContain('numberOfLines');
    expect(planSrc).toContain('{candidateSummary(chosen)}');
    expect(planSrc).not.toContain('numberOfLines');
  });

  it('案の札はレーダーのすぐ上（1 列・2 列とも・UI 刷新 11/9）', () => {
    for (const body of [planSrc.slice(planSrc.indexOf('testID="plan-columns-1"')), planSrc.slice(planSrc.indexOf('plan-columns-2'))]) {
      const at = body.indexOf('{cards}');
      expect(at).toBeGreaterThan(-1);
      expect(body.indexOf('{radar}', at)).toBeGreaterThan(at);
    }
  });

  it('分の表示と入力欄が無い。「＋ 足す」の行も分を持たない', () => {
    expect(planSrc).not.toContain('accessibilityLabel="見積りの分"');
    expect(planSrc).not.toContain('number-pad');
    expect(planSrc).not.toContain('overDaily');
    expect(planSrc).not.toContain('stepMin');
    expect(planSrc).not.toMatch(/`\$\{c\.estimateMin\} 分`/);
    expect(planSrc).toContain("const blank = (): CheckpointInput => ({ title: '', doneMark: '' });");
    expect(planSrc).toContain('[...d, blank()]');
  });
});

describe('whyEmpty', () => {
  it('空と空白だけは空', () => {
    expect(whyEmpty('')).toBe(true);
    expect(whyEmpty('  　')).toBe(true);
    expect(whyEmpty('あ')).toBe(false);
  });
});

describe('decideAction', () => {
  it('理由が空なら点滅', () => {
    expect(decideAction({ why: '', hasTarget: true, problem: null })).toBe('flash');
    expect(decideAction({ why: ' ', hasTarget: true, problem: 'x' })).toBe('flash');
  });
  it('理由があり欄に不備が無ければ決める', () => {
    expect(decideAction({ why: 'a', hasTarget: true, problem: null })).toBe('decide');
  });
  it('欄に不備があれば決めない', () => {
    expect(decideAction({ why: 'a', hasTarget: true, problem: 'x' })).toBe('none');
  });
  it('案が無ければ何もしない', () => {
    expect(decideAction({ why: '', hasTarget: false, problem: null })).toBe('none');
  });
});

describe('案への希望（#223）', () => {
  it('空・空白だけ（全角も）の note は送らない。前後の空白は落とす', () => {
    expect(candidatesBody(undefined)).toEqual({});
    expect(candidatesBody('')).toEqual({});
    expect(candidatesBody(' 　\n')).toEqual({});
    expect(candidatesBody('　もっと 短く　')).toEqual({ note: 'もっと 短く' });
    expect(candidatesBody('実験　から')).toEqual({ note: '実験　から' }); // 中の全角の空白は残す
  });

  it('案が変わったら、選んでいた案と直した中身を外す。「自分で作る」はそのまま', () => {
    expect(selectionAfterRemake('pick')).toEqual({ sel: null, mode: 'pick', edits: {} });
    expect(selectionAfterRemake('edit')).toEqual({ sel: null, mode: 'pick', edits: {} });
    expect(selectionAfterRemake('own').mode).toBe('own');
  });

  it('初期は未選択。未選択では決められず、線は 3 本とも同じ強さ。「自分で作る」は未選択でも決められる', () => {
    const src: string = require('fs').readFileSync(__dirname + '/../app/plan/[goalId].tsx', 'utf8');
    expect(src).toContain('useState<number | null>(null)');
    expect(decideAction({ why: '理由', hasTarget: false, problem: null })).toBe('none');
    expect(decideAction({ why: '理由', hasTarget: true, problem: null })).toBe('decide');
    expect(src).toContain("const canPick = !!chosen || mode === 'own';");
    expect([0, 1, 2].map((i) => emphasizedAt(null, i))).toEqual([true, true, true]);
    expect([0, 1, 2].map((i) => emphasizedAt(1, i))).toEqual([false, true, false]);
  });

  it('上限はサーバーと同じ 200 字', () => {
    expect(REMAKE_NOTE_MAX).toBe(200);
  });

  it('画面: 案を選ぶ前にモルティへ話しかけると、その希望（note）で案を出し直す（UI 刷新 2・11/9。専用の欄はやめた）', () => {
    expect(planSrc).toContain('await make(candidatesBody(message).note)');
    expect(planSrc).toContain('api.makeCandidates(goalId, withNote)');
    const make = planSrc.slice(planSrc.indexOf('async function make'), planSrc.indexOf('useEffect('));
    expect(make).toContain('selectionAfterRemake');
    expect(make).not.toContain('setWhy');
    expect(make).not.toContain('setTags');
    // 希望は端末に保存しない
    expect(planSrc).not.toMatch(/AsyncStorage|localStorage|remember\w*\(\s*goalId,\s*note/);
  });

  it('見本の API: note を受けて案を返し、長すぎは 400', async () => {
    const api = createMockApi({ now: () => Date.parse('2026-11-05T01:00:00Z'), aiDelayMs: 0 });
    const g = await api.createGoal({ text: '目標', deadline: '2026-11-20T00:00:00+09:00', minutesPerDay: 30 });
    expect((await api.makeCandidates(g.id, 'もっと短く')).candidates).toHaveLength(3);
    await expect(api.makeCandidates(g.id, 'あ'.repeat(201))).rejects.toMatchObject({ status: 400 });
  });
});

describe('WHY_EXAMPLE', () => {
  it('「例:」で始まる', () => {
    expect(WHY_EXAMPLE.startsWith('例:')).toBe(true);
  });
});
