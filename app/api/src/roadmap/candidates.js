import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { AXES, AXIS_MAX, AXIS_MIN } from './axes.js';
import {
  CANDIDATES_MAX,
  CANDIDATE_CHECKPOINTS,
  DONE_MARK_MAX,
  ESTIMATE_MIN,
  LABEL_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
} from './limits.js';

const reject = (why) => {
  // 中身は返さない（契約 §2・502）。調べる用にログへ。
  console.error('roadmap candidates rejected:', why);
  return new HttpError(502, 'upstream_invalid', 'AI の出力が期待した形ではありません');
};

function text(v, max, where) {
  if (typeof v !== 'string') throw reject(`${where}: string ではありません`);
  const t = v.trim();
  if (t.length < 1 || t.length > max) throw reject(`${where}: 1〜${max} 文字ではありません`);
  return t;
}

// Gemini の出力（schema 検査済み）を、個数・範囲・文字数まで検査して案にする。外れたら 502。
// 案とチェックポイントの ID はここでサーバーが付ける（AI の出力の ID は使わない）。
export function toCandidates(output) {
  const list = output.candidates;
  if (list.length < 1 || list.length > CANDIDATES_MAX) throw reject(`案の数: ${list.length}`);
  return list.map((c, i) => {
    const w = `candidates[${i}]`;
    const cps = c.checkpoints;
    if (cps.length < CANDIDATE_CHECKPOINTS.min || cps.length > CANDIDATE_CHECKPOINTS.max) {
      throw reject(`${w}: チェックポイントの数 ${cps.length}`);
    }
    const axes = {};
    for (const a of AXES) {
      const v = c.axes[a.key];
      if (!Number.isInteger(v) || v < AXIS_MIN || v > AXIS_MAX) throw reject(`${w}.axes.${a.key}: ${v}`);
      axes[a.key] = v; // 設定に無い軸が混ざっていても捨てる
    }
    return {
      id: randomUUID(),
      label: text(c.label, LABEL_MAX, `${w}.label`),
      summary: text(c.summary, SUMMARY_MAX, `${w}.summary`),
      checkpoints: cps.map((p, j) => {
        const pw = `${w}.checkpoints[${j}]`;
        if (!Number.isInteger(p.estimateMin) || p.estimateMin < ESTIMATE_MIN.min || p.estimateMin > ESTIMATE_MIN.max) {
          throw reject(`${pw}.estimateMin: ${p.estimateMin}`);
        }
        return {
          id: randomUUID(),
          order: j + 1,
          title: text(p.title, TITLE_MAX, `${pw}.title`),
          doneMark: text(p.doneMark, DONE_MARK_MAX, `${pw}.doneMark`),
          estimateMin: p.estimateMin,
        };
      }),
      axes,
    };
  });
}

// 試験・開発用の偽の応答（GEMINI_MODE=fake で roadmap が 502 にならないようにする時に使う）。
// createGemini({ mode: 'fake', fakeResponses: { roadmap: fakeRoadmap } })
export function fakeRoadmap() {
  const axes = (n) => Object.fromEntries(AXES.map((a, i) => [a.key, ((n + i) % 5) + 1]));
  const cps = (prefix, sizes) =>
    sizes.map((m, i) => ({ title: `${prefix}${i + 1}`, doneMark: `${prefix}${i + 1}ができた`, estimateMin: m }));
  return {
    candidates: [
      { label: '小さく刻む', summary: '毎日少しずつ進める案', checkpoints: cps('刻む', [20, 20, 30, 30]), axes: axes(0) },
      { label: 'まとめて進める', summary: 'まとまった時間で一気に進める案', checkpoints: cps('まとめ', [60, 90, 60]), axes: axes(1) },
      { label: '先に試す', summary: '小さく試してから本体に進む案', checkpoints: cps('試す', [15, 30, 45, 45, 30]), axes: axes(2) },
    ],
  };
}
