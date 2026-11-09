import { createMockApi } from '../api/mock';
import { ApiError } from '../api/errors';

function setup(speed = 1) {
  let t = Date.parse('2026-11-05T01:00:00Z');
  const api = createMockApi({ now: () => t, aiDelayMs: 0, speed });
  const advance = (min: number) => {
    t += min * 60_000;
  };
  return { api, advance };
}

const tinyJpeg = () => ({ mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(400) });

describe('mock の流れ', () => {
  test('目標 → 案 → 決める → 集中 → 相談 → 終える → 振り返り → 階', async () => {
    const { api, advance } = setup();

    const home0 = await api.home();
    expect(home0.goals).toHaveLength(0);
    expect(home0.tower).toEqual({ totalFloors: 0, streak: 0 });

    const goal = await api.createGoal({
      text: '来週の小テストまでに二次方程式を解けるようにする',
      deadline: '2026-11-12T14:59:00Z',
      minutesPerDay: 30,
    });

    const { axes, candidates } = await api.makeCandidates(goal.id);
    expect(axes.length).toBeGreaterThanOrEqual(3);
    expect(candidates).toHaveLength(3);
    for (const c of candidates) {
      expect(c.checkpoints.length).toBeGreaterThanOrEqual(3);
      expect(c.checkpoints.length).toBeLessThanOrEqual(6);
      for (const a of axes) expect([1, 2, 3, 4, 5]).toContain(c.axes[a.key]);
    }

    // 理由が無いと決められない
    const chosen = candidates[0]!;
    await expect(
      api.decideRoadmap(goal.id, { source: 'candidate', candidateId: chosen.id, why: ' ', checkpoints: [] }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_argument' });

    const edited = chosen.checkpoints.map(({ title, doneMark, estimateMin }, i) =>
      i === 0 ? { title: '過去の小テスト 2 問', doneMark, estimateMin } : { title, doneMark, estimateMin },
    );
    const rm = await api.decideRoadmap(goal.id, {
      source: 'edited',
      candidateId: chosen.id,
      why: '本番に近い問題から始めたい',
      checkpoints: edited,
    });
    expect(rm.adopted).toBe('edited');
    expect(rm.editRatio).toBe(0.25);

    const cp = rm.checkpoints[0]!;
    const s = await api.startSession({ goalId: goal.id, checkpointId: cp.id, oneLine: '例題を 3 問' });
    await expect(api.startSession({ goalId: goal.id, checkpointId: cp.id, oneLine: 'x' })).rejects.toMatchObject({
      status: 409,
    });
    expect((await api.home()).active?.id).toBe(s.id);

    advance(10);
    await api.sendEvent(s.id, 'leave');
    advance(3); // 離れていた 3 分は数えない
    await api.sendEvent(s.id, 'return');

    const ans = await api.tutor(s.id, { kind: 'ask', text: 'この問題の答えは？' });
    expect(ans.messages.map((m) => m.role)).toEqual(['user', 'ai']);
    expect(ans.messages[1]?.helpLevel).toBe('small');
    expect(ans.messages[1]?.text).not.toMatch(/x\s*=/);
    const how = await api.tutor(s.id, { kind: 'ask', text: '因数分解のやり方を教えて' });
    expect(how.messages[1]?.helpLevel).toBe('medium');
    expect(how.helpTotal).toEqual({ small: 1, medium: 1 });
    const look = await api.tutor(s.id, { kind: 'research', text: '因数分解' });
    // 出典は検索の URL ではなく出典名の形
    expect(look.messages[1]?.text).not.toMatch(/https?:\/\//);
    expect(look.messages[1]?.sources?.[0]?.title).toBe('ja.wikipedia.org');
    // 調べた返事も AI の返事なので small（サーバーと同じ。none は本人の行だけ）
    expect(look.messages[0]?.helpLevel).toBe('none');
    expect(look.messages[1]?.helpLevel).toBe('small');
    expect(look.helpTotal).toEqual({ small: 2, medium: 1 });
    expect((await api.tutorHistory(s.id)).messages).toHaveLength(6);

    // 相談の写真: research には付けられない・3 枚は 400（失敗した分は履歴に残らない）
    await expect(
      api.tutor(s.id, { kind: 'research', text: '調べる', images: [tinyJpeg()] }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_argument' });
    await expect(
      api.tutor(s.id, { kind: 'ask', text: 'これ', images: [tinyJpeg(), tinyJpeg(), tinyJpeg()] }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await api.tutorHistory(s.id)).messages).toHaveLength(6);

    advance(20);
    const ended = await api.endSession(s.id);
    expect(ended.session.focusMin).toBe(30);
    expect(ended.floor.floors).toBe(2);
    await expect(api.tutor(s.id, { kind: 'ask', text: 'まだ？' })).rejects.toMatchObject({ status: 409 });

    const r = await api.reflect(s.id, { note: '', done: true, images: [tinyJpeg()], materials: '' });
    expect(r.judgeable).toBe(true);
    expect(r.aiAchievement).toBe(3);
    expect(r.reason.length).toBeGreaterThan(0);
    // 自分で決めた度 = 50 + 20×0.25 − 10×1 = 45（small は引かない・11/9）
    expect(r.floor.ownScore).toBe(45);
    expect(r.floor.color).toBe('silver'); // 自分で決めた度が 70 未満なので、達成度 3 でも銀（規則は仮）

    // AI の判定が 3 なので、道は先へ進む
    expect((await api.home()).goals[0]?.roadmap?.checkpoints[0]?.state).toBe('done');

    // 本人が 2 に決め直すと、完了ではなくなる（完了＝最終の判定が 3）
    const c = await api.confirmReflect(s.id, 2);
    expect(c).toMatchObject({ achievement: 2, aiAchievement: 3 });

    const home = await api.home();
    expect(home.active).toBeNull();
    expect(home.tower).toEqual({ totalFloors: 2, streak: 1 });
    const done = home.goals[0]?.roadmap?.checkpoints[0];
    expect(done).toMatchObject({ state: 'doing', achievement: 2, aiAchievement: 3 });
    await api.confirmReflect(s.id, 3);
    expect((await api.home()).goals[0]?.roadmap?.checkpoints[0]?.state).toBe('done');

    const tower = await api.tower();
    expect(tower.floors).toHaveLength(1);
    expect(tower.floors[0]?.sessionId).toBe(s.id);
  });

  test('1 日の時間は省略・null で「おまかせ」（null で保存）。範囲外は 400。おまかせでも案を出せる', async () => {
    const { api } = setup();
    const a = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: null });
    expect(a.minutesPerDay).toBeNull();
    const b = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z' });
    expect(b.minutesPerDay).toBeNull();
    expect((await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 45 })).minutesPerDay).toBe(45);
    await expect(api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 4 })).rejects.toBeInstanceOf(ApiError);
    expect((await api.makeCandidates(a.id)).candidates).toHaveLength(3);
  });

  test('材料が無いと判定しきれず、本人が選ぶ。行き詰まりには次の一歩が来る', async () => {
    const { api, advance } = setup();
    const g = await api.createGoal({ text: '英単語', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[1]!.id, why: '確実', checkpoints: [] });
    expect(rm.checkpoints).toHaveLength(candidates[1]!.checkpoints.length);
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: '10 個' });
    advance(4);
    const e = await api.endSession(s.id);
    expect(e.floor.floors).toBe(0); // 5 分未満は 0 階
    const r = await api.reflect(s.id, {
      note: '',
      done: false,
      images: [],
      materials: '',
      stuck: { cause: 'too_big', note: '' },
    });
    expect(r).toMatchObject({ judgeable: false, aiAchievement: null, achievement: null });
    expect(r.reason).toBe('写真とメモから判定しきれませんでした');
    expect(r.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(r.nextSteps.length).toBeLessThanOrEqual(3);
    const c = await api.confirmReflect(s.id, 1);
    expect(c.aiAchievement).toBeNull();
    // そのまま採った案（40）× 達成度 1 は銀。達成度 0 なら銅
    expect(c.floor.color).toBe('silver');
    expect((await api.confirmReflect(s.id, 0)).floor.color).toBe('bronze');
  });

  test('速さの倍率（デモ用）は作業時間にだけ効く', async () => {
    const { api, advance } = setup(60);
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    const { candidates } = await api.makeCandidates(g.id);
    const step = { title: 'a', doneMark: 'b', estimateMin: 15 };
    const rm = await api.decideRoadmap(g.id, { source: 'own', why: '自分で', checkpoints: [step, step, step] });
    expect(candidates).toHaveLength(3);
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'a' });
    advance(0.5); // 30 秒 → 30 分
    const e = await api.endSession(s.id);
    expect(e.session.focusMin).toBe(30);
    expect(e.floor.ownScore).toBe(70);
  });

  test('友達: コードで申請・自分のコードは 400・届いた申請を承認', async () => {
    const { api } = setup();
    const me = await api.me();
    await expect(api.addFriend(me.friendCode)).rejects.toMatchObject({ status: 400 });
    await expect(api.addFriend('ZZZZZZ')).rejects.toMatchObject({ status: 404 });
    const f = await api.addFriend('ken003');
    expect(f.status).toBe('pending');
    await expect(api.acceptFriend(f.id)).rejects.toMatchObject({ status: 404 }); // 自分が出した申請は承認できない（サーバーと同じ 404）

    const list = await api.friends();
    const incoming = list.friends.find((x) => x.friendship.status === 'pending' && x.friendship.friendId === me.id);
    expect(incoming).toBeDefined();
    const ok = await api.acceptFriend(incoming!.friendship.id);
    expect(ok.status).toBe('accepted');

    const active = (await api.friends()).friends.filter((x) => x.activeNow).map((x) => x.user.displayName);
    expect(active).toEqual(['たろう']);
    expect((await api.feed()).items[0]?.displayName).toBe('たろう');

    const u = await api.updateMe({ nudgeLevel: 'strong' });
    expect(u.nudgeLevel).toBe('strong');
  });

  test('写真は 3 枚まで・1.5MB まで', async () => {
    const { api, advance } = setup();
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'a' });
    advance(6);
    await api.endSession(s.id);
    const four = [tinyJpeg(), tinyJpeg(), tinyJpeg(), tinyJpeg()];
    await expect(api.reflect(s.id, { note: '', done: false, images: four, materials: '' })).rejects.toBeInstanceOf(ApiError);
    // 1 枚 1,500,000 バイトを超えたら 400（本文全体の上限 6MB は超えていない・サーバーと同じ）
    const big = { mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(2_000_004) };
    await expect(api.reflect(s.id, { note: '', done: false, images: [big], materials: '' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_argument',
    });
    const justOk = { mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(2_000_000) };
    await expect(api.reflect(s.id, { note: '', done: false, images: [justOk], materials: '' })).resolves.toBeDefined();
  });

  test('離れた／戻った: 二重の leave と leave の無い return は 409（サーバーと同じ）', async () => {
    const { api } = setup();
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'a' });
    await expect(api.sendEvent(s.id, 'return')).rejects.toMatchObject({ status: 409 });
    await api.sendEvent(s.id, 'leave');
    await expect(api.sendEvent(s.id, 'leave')).rejects.toMatchObject({ status: 409 });
    await api.sendEvent(s.id, 'return');
  });

  test('ロードマップ: 自作は 3〜12 個（サーバーと同じ範囲・仮）。そのまま採る時は欄を見ない', async () => {
    const { api } = setup();
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    await api.makeCandidates(g.id);
    const step = { title: 'a', doneMark: 'b', estimateMin: 15 };
    await expect(api.decideRoadmap(g.id, { source: 'own', why: 'a', checkpoints: [step, step] })).rejects.toMatchObject({
      status: 400,
    });
    const long = { ...step, title: 'あ'.repeat(101) };
    await expect(
      api.decideRoadmap(g.id, { source: 'own', why: 'a', checkpoints: [long, step, step] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('振り返り: 本文全体が 6MB を超えたら 413', async () => {
    const { api, advance } = setup();
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    const { candidates } = await api.makeCandidates(g.id);
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    const s = await api.startSession({ goalId: g.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'a' });
    advance(5);
    await api.endSession(s.id);
    // 1 枚 1,500,000 バイトちょうど（1 枚ずつの上限は通る）を 3 枚＝本文は 6MB を超える
    const big = { mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(2_000_000) };
    await expect(
      api.reflect(s.id, { note: '', done: false, images: [big, big, big], materials: '' }),
    ).rejects.toMatchObject({ status: 413, code: 'too_large' });
  });
});

describe('mock をサーバーの規則にそろえる（11/6）', () => {
  async function planned(api: ReturnType<typeof setup>['api']) {
    const g = await api.createGoal({ text: '二次方程式', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 30 });
    const step = { title: '例題', doneMark: '3 問解けた', estimateMin: 30 };
    const rm = await api.decideRoadmap(g.id, { source: 'own', why: '自分で', checkpoints: [step, step, step] });
    return { g, rm, cp: rm.checkpoints[0]! };
  }

  test('案は label・summary を持ち、案のチェックポイントに state は無い。Roadmap に candidates は無い', async () => {
    const { api } = setup();
    const g = await api.createGoal({ text: 'x', deadline: '2026-11-12T00:00:00Z', minutesPerDay: 15 });
    const { candidates } = await api.makeCandidates(g.id);
    for (const c of candidates) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
      expect(Object.keys(c.checkpoints[0]!).sort()).toEqual(['doneMark', 'estimateMin', 'id', 'order', 'title']);
    }
    const rm = await api.decideRoadmap(g.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'a', checkpoints: [] });
    expect('candidates' in rm).toBe(false);
    expect(rm.why).toBe('a');
    expect(rm.checkpoints[0]).toMatchObject({ state: 'todo', achievement: null });
  });

  test('表示名の初期値はサーバーと同じ空。名前は updateMe で付ける', async () => {
    const { api } = setup();
    expect((await api.me()).displayName).toBe('');
    expect((await api.updateMe({ displayName: ' はると ' })).displayName).toBe('はると');
  });

  test('2 回目の振り返りは保存した結果を返す。判定は集中ごとで、前の集中は決め直せない（409）', async () => {
    const { api, advance } = setup();
    const { cp } = await planned(api);
    const s1 = await api.startSession({ goalId: (await api.listGoals()).goals[0]!.id, checkpointId: cp.id, oneLine: '1 回目' });
    advance(30);
    await api.endSession(s1.id);
    expect((await api.home()).toReflect.map((x) => x.id)).toEqual([s1.id]);
    const longNote = 'メモを二十文字以上書いて判定してもらう。途中まで解けた';
    const r1 = await api.reflect(s1.id, { note: longNote, done: false, images: [], materials: '' });
    expect(r1.achievement).toBe(1);
    expect((await api.home()).toReflect).toEqual([]);
    // やり直し: 写真を付けても前の結果
    const again = await api.reflect(s1.id, { note: '', done: false, images: [tinyJpeg()], materials: '' });
    expect(again).toEqual(r1);

    const s2 = await api.startSession({ goalId: (await api.listGoals()).goals[0]!.id, checkpointId: cp.id, oneLine: '2 回目' });
    advance(30);
    await api.endSession(s2.id);
    const r2 = await api.reflect(s2.id, { note: '', done: false, images: [tinyJpeg()], materials: '' });
    expect(r2.achievement).toBe(3);
    const tower = await api.tower();
    const byId = Object.fromEntries(tower.floors.map((f) => [f.sessionId, f]));
    expect(byId[s1.id]).toMatchObject({ achievement: 1, aiAchievement: 1, achievementScore: 1 });
    expect(byId[s2.id]).toMatchObject({ achievement: 3, aiAchievement: 3, achievementScore: 3 });
    expect((await api.home()).goals[0]?.roadmap?.checkpoints[0]?.state).toBe('done');

    await expect(api.confirmReflect(s1.id, 0)).rejects.toMatchObject({ status: 409 });
    expect((await api.home()).goals[0]?.roadmap?.checkpoints[0]?.state).toBe('done');
    // 前の集中への 2 回目の POST もチェックポイントを戻さない
    await api.reflect(s1.id, { note: '', done: false, images: [], materials: '' });
    expect((await api.home()).goals[0]?.roadmap?.checkpoints[0]).toMatchObject({ state: 'done', achievement: 3 });
  });

  test('点と色の達成度は本人と AI の低い方（サーバーと同じ・本人が 3 にしても盛れない）', async () => {
    const { api, advance } = setup();
    const { g, cp } = await planned(api); // 自作のロードマップ＝自分で決めた度 70
    const s = await api.startSession({ goalId: g.id, checkpointId: cp.id, oneLine: '盛る' });
    advance(30);
    await api.endSession(s.id);
    const r = await api.reflect(s.id, { note: 'メモを二十文字以上書いて判定してもらう。途中まで解けた', done: false, images: [], materials: '' });
    expect(r.aiAchievement).toBe(1);
    const c = await api.confirmReflect(s.id, 3);
    expect(c.floor).toMatchObject({ achievement: 3, aiAchievement: 1, achievementScore: 3 });
    expect(c.floor.color).toBe('silver'); // 本人 3 だけなら金。AI の 1 で銀
    const floor = (await api.tower()).floors.find((f) => f.sessionId === s.id)!;
    expect(floor.pt).toBe(6 + 5); // 集中 30 分＝6・達成度は低い方の 1＝5
    const done = (await api.points()).items.find((x) => x.kind === 'done')!;
    expect(done.pt).toBe(5);
  });

  test('連続記録はサーバーと同じ: 集中を終えた日（0 階でも）を JST で数え、今日がまだでも昨日まで続けば切れない', async () => {
    const { api, advance } = setup(); // 2026-11-05T01:00Z = JST 11/5 10:00
    const { g, cp } = await planned(api);
    const s = await api.startSession({ goalId: g.id, checkpointId: cp.id, oneLine: '4 分' });
    advance(4);
    expect((await api.endSession(s.id)).floor.floors).toBe(0);
    expect((await api.tower()).streak).toBe(1); // 0 階でも数える
    expect((await api.me()).streak).toBe(1);
    advance(24 * 60); // 次の日の朝（今日はまだ）
    expect((await api.tower()).streak).toBe(1);
    expect((await api.home()).me.streak).toBe(1);
    advance(24 * 60); // 2 日空いた
    expect((await api.tower()).streak).toBe(0);
  });
});
