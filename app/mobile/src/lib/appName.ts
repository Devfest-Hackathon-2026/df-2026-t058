// アプリとエージェントの名前（ここ 1 か所）。画面・通知・題は日本語、英字が要る所（expo.name・ログ等）は _EN。
// 見出しに出す名前。app.json の expo.name は英字（MolTower）なので、画面には渡さず、この既定の名前を使う。

export const DEFAULT_APP_NAME = 'モル塔';
export const APP_NAME_EN = 'MolTower';
export const APP_SUBTITLE = '考え続ける力を育てる';
export const MASCOT_NAME = 'モルティ';
export const MASCOT_NAME_EN = 'Molty';

export function appNameFrom(configName: unknown): string {
  if (typeof configName !== 'string') return DEFAULT_APP_NAME;
  const t = configName.trim();
  return t.length > 0 ? t : DEFAULT_APP_NAME;
}
