// 資料の取り込み欄の状態。空 → 読み取り中 → 文字（本人が直せる）／失敗。画面から切り離して試験できるようにした純粋な関数。
// 文字そのものは親（画面）が持つ。ここは「いまどの段階か」と、文字の足し方だけ。

export const MAX_MATERIALS = 2000;

export type MaterialsPhase = 'idle' | 'reading' | 'failed';

export type MaterialsAction = { type: 'start' } | { type: 'done' } | { type: 'fail' };

export function materialsPhase(_prev: MaterialsPhase, a: MaterialsAction): MaterialsPhase {
  switch (a.type) {
    case 'start':
      return 'reading';
    case 'done':
      return 'idle';
    case 'fail':
      return 'failed';
  }
}

// 読めた文字を、いまの文字の後ろに足す（2000 字まで）。空なら null（読めなかった扱い）
export function appendText(current: string, add: string): string | null {
  const a = add.trim();
  if (!a) return null;
  const joined = current.trim() ? `${current.trimEnd()}\n${a}` : a;
  return joined.slice(0, MAX_MATERIALS);
}

// ---- ファイル（PDF・テキスト・#201）。選べるのは Web だけ ----
type FileType = 'application/pdf' | 'text/plain';
export const MAX_MATERIAL_FILES = 2;
// 1 件の上限（バイト）。契約 §3.7b と同じ
export const MATERIAL_FILE_LIMITS: Record<FileType, number> = { 'application/pdf': 4_000_000, 'text/plain': 200_000 };
export const FILE_ACCEPT = 'application/pdf,text/plain,.txt,.md';
export const canPickFiles = (os: string) => os === 'web';

// 選んだファイルの種類（拡張子でも判断する。.md は text/markdown や空で来るため）。対象外は null
export function fileKind(name: string, type: string): FileType | null {
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'application/pdf';
  if (type === 'text/plain' || /\.(txt|md)$/i.test(name)) return 'text/plain';
  return null;
}

// 送る前の検査。問題があれば画面に出す短い 1 行、無ければ null
export function fileProblem(f: { name: string; type: string; size: number }): string | null {
  const kind = fileKind(f.name, f.type);
  if (kind === null) return 'PDF かテキストのファイルを選んでください';
  if (f.size > MATERIAL_FILE_LIMITS[kind]) return kind === 'application/pdf' ? 'PDF は 4MB までです' : 'テキストは 200KB までです';
  return null;
}

// バイト列を base64 にする（端末の中だけで変換・新しいパッケージを足さない）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}
