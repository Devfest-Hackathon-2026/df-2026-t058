import { COPY_WHY_TAGS } from '../lib/copy';
import { decideAction, showWhyRequired } from '../lib/planView';
import { composeWhy, toggleTag, whyReady } from '../lib/whyCompose';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'plan', '[goalId].tsx'), 'utf8') as string;

describe('composeWhy', () => {
  it('札だけ・文だけ・両方', () => {
    expect(composeWhy(['期限に合う', '時間に合う'], '')).toBe('期限に合う／時間に合う');
    expect(composeWhy([], '本番に近い')).toBe('本番に近い');
    expect(composeWhy(['期限に合う'], '本番に近い')).toBe('期限に合う\n本番に近い');
  });
  it('前後の空白（全角も）を落とす', () => {
    expect(composeWhy([], '　 あ　 ')).toBe('あ');
    expect(composeWhy(['期限に合う'], '　\n ')).toBe('期限に合う');
    expect(composeWhy(['期限に合う'], '　い　')).toBe('期限に合う\nい');
  });
  it('300 字を超える時は自由記述を先に切る（札は残す）', () => {
    const tags = [...COPY_WHY_TAGS];
    const head = tags.join('／');
    const out = composeWhy(tags, 'あ'.repeat(400));
    expect(out.length).toBe(300);
    expect(out.startsWith(`${head}\n`)).toBe(true);
    expect(composeWhy([], 'あ'.repeat(400)).length).toBe(300);
  });
});

describe('whyReady / 決められるか', () => {
  it('空・札だけ・文だけ', () => {
    expect(whyReady([], '')).toBe(false);
    expect(whyReady([], '　 ')).toBe(false);
    expect(whyReady(['期限に合う'], '')).toBe(true);
    expect(whyReady([], 'あ')).toBe(true);
  });
  it('札を選ぶと決められ、札も文も空だと決められない', () => {
    const base = { hasTarget: true, problem: null };
    expect(decideAction({ ...base, why: composeWhy([], '') })).toBe('flash');
    expect(decideAction({ ...base, why: composeWhy(['期限に合う'], '') })).toBe('decide');
    expect(showWhyRequired(true, composeWhy([], ''))).toBe(true);
    expect(showWhyRequired(true, composeWhy(['期限に合う'], ''))).toBe(false);
  });
  it('toggleTag は選び外しでき、並びを保つ', () => {
    const all = [...COPY_WHY_TAGS];
    expect(toggleTag(all, [], all[2]!)).toEqual([all[2]]);
    expect(toggleTag(all, [all[2]!], all[0]!)).toEqual([all[0], all[2]]);
    expect(toggleTag(all, [all[0]!], all[0]!)).toEqual([]);
  });
});

describe('案の画面の理由の欄', () => {
  it('理由の札は並べない（話すか一言で答える・11/9 本人「いっぱい候補を並べるのはやめる」）', () => {
    expect(src).not.toContain('WHY_TAGS.map');
    expect(src).toContain('await decideWith(message)');
    expect(COPY_WHY_TAGS).toHaveLength(5);
  });
});
