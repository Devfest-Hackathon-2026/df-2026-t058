import { HttpError } from './http.js';

// ユーザーごと・全体の 1 日あたりの「点」の制限（メモリ版。UTC の日付で区切る・再起動で戻る）。
// max-instances 1 の間はこれでよい。単価が分かったら Firestore に置く。
// take(userId, weight) は weight 点を数える（既定 1＝回数として使う所はそのまま動く・friends/routes.js）。
export function createLimiter({ perUserPerDay, totalPerDay, now = () => new Date() }) {
  let day = '';
  let total = 0;
  const perUser = new Map();

  function rollover() {
    const today = now().toISOString().slice(0, 10); // UTC の日付
    if (today !== day) {
      day = today;
      total = 0;
      perUser.clear();
    }
  }

  return {
    // その日にその人が使った点（数えない・試験と「先に止める」判定用）。
    used(userId) {
      rollover();
      return perUser.get(userId) || 0;
    },
    // weight 点を数える。足すと上限を超えるなら数えずに 429（契約 §2）。
    take(userId, weight = 1) {
      rollover();
      const w = Number.isFinite(weight) && weight >= 0 ? weight : 1;
      const used = perUser.get(userId) || 0;
      // 「使い切った」も止める（重み 0 の上書きでも、上限 0＝使わない を守るため）
      if (total + w > totalPerDay || used + w > perUserPerDay || total >= totalPerDay || used >= perUserPerDay) {
        throw new HttpError(429, 'rate_limited', '回数の上限に達しました');
      }
      perUser.set(userId, used + w);
      total += w;
    },
  };
}
