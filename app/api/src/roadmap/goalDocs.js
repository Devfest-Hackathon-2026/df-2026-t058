// 目標の資料（契約 §3.3 GoalDoc・11/9 追加）。文字だけを残す（写真は読み取った文字にして捨てる・P10）。
// Gemini に渡す時は、前からの goal.materials と docs の text を古い順につなぎ、合わせて GOAL_MATERIALS_MAX 字まで（超えたら古い方から削る）。
import { randomUUID } from 'node:crypto';

export const GOAL_DOCS_MAX = 10;
export const GOAL_DOC_TEXT_MAX = 2000;
export const GOAL_DOC_TITLE_MAX = 40;
export const GOAL_MATERIALS_MAX = 6000;
export const DOC_FROM = ['goal', 'plan', 'focus', 'reflect'];

export function titleFrom(text) {
  const first = String(text).split('\n').map((x) => x.trim()).find(Boolean) ?? '資料';
  return [...first].slice(0, GOAL_DOC_TITLE_MAX).join('');
}

export function newDoc({ text, title, from }, at) {
  return { id: randomUUID(), title: title ?? titleFrom(text), text, from, addedAt: at };
}

// Gemini に渡す「目標の資料」。無ければ ''
export function goalMaterials(goal) {
  const parts = [];
  if (goal?.materials && goal.materials.trim()) parts.push(goal.materials.trim());
  for (const d of goal?.docs ?? []) if (d?.text?.trim()) parts.push(`【${d.title}】\n${d.text.trim()}`);
  let joined = parts.join('\n\n');
  while ([...joined].length > GOAL_MATERIALS_MAX && parts.length > 1) {
    parts.shift(); // 古い方から削る
    joined = parts.join('\n\n');
  }
  return [...joined].slice(-GOAL_MATERIALS_MAX).join('');
}
