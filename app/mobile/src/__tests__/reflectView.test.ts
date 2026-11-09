import {
  buildLine,
  focusMinText,
  hasMaterial,
  leaveLine,
  levelWord,
  milestoneLine,
  unjudgeableLine,
  moreOpenValue,
  nextStepOnJudge,
  ownScoreText,
  parseMoreOpen,
  resultLevels,
  resultSubLines,
} from '../lib/reflectView';

describe('reflectView', () => {
  test('材料が空なら自分で選ぶへ', () => {
    expect(nextStepOnJudge({ photoCount: 0, note: '' })).toBe('choose');
    expect(nextStepOnJudge({ photoCount: 0, note: '  \n' })).toBe('choose');
    expect(nextStepOnJudge({ photoCount: 1, note: '' })).toBe('judge');
    expect(hasMaterial({ photoCount: 0, note: 'メモ' })).toBe(true);
  });
  test('言葉の対応（✓ は付けない・UI 刷新 11/9）', () => {
    expect(([0, 1, 2, 3] as const).map((a) => levelWord(a))).toEqual(['まだ', '少し', 'だいたい', 'できた']);
  });
  test('数字の丸め', () => {
    expect(ownScoreText(66.6)).toBe('67');
    expect(ownScoreText(120)).toBe('100');
    expect(ownScoreText(NaN)).toBe('0');
    expect(focusMinText(24.6)).toBe('25');
    expect(focusMinText(-1)).toBe('0');
  });

  test('AI と自分の判定が違う時だけ 2 つ出す', () => {
    expect(resultLevels({ judgeable: true, ai: 2, mine: 3 })).toEqual([
      { who: 'AI', level: 2 },
      { who: '自分', level: 3 },
    ]);
    expect(resultLevels({ judgeable: true, ai: 2, mine: 2 })).toEqual([{ who: null, level: 2 }]);
    expect(resultLevels({ judgeable: true, ai: 1, mine: null })).toEqual([{ who: null, level: 1 }]);
    // 判定できなかった時は自分の選んだ物だけ
    expect(resultLevels({ judgeable: false, ai: null, mine: 0 })).toEqual([{ who: null, level: 0 }]);
  });

  test('結果の札の小さな行に、階の色・階数が出ない', () => {
    const lines = resultSubLines({ focusMin: 24.6, ownScore: 37.2 });
    expect(lines).toEqual(['集中した時間　25 分', '自分で決めた度　37/100']);
    for (const l of lines) expect(l).not.toMatch(/金|銀|銅|階/);
  });

  test('積み上がる場面に色名と合計が出る', () => {
    expect(buildLine('silver', 35)).toBe('銀の階が 1 つ増えて、合計 35 階');
    expect(buildLine('gold', 1)).toBe('金の階が 1 つ増えて、合計 1 階');
    expect(buildLine('bronze', NaN)).toBe('銅の階が 1 つ増えて、合計 0 階');
  });

  test('離れた回数は 1 回以上だけ、事実で出す', () => {
    expect(leaveLine(0)).toBeNull();
    expect(leaveLine(-1)).toBeNull();
    expect(leaveLine(NaN)).toBeNull();
    expect(leaveLine(1)).toBe('集中の間に 1 回、画面を離れました');
    expect(leaveLine(2)).toBe('集中の間に 2 回、画面を離れました');
  });

  test('「もっと書く」の開閉を覚える値', () => {
    expect(parseMoreOpen(null)).toBe(false);
    expect(parseMoreOpen(moreOpenValue(true))).toBe(true);
    expect(parseMoreOpen(moreOpenValue(false))).toBe(false);
  });
});

describe('判定できなかった時と節目の 1 行', () => {
  test('判定できなかった時だけ 1 行', () => {
    expect(unjudgeableLine(false)).toBe('写真か資料があると判定できます');
    expect(unjudgeableLine(true)).toBeNull();
  });
  test('5・10・30 階をまたいだ回と 7 日連続だけ出す', () => {
    expect(milestoneLine({ gained: 1, total: 5, streak: 1 })).toBe('5 階に届きました');
    expect(milestoneLine({ gained: 2, total: 6, streak: 1 })).toBe('5 階に届きました');
    expect(milestoneLine({ gained: 1, total: 6, streak: 1 })).toBeNull();
    expect(milestoneLine({ gained: 1, total: 10, streak: 1 })).toBe('10 階に届きました');
    expect(milestoneLine({ gained: 1, total: 30, streak: 1 })).toBe('30 階に届きました');
    expect(milestoneLine({ gained: 0, total: 5, streak: 1 })).toBeNull();
    expect(milestoneLine({ gained: 1, total: 3, streak: 7 })).toBe('7 日連続です');
    expect(milestoneLine({ gained: 1, total: 3, streak: 8 })).toBeNull();
  });
});
