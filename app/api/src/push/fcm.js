// FCM（HTTP v1）で 1 端末へ送る（#298・依存パッケージなし）。
// 出典: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send
//       https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
// 文は固定＋表示名の差し込みだけ（AI は呼ばない）。トークン・本文はログに出さない。
export const FCM_TITLE = 'モル塔';
export const MAX_BODY = 40;
const MAX_NAME = 20;

export const NUDGE_MESSAGE = Object.freeze({ body: '今日の取り組み、5 分だけ始めませんか', type: 'nudge', route: '/' });
// 夜の催促: 今日始めた友達がいれば名前を入れる（名前は 10 字まで・契約 §3.7c）
export function nudgeMessage(friendName) {
  const body = nudgeBody(friendName);
  return body === NUDGE_MESSAGE.body ? NUDGE_MESSAGE : { ...NUDGE_MESSAGE, body };
}
const MAX_NUDGE_NAME = 10;
export function nudgeBody(friendName) {
  const chars = [...String(friendName ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()];
  if (chars.length === 0) return NUDGE_MESSAGE.body;
  const name = chars.length > MAX_NUDGE_NAME ? `${chars.slice(0, MAX_NUDGE_NAME - 1).join('')}…` : chars.join('');
  return `${name}さんは今日もう始めています。5 分だけやりませんか`;
}

// 友達が始めた時の文。名前は制御文字を除き 20 字まで（本文は 40 字以内に収まる）。名前が無ければ「友達」。
export function friendStartMessage(displayName) {
  const chars = [...String(displayName ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()];
  const name = chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME - 1).join('')}…` : chars.join('');
  // 友達から見た言葉は「取り組み」（11/9 本人）。開くのはホーム（一番上に友達の列）
  return { body: name ? `${name}さんが取り組みを始めました` : '友達が取り組みを始めました', type: 'friend_start', route: '/' };
}

export function buildMessage(token, { body, type, route }) {
  return { message: { token, notification: { title: FCM_TITLE, body }, data: { type, route } } };
}

// 結果は 'ok'／'gone'（登録を消す: 404 UNREGISTERED・400 INVALID_ARGUMENT）／'failed'（数えるだけ）。
export async function sendFcm({ projectId, token, msg, access, fetchImpl = fetch }) {
  try {
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMessage(token, msg)),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'ok';
    if (res.status !== 404 && res.status !== 400) return 'failed';
    const err = (await res.json().catch(() => null))?.error;
    const codes = Array.isArray(err?.details) ? err.details.map((d) => d?.errorCode) : [];
    if (res.status === 404 && codes.includes('UNREGISTERED')) return 'gone';
    if (res.status === 400 && (err?.status === 'INVALID_ARGUMENT' || codes.includes('INVALID_ARGUMENT'))) return 'gone';
    return 'failed';
  } catch {
    return 'failed';
  }
}
