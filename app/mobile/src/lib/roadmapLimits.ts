// ロードマップの欄の範囲。画面と mock はここだけを見る。
// 【仮】契約 §3.3 に範囲が書かれていないので、いまのサーバー（app/api/src/roadmap/limits.js）に合わせた。
// 契約に書いたら、ここを契約の値に合わせる。

import type { CheckpointInput } from '../api/types';

export const STEPS_MIN = 3; // 自作・直した後の個数（サーバーの OWN_CHECKPOINTS）
export const STEPS_MAX = 12;
export const TITLE_MAX = 100;
export const DONE_MARK_MAX = 200;
export const ESTIMATE_MIN = 1; // 分
export const ESTIMATE_MAX = 6000;

// 直す・自分で作るの中身に足りない所があれば、短い文で返す。無ければ null。
export function stepsProblem(steps: CheckpointInput[]): string | null {
  if (steps.length < STEPS_MIN) return `チェックポイントを ${STEPS_MIN} つ以上にしてください`;
  if (steps.length > STEPS_MAX) return `チェックポイントは ${STEPS_MAX} 個までです`;
  if (steps.some((s) => !s.title.trim() || !s.doneMark.trim())) return '空の欄があります';
  if (steps.some((s) => s.title.length > TITLE_MAX)) return `やることは ${TITLE_MAX} 字までです`;
  if (steps.some((s) => s.doneMark.length > DONE_MARK_MAX)) return `完了の目印は ${DONE_MARK_MAX} 字までです`;
  // 見積りは省略可（#268・無い行はサーバーが決める）。ある時だけ範囲を見る
  if (steps.some((s) => s.estimateMin !== undefined && !(s.estimateMin >= ESTIMATE_MIN && s.estimateMin <= ESTIMATE_MAX)))
    return `見積りは ${ESTIMATE_MIN}〜${ESTIMATE_MAX} 分にしてください`;
  return null;
}
