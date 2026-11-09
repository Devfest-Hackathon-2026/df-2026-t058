// 相談の相手（AI）のキャラクター。名前と絵の参照は、ここ 1 か所だけが持つ（docs/character-brief-2026-11-07.md §2・§6 M1）。
// 名前は「モルティ」（英字 Molty）。画像の参照はこのファイルだけが持つ。

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;

import { MASCOT_NAME } from './appName'; // 名前の文字は appName.ts の 1 か所
export { MASCOT_NAME };

// Metro は require の中の文字をそのまま読むので、パスは式にせず書く
export const MASCOT_IMAGE: number = require('../../assets/mascot/molty/stills/01-greeting.png');

// 大きさ（px）: 返事の横のアイコンの直径・相談が空の時の高さ
export const MASCOT_ICON_SIZE = 38;
export const MASCOT_HERO_HEIGHT = 120;
// 集中の画面（compact）: 返事の横のアイコンの直径・会話が無い時の絵の高さと一言
export const MASCOT_COMPACT_ICON_SIZE = 32;
export const MASCOT_COMPACT_HERO_HEIGHT = 72;
export const MASCOT_COMPACT_HINT = '詰まったら話しかけてください。答えではなく、考える手がかりを出します。';

// ホームの上の帯の、アプリ名の左の小さなブランドの印（エビの珊瑚の丸）。キャラの絵は使わない（#181）。
// 出し入れはこの定数 1 つで行う
export const SHOW_BRAND_MARK = true;
export const BRAND_MARK_SIZE = 22;

export const MASCOT_ANIMATION_MS = 8000;
export const canAnimate = (reduce: boolean, focused: boolean, active: boolean): boolean => !reduce && focused && active;

// 静止画と実アニメーションは同じ場面の組。既存のidle/thinking/happyも引き続き使える。
export const MASCOT_POSES = {
  idle: MASCOT_IMAGE,
  start: require('../../assets/mascot/molty/stills/02-start.png'),
  roadmap: require('../../assets/mascot/molty/stills/03-roadmap.png'),
  compare: require('../../assets/mascot/molty/stills/04-compare.png'),
  focus: require('../../assets/mascot/molty/stills/05-focus.png'),
  thinking: require('../../assets/mascot/molty/stills/06-think-together.png'),
  happy: require('../../assets/mascot/molty/stills/07-checkpoint.png'),
  restart: require('../../assets/mascot/molty/stills/08-restart.png'),
  friends: require('../../assets/mascot/molty/stills/09-friend-notice.png'),
  reflection: require('../../assets/mascot/molty/stills/10-reflection.png'),
  tempura: require('../../assets/mascot/molty/stills/11-tempura.png'),
  molting: MASCOT_IMAGE,
};
export type MascotPose = keyof typeof MASCOT_POSES;
export const MASCOT_ANIMATIONS: Record<MascotPose, number> = {
  idle: require('../../assets/mascot/molty/animations/01-greeting.webp'),
  start: require('../../assets/mascot/molty/animations/02-start.webp'),
  roadmap: require('../../assets/mascot/molty/animations/03-roadmap.webp'),
  compare: require('../../assets/mascot/molty/animations/04-compare.webp'),
  focus: require('../../assets/mascot/molty/animations/05-focus.webp'),
  thinking: require('../../assets/mascot/molty/animations/06-think-together.webp'),
  happy: require('../../assets/mascot/molty/animations/07-checkpoint.webp'),
  restart: require('../../assets/mascot/molty/animations/08-restart.webp'),
  friends: require('../../assets/mascot/molty/animations/09-friend-notice.webp'),
  reflection: require('../../assets/mascot/molty/animations/10-reflection.webp'),
  tempura: require('../../assets/mascot/molty/animations/11-tempura.webp'),
  molting: require('../../assets/mascot/molty/animations/12-molting.webp'),
};

// 姿の選び方: 返事待ち＝thinking、何かが積まれた／できた＝happy、それ以外＝idle
export function poseFor(state: { waiting?: boolean; done?: boolean }): MascotPose {
  if (state.waiting) return 'thinking';
  if (state.done) return 'happy';
  return 'idle';
}

// 各画面のエビの発言（AgentSays）: 絵の直径。高さ 700px 未満の画面では小さくし、発言を 1 文にする
export const AGENT_ICON_SIZE = 88;
export const AGENT_SMALL_ICON_SIZE = 64;
export const SMALL_SCREEN_HEIGHT = 700;
export const isSmallScreen = (height: number): boolean => height < SMALL_SCREEN_HEIGHT;
