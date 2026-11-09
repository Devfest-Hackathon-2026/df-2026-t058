// 評価 3 軸の規則（契約 §3.6）。閾値と倍率はここ 1 か所だけ。**すべて仮**（本人の確認待ち・P5: 後から変えられる）。
// 速さ（早く終えた）を加点する項は作らない（P4）。作業時間は「階の数」にだけ効き、色や自分で決めた度には効かない。
// 階の閾値だけ環境変数で変えられる（デモ用）。数でない・0 以下・600 超は無視して既定を使う。
function numFromEnv(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 600) {
    console.log(`[rules] ${name}=${raw} は使えない値なので既定 ${fallback} を使う`);
    return fallback;
  }
  return n;
}

export function rulesFromEnv(env = {}) {
  const minMinutesForFloor = numFromEnv(env, 'FLOOR_MIN_MINUTES', 5);
  const minutesPerFloor = numFromEnv(env, 'FLOOR_MINUTES_PER_FLOOR', 15);
  return Object.freeze({
    // 仮: 階数＝作業時間 15 分ごとに 1 階。5 分以上なら最低 1 階、5 分未満は 0 階。
    minutesPerFloor,
    minMinutesForFloor,
    ...BASE_RULES,
  });
}

const BASE_RULES = {
  // 仮: 自分で決めた度（0〜100）＝出どころ − min(10×medium, 40)。small では引かない（11/9）。
  // 問い返し・考えの確認（small）は引かない。やり方の説明を受けた相談（medium）だけ引く。上限は、聞き続けても点が極端に下がらないため。
  own: Object.freeze({
    originOwn: 70, // ロードマップを自作
    originEditedBase: 50, // 案を直した: 50 + 20 × 直した割合
    originEditedRange: 20,
    originCandidate: 40, // 案をそのまま採った
    helpSmallPenalty: 0, // small（help_small）では引かない（11/9）
    helpSmallMax: 0,
    helpMediumPenalty: 10, // 相談で AI がやり方を説明した（help_medium）1 件につき
    helpMediumMax: 40, // medium だけで引く上限
    min: 0,
    max: 100,
  }),
  // 仮: 色。達成度は 0〜3。
  color: Object.freeze({
    gold: Object.freeze({ own: 70, achievement: 2 }),
    silver: Object.freeze({ own: 40, achievement: 1 }),
  }),
};

export const RULES = rulesFromEnv(process.env);

const round1 = (n) => Math.round(n * 10) / 10;

// 階数。focusMin（分・小数可）から。
export function floorsFor(focusMin, rules = RULES) {
  if (!(focusMin >= rules.minMinutesForFloor)) return 0;
  return Math.max(1, Math.floor(focusMin / rules.minutesPerFloor));
}

// ロードマップの出どころの点。
export function originScore(adopted, editRatio, rules = RULES) {
  const o = rules.own;
  if (adopted === 'own') return o.originOwn;
  if (adopted === 'edited') {
    const r = Number.isFinite(editRatio) ? Math.min(1, Math.max(0, editRatio)) : 0;
    return o.originEditedBase + o.originEditedRange * r;
  }
  // 'candidate'・'auto'（取り込んだタスク・#261）・不明な値は最も低い側（安全側）。
  // 'auto' は「自分で決めた」ではないので、週のまとめの平均（weekly/routes.js）からは外す。
  return o.originCandidate;
}

// 自分で決めた度（0〜100）。helpSmall・helpMedium は相談の度合いの件数（events の help_small・help_medium）。
export function ownScoreFor({ adopted, editRatio, helpSmall = 0, helpMedium = 0 }, rules = RULES) {
  const o = rules.own;
  const minusSmall = Math.min(o.helpSmallMax, helpSmall * o.helpSmallPenalty);
  const minusMedium = Math.min(o.helpMediumMax, helpMedium * o.helpMediumPenalty);
  const raw = originScore(adopted, editRatio, rules) - minusSmall - minusMedium;
  return round1(Math.min(o.max, Math.max(o.min, raw)));
}

// 点と色に使う達成度（契約 §3.6・本人の決定 C・11/9）＝本人の最終の判定と、AI の判定の低い方。
// 本人だけで最大にできない（盛れない）ため。本人の値が null なら 0。AI が判定できなかった（null・範囲外）時は本人の値。
export function scoredAchievement(achievement, aiAchievement) {
  const mine = Number.isInteger(achievement) ? achievement : 0;
  const ai = Number.isInteger(aiAchievement) && aiAchievement >= 0 && aiAchievement <= 3 ? aiAchievement : null;
  return ai === null ? mine : Math.min(mine, ai);
}

// 色。achievement は 0〜3（null は 0 として呼ぶ側が直す）。
export function colorFor(ownScore, achievement, rules = RULES) {
  const c = rules.color;
  if (ownScore >= c.gold.own && achievement >= c.gold.achievement) return 'gold';
  if (ownScore >= c.silver.own && achievement >= c.silver.achievement) return 'silver';
  return 'bronze';
}
