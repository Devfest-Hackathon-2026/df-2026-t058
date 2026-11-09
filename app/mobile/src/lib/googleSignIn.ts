// Google でログイン（Issue #213・Web だけ・契約 §3.0b）。
// GIS の google.accounts.id でボタンを描き、押されたら ID トークン（credential）を受け取って呼び出し側に渡す。
// credential は保存しない・ログに出さない（すぐ POST /api/login/google に送るだけ）。

import { loadGis, type GoogleLike } from './googleCalendar';

export { showGoogleButton as showGoogleSignIn } from './googleCalendar';

// GIS の応答から credential を取り出す（無い・空なら null）
export function credentialOf(r: unknown): string | null {
  const c = (r as { credential?: unknown } | null)?.credential;
  return typeof c === 'string' && c.length > 0 ? c : null;
}

export const BUTTON_OPTIONS = { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' } as const;

// ボタンを el に描く。読み込めない時は false（呼び出し側はボタンを出さないだけ）。
export async function renderSignInButton(
  clientId: string,
  el: unknown,
  onCredential: (credential: string) => void,
  load: () => Promise<GoogleLike> = () => loadGis(),
): Promise<boolean> {
  let google: GoogleLike;
  try {
    google = await load();
  } catch {
    return false;
  }
  const id = google.accounts.id;
  if (!id || !el) return false;
  id.initialize({
    client_id: clientId,
    callback: (r) => {
      const c = credentialOf(r);
      if (c) onCredential(c);
    },
  });
  id.renderButton(el, { ...BUTTON_OPTIONS, locale: 'ja' });
  return true;
}
