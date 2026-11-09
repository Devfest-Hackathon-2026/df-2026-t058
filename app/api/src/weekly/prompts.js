// 週のまとめ（GET /api/weekly・#202）で Gemini に渡す指示と入力。
// 渡すのは数字だけ（利用者の文＝目標・メモ・相談は渡さない）。数字はサーバーが計算し、AI は文だけを書く。
import { mascotName, TONE_RULE } from '../tutor/prompts.js';

export const MAX_SUMMARY_CHARS = 240;
export const MAX_SUMMARY_LINES = 3;

export const WEEKLY_SCHEMA = {
  type: 'object',
  required: ['lines'],
  properties: { lines: { type: 'array', items: { type: 'string' } } },
};

export const STAT_KEYS = ['focusMinutes', 'sessions', 'floorsAdded', 'streak', 'helpSmall', 'helpMedium', 'selfDecided'];

const LABELS = {
  focusMinutes: '集中した分',
  sessions: '集中の回数',
  floorsAdded: '積んだ階',
  streak: '連続日数',
  helpSmall: 'AI に借りた手（小＝問い返し・考えの確認）',
  helpMedium: 'AI に借りた手（中＝やり方の説明）',
  selfDecided: '自分で決めた度（0〜100・平均）',
};

// 固定文。利用者が書いた文は混ぜない（名前は mascotName() で無害にした物）。
export function weeklySystem(name = mascotName()) {
  return `あなたは「${name}」です。利用者の 1 週間の学びの記録を、本人に短く返す係です。
- ${TONE_RULE}一人称や自分の名前は使いません。
- 渡すのはサーバーが計算した数字だけです。数字を作りません。渡された数字以外の数を書きません（計算した差も書きません）。
- 速さや量（時間の長さ・回数・階の多さ）をほめません。「すごい」「えらい」「がんばりました」などの励ましの定型句、絵文字は使いません。
- 前の週の数字があれば、量ではなく「やり方」の変化に触れます（例: AI に借りた手が減った・自分で決めた度が上がった・取り組んだ日が続いた）。前の週が無ければ、今週のやり方を 1 つだけ述べます。
- 最後の行は「次の一歩」を 1 つだけ提案します（やり方の工夫。課題の答えや中身は書きません）。
- lines は 1〜${MAX_SUMMARY_LINES} 行。1 行は 1 文で短く。合計 ${MAX_SUMMARY_CHARS} 字以内。
- 出力は指定された JSON の形だけです。`;
}

function block(title, stats) {
  return [title, ...STAT_KEYS.map((k) => `- ${LABELS[k]}: ${stats[k] === null ? 'なし' : stats[k]}`)].join('\n');
}

export function buildWeeklyInput({ stats, previous }) {
  const parts = [block('【今週（今日を含む直近 7 日）】', stats)];
  parts.push(previous ? block('【前の週（その前の 7 日）】', previous) : '【前の週】記録なし');
  parts.push('', '今週のまとめを書いてください。');
  return { system: weeklySystem(), user: parts.join('\n') };
}
