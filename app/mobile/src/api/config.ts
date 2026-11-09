// どちらのモードで動くか。EXPO_PUBLIC_ の変数は書き出しの時に値が埋め込まれる（秘密は置かない）。

export type ApiMode = 'real' | 'mock';

export interface ApiConfig {
  mode: ApiMode;
  baseUrl: string;
  mockSpeed: number;
}

export const SAME_ORIGIN = 'same-origin';

export function readConfig(env: Record<string, string | undefined>): ApiConfig {
  const mode: ApiMode = env.EXPO_PUBLIC_API_MODE === 'mock' ? 'mock' : 'real';
  const url = (env.EXPO_PUBLIC_API_URL || 'http://localhost:8080').trim();
  // 'same-origin' は、画面を配ったサーバー自身へ呼ぶ（Cloud Run の 1 つの入れ物）。空文字＝今の origin への相対パス（/api/...）。
  const baseUrl = url === SAME_ORIGIN ? '' : url;
  const speed = Number(env.EXPO_PUBLIC_MOCK_SPEED);
  return { mode, baseUrl, mockSpeed: Number.isFinite(speed) && speed > 0 ? speed : 1 };
}
