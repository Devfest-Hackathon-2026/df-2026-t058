// API のエラー。契約 §2 の { error: { code, message } } を 1 つの型にまとめる。
// 通信できなかった時は code = 'network'、形の分からない応答は 'internal'。

import { COPY_OFFLINE, COPY_UPSTREAM_BUSY } from '../lib/copy';

export type ErrorCode =
  | 'invalid_argument'
  | 'unauthenticated'
  | 'invalid_code'
  | 'forbidden'
  | 'conflict'
  | 'not_found'
  | 'too_large'
  | 'rate_limited'
  | 'upstream_invalid'
  | 'upstream_busy'
  | 'internal'
  | 'network';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;

  constructor(status: number, code: ErrorCode | string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const fallbackCode = (status: number): ErrorCode => {
  if (status === 400) return 'invalid_argument';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 502) return 'upstream_invalid';
  if (status === 503) return 'upstream_busy';
  return 'internal';
};

// 失敗の応答の本文（文字列）から ApiError を作る。本文が契約の形でなくても落ちない。
export function errorFromBody(status: number, bodyText: string): ApiError {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    const err = (parsed as { error?: { code?: unknown; message?: unknown } })?.error;
    if (err && typeof err.code === 'string') {
      const message = typeof err.message === 'string' ? err.message : '';
      return new ApiError(status, err.code, message);
    }
  } catch {
    // JSON でない（プロキシの HTML など）
  }
  return new ApiError(status, fallbackCode(status), '');
}

// 画面に出す短い文。サーバーの message は人間向けだが長さが分からないので、code で決める。
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'うまくいきませんでした';
  switch (e.code) {
    case 'network':
      return COPY_OFFLINE;
    case 'rate_limited':
      return '今日はここまでです。明日また使えます';
    case 'upstream_invalid':
      return 'モルティの返事を受け取れませんでした。もう一度押してください';
    case 'upstream_busy':
      return COPY_UPSTREAM_BUSY;
    case 'too_large':
      return '大きすぎます';
    case 'conflict':
      return e.message || '進行中の集中があります';
    case 'invalid_argument':
      return e.message || '受け付けられない内容でした。見直してもう一度押してください';
    case 'not_found':
      return '見つかりません';
    case 'invalid_code':
      return 'コードが違います';
    case 'unauthenticated':
    case 'forbidden':
      return 'ログインできませんでした';
    default:
      return 'うまくいきませんでした';
  }
}
