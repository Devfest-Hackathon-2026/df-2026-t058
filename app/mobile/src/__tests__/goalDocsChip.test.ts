import { docsChipText, pickGoal } from '../lib/goalDocs';
import type { Goal } from '../api/types';

const g = (id: string) => ({ goal: { id } as Goal });

describe('資料の札', () => {
  it('目標が取れない時は札を出さない', () => {
    expect(docsChipText(null, '資料')).toBeNull();
    expect(pickGoal([g('a')], 'b')).toBeNull();
    expect(pickGoal([g('a')], null)).toBeNull();
    expect(pickGoal(undefined, 'a')).toBeNull();
  });
  it('資料が無ければ「＋ 資料」、あれば数つき', () => {
    expect(docsChipText(pickGoal([g('a')], 'a'), '資料')).toBe('＋ 資料');
    expect(docsChipText({ docs: [{ id: 'x' }, { id: 'y' }] as never, materials: 'm' }, '資料')).toBe('📄 資料 3');
  });
});
