// 声で入力欄を埋める（#255）。話した声を文字にして、今の値の末尾に足す。自動では送らない。
// ここは画面に依存しない関数だけ（試験できるように）。書き起こしの文は保存しない・ログに出さない。

export const TRANSCRIBE_FAIL = '文字にできませんでした。もう一度';
export const TRANSCRIBE_TOO_LONG = '長すぎました。短く話し直してください';

// 前後の空白（全角の空白「　」も）
const EDGE_SPACE = /^[\s　]+|[\s　]+$/g;
const TAIL_SPACE = /[\s　]+$/;

// 今の値の末尾に、空白 1 つを挟んで書き起こしを足す。書き起こしが空なら今の値のまま。max があればその字数で切る
export function appendTranscript(current: string, text: string, max?: number): string {
  const add = text.replace(EDGE_SPACE, '');
  if (!add) return current;
  const head = current.replace(TAIL_SPACE, '');
  const joined = head ? `${head} ${add}` : add;
  return max !== undefined && max >= 0 ? joined.slice(0, max) : joined;
}

// 書き起こしに失敗した時の 1 行。413（約 1.5MB・約 60 秒を超えた）は「短く話し直して」
export function transcribeErrorText(e: unknown): string {
  const err = e as { status?: unknown; code?: unknown } | null;
  if (err && (err.status === 413 || err.code === 'too_large')) return TRANSCRIBE_TOO_LONG;
  return TRANSCRIBE_FAIL;
}

// 入力欄にマイクを出すか（voice を付けた欄で、録音できる端末の時だけ）
export function fieldMicShown(voice: boolean | undefined, canRecord: boolean): boolean {
  return voice === true && canRecord;
}
