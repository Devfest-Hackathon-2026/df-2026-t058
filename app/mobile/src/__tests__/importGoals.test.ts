// 課題の取り込み（Issue #155・契約 §3.3 POST /api/goals/extract）のアプリ側。
declare const require: (name: string) => any;
declare const __dirname: string;

import { ApiError } from '../api/errors';
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import {
  DEFAULT_DAYS,
  extractBody,
  goalsToCreate,
  MAX_IMPORT_PICK,
  rowProblem,
  toRows,
  type ImportRow,
} from '../components/ImportCandidates';

const fs = require('fs');
const path = require('path');
const read = (p: string): string => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const img = { mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(400) };
const NOW = new Date(2026, 10, 7, 12, 0, 0); // 2026/11/7 昼（端末の時刻）

describe('送る中身', () => {
  test('文も写真も無ければ送らない', () => {
    expect(extractBody('   ', [])).toBeNull();
  });
  test('文だけ・写真だけ・両方', () => {
    expect(extractBody(' 課題 ', [])).toEqual({ text: '課題' });
    expect(extractBody('', [img])).toEqual({ images: [img] });
    expect(extractBody('a', [img])).toEqual({ text: 'a', images: [img] });
  });
});

describe('候補の行', () => {
  test('期限は日付の形に・読めない期限は仮に 1 週間後', () => {
    const rows = toRows(
      [
        { text: 'レポート', deadline: new Date(2026, 10, 20, 23, 59).toISOString(), note: 'LMS' },
        { text: '小テスト', deadline: null },
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({ picked: true, text: 'レポート', date: '2026/11/20', guessed: false, note: 'LMS' });
    expect(rows[1]).toMatchObject({ date: `2026/11/${7 + DEFAULT_DAYS}`, guessed: true });
    expect('note' in (rows[1] ?? {})).toBe(false);
  });

  test('最大 10 件', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `課題 ${i}`, deadline: null }));
    expect(toRows(many, NOW)).toHaveLength(MAX_IMPORT_PICK);
  });

  test('検査: 選んでいない行は見ない・名前が空・過去の日付', () => {
    const base: ImportRow = { key: 'a', picked: true, text: 'x', date: '2026/11/20', guessed: false };
    expect(rowProblem(base, NOW)).toBeNull();
    expect(rowProblem({ ...base, text: '  ' }, NOW)).not.toBeNull();
    expect(rowProblem({ ...base, date: '2026/11/1' }, NOW)).not.toBeNull();
    expect(rowProblem({ ...base, date: 'あした' }, NOW)).not.toBeNull();
    expect(rowProblem({ ...base, picked: false, text: '' }, NOW)).toBeNull();
  });

  test('目標にする中身: 選んだ物だけ・おまかせ（null）・問題があれば送らない', () => {
    const rows: ImportRow[] = [
      { key: 'a', picked: true, text: ' レポート ', date: '2026/11/20', guessed: false },
      { key: 'b', picked: false, text: '', date: '', guessed: false },
    ];
    const out = goalsToCreate(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out?.[0]?.body).toEqual({
      text: 'レポート',
      deadline: new Date(2026, 10, 20, 23, 59).toISOString(),
      minutesPerDay: null,
    });
    expect(goalsToCreate([{ ...rows[0]!, date: '2026/11/1' }], NOW)).toBeNull();
    expect(goalsToCreate([{ ...rows[1]! }], NOW)).toBeNull(); // 1 件も選んでいない
  });
});

describe('mock の取り込み', () => {
  const setup = () => createMockApi({ aiDelayMs: 0, now: () => Date.parse('2026-11-07T03:00:00Z') });

  test('決まった候補 3 件・期限は日本時間の 23:59 か null・保存しない', async () => {
    const api = setup();
    const r = await api.extractGoals({ text: '課題の一覧' });
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates[0]?.deadline).toBe('2026-11-10T14:59:00.000Z');
    expect(r.candidates[2]?.deadline).toBeNull();
    expect('note' in (r.candidates[1] ?? {})).toBe(false);
    expect((await api.listGoals()).goals).toHaveLength(0);
  });

  test('写真だけでも出る・何も無い／4 枚／長すぎる文は 400', async () => {
    const api = setup();
    await expect(api.extractGoals({ images: [img] })).resolves.toBeDefined();
    await expect(api.extractGoals({ text: '  ' })).rejects.toBeInstanceOf(ApiError);
    await expect(api.extractGoals({ images: [img, img, img, img] })).rejects.toMatchObject({ status: 400 });
    await expect(api.extractGoals({ text: 'a'.repeat(6001) })).rejects.toMatchObject({ status: 400 });
  });

  test('候補 → 行 → 目標にする（おまかせで作れる）', async () => {
    const api = setup();
    const { candidates } = await api.extractGoals({ text: 'x' });
    const toCreate = goalsToCreate(toRows(candidates, new Date('2026-11-07T03:00:00Z')), new Date('2026-11-07T03:00:00Z'));
    expect(toCreate).toHaveLength(3);
    for (const g of toCreate ?? []) await api.createGoal(g.body);
    const { goals } = await api.listGoals();
    expect(goals.map((g) => g.minutesPerDay)).toEqual([null, null, null]);
  });
});

describe('http の取り込み', () => {
  test('契約の経路と形で送る', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [] }) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test', getUserId: async () => 'u', fetchImpl: f });
    const r = await api.extractGoals({ text: 't', images: [img] });
    expect(r.candidates).toEqual([]);
    expect(calls[0]).toEqual({ url: 'http://api.test/api/goals/extract', body: { text: 't', images: [img] } });
  });
});

describe('画面の原稿', () => {
  test('足す画面の「見せる」に入口がある（課題の一覧）', () => {
    const src = read('app/goal/new.tsx');
    expect(src).toContain('COPY_SHOW_TASKS');
    expect(src).toContain("router.push('/goal/import')");
  });
  test('取り込みの画面が窓口と一覧を使い、ホームへ戻る', () => {
    const src = read('app/goal/import.tsx');
    expect(src).toContain('api.extractGoals(');
    // 取り込んだ物はタスクとしてまとめて作る（#261）。目標（createGoal）にはしない
    expect(src).toContain('api.importTasks(');
    expect(src).not.toContain('api.createGoal(');
    expect(src).toContain('<ImportCandidates');
    expect(src).toContain("router.replace('/')");
  });
  test('Stack に登録してある', () => {
    expect(read('app/_layout.tsx')).toContain('name="goal/import"');
  });
});

describe('タスクとして取り込む（#261 の画面）', () => {
  test('モック: タスクは kind task・「終わった」の 1 歩の道（auto・理由なし）が付く。11 件は 400', async () => {
    const api = createMockApi({ aiDelayMs: 0 });
    const d = new Date(Date.now() + 3 * 864e5).toISOString();
    const r = await api.importTasks([{ title: 'レポート提出', deadline: d, minutes: 45 }]);
    expect(r.goals[0]!.kind).toBe('task');
    const g = await api.getGoal(r.goals[0]!.id);
    expect(g.roadmap?.adopted).toBe('auto');
    expect(g.roadmap?.why).toBe('');
    expect(g.roadmap?.checkpoints.map((c) => [c.title, c.doneMark, c.estimateMin])).toEqual([['レポート提出', '終わった', 45]]);
    await expect(api.importTasks(Array.from({ length: 11 }, () => ({ title: 'x', deadline: d })))).rejects.toMatchObject({ status: 400 });
  });
  test('ホームのカードは、タスクには道の絵を出さない（#315）', () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home).toContain('<MiniRoad checkpoints={card.checkpoints}');
    // 小さな道はチェックポイントが無ければ何も出さない
    expect(read('components/MiniRoad.tsx')).toContain('if (cps.length === 0) return null;');
    expect(read('lib/homeCard.ts')).toContain("checkpoints: g.goal.kind === 'task' ? [] : cps");
  });
});
