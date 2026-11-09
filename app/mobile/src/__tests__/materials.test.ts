/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { ApiError } from '../api/errors';
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import {
  appendText,
  bytesToBase64,
  canPickFiles,
  FILE_ACCEPT,
  fileKind,
  fileProblem,
  materialsPhase,
  MAX_MATERIALS,
  type MaterialsPhase,
} from '../lib/materialsState';

const img = { mimeType: 'image/jpeg' as const, dataBase64: 'A'.repeat(400) };
const pdf = { mimeType: 'application/pdf' as const, dataBase64: 'JVBERi0xLjQK' }; // "%PDF-1.4\n"
const txt = { mimeType: 'text/plain' as const, dataBase64: 'YWJj' };

describe('資料の欄の状態', () => {
  test('空 → 読み取り中 → 文字 → 失敗', () => {
    let p: MaterialsPhase = 'idle';
    p = materialsPhase(p, { type: 'start' });
    expect(p).toBe('reading');
    p = materialsPhase(p, { type: 'done' });
    expect(p).toBe('idle');
    p = materialsPhase(p, { type: 'start' });
    p = materialsPhase(p, { type: 'fail' });
    expect(p).toBe('failed');
  });

  test('文字は後ろに足す・2000 字まで・空は読めなかった扱い', () => {
    expect(appendText('', ' 範囲 ')).toBe('範囲');
    expect(appendText('前', '後')).toBe('前\n後');
    expect(appendText('前', '   ')).toBeNull();
    expect(appendText('a'.repeat(1999), 'bbbb')).toHaveLength(MAX_MATERIALS);
  });
});

describe('mock の資料', () => {
  const setup = () => createMockApi({ aiDelayMs: 0 });

  test('読み取り → 文字が返る', async () => {
    const r = await setup().readMaterials([img]);
    expect(r.text.length).toBeGreaterThan(0);
  });

  test('0 枚・4 枚は 400', async () => {
    const api = setup();
    await expect(api.readMaterials([])).rejects.toBeInstanceOf(ApiError);
    await expect(api.readMaterials([img, img, img, img])).rejects.toMatchObject({ status: 400 });
  });

  test('ファイル（PDF・テキスト）を受けて決まった文を返す・3 件・上限超え・形式違いは 400', async () => {
    const api = setup();
    const r = await api.readMaterials([], [pdf, txt]);
    expect(r.text).toContain('範囲');
    await expect(api.readMaterials([], [pdf, pdf, pdf])).rejects.toMatchObject({ status: 400 });
    const big = { mimeType: 'text/plain' as const, dataBase64: 'A'.repeat(268_000) }; // 約 201,000 バイト
    await expect(api.readMaterials([], [big])).rejects.toMatchObject({ status: 400 });
    const odd = { mimeType: 'application/msword', dataBase64: 'AAAA' } as unknown as typeof pdf;
    await expect(api.readMaterials([], [odd])).rejects.toMatchObject({ status: 400 });
  });

  test('materials が目標と集中に残る', async () => {
    const api = setup();
    const goal = await api.createGoal({ text: 't', deadline: '2026-11-12T14:59:00Z', minutesPerDay: 30, materials: '範囲 p.1' });
    expect(goal.materials).toBe('範囲 p.1');
    const { candidates } = await api.makeCandidates(goal.id);
    const rm = await api.decideRoadmap(goal.id, { source: 'candidate', candidateId: candidates[0]!.id, why: 'r', checkpoints: [] });
    const s = await api.startSession({ goalId: goal.id, checkpointId: rm.checkpoints[0]!.id, oneLine: 'x', materials: 'p.12' });
    expect(s.materials).toBe('p.12');
    await api.endSession(s.id);
    expect((await api.home()).toReflect[0]?.materials).toBe('p.12');
  });
});

describe('http の資料', () => {
  test('読み取りと materials を契約の形で送る', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, text: async () => JSON.stringify({ text: 'x' }) } as Response;
    }) as unknown as typeof fetch;
    const api = createHttpApi({ baseUrl: 'http://api.test', getUserId: async () => 'u', fetchImpl: f });
    await api.readMaterials([img]);
    await api.createGoal({ text: 't', deadline: 'd', minutesPerDay: 30, materials: 'm' });
    await api.startSession({ goalId: 'g', checkpointId: 'c', oneLine: 'o', materials: 'm2' });
    expect(calls[0]).toEqual({ url: 'http://api.test/api/materials/read', body: { images: [img] } });
    expect(calls[1]!.body).toMatchObject({ materials: 'm' });
    expect(calls[2]!.body).toMatchObject({ materials: 'm2' });
    await api.readMaterials([], [pdf]);
    expect(calls[3]).toEqual({ url: 'http://api.test/api/materials/read', body: { images: [], files: [pdf] } });
  });
});

describe('資料のファイル（#201）', () => {
  test('種類: PDF・テキスト（.txt・.md も）だけ', () => {
    expect(fileKind('a.pdf', '')).toBe('application/pdf');
    expect(fileKind('x', 'application/pdf')).toBe('application/pdf');
    expect(fileKind('a.txt', '')).toBe('text/plain');
    expect(fileKind('メモ.md', 'text/markdown')).toBe('text/plain');
    expect(fileKind('a.docx', 'application/msword')).toBeNull();
  });

  test('上限を超えたら送らずに短い 1 行', () => {
    expect(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 4_000_000 })).toBeNull();
    expect(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 4_000_001 })).toBe('PDF は 4MB までです');
    expect(fileProblem({ name: 'a.txt', type: 'text/plain', size: 200_001 })).toBe('テキストは 200KB までです');
    expect(fileProblem({ name: 'a.png', type: 'image/png', size: 10 })).toBe('PDF かテキストのファイルを選んでください');
    for (const s of ['PDF は 4MB までです', 'テキストは 200KB までです']) expect(s.includes('\n')).toBe(false);
  });

  test('base64 は端末で作る（標準の結果と同じ・全角の空白も落とさない）', () => {
    for (const s of ['', 'a', 'ab', 'abc', '%PDF-1.4', '範囲　第1章']) {
      const bytes = new TextEncoder().encode(s);
      expect(bytesToBase64(bytes)).toBe(btoa(String.fromCharCode(...Array.from(bytes))));
    }
  });

  test('画面: Web だけ「ファイルを足す」を出し、native では出さない', () => {
    expect(canPickFiles('web')).toBe(true);
    expect(canPickFiles('ios')).toBe(false);
    expect(canPickFiles('android')).toBe(false);
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '../components/MaterialsField.tsx'), 'utf8');
    const at = src.indexOf('canPickFiles(Platform.OS)');
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf('label="ファイルを足す"', at)).toBeGreaterThan(at);
    expect(src).toContain('FILE_ACCEPT');
    expect(FILE_ACCEPT).toBe('application/pdf,text/plain,.txt,.md');
    expect(src).toContain('fileProblem(f)');
  });
});
