import { APP_NAME_EN, APP_SUBTITLE, appNameFrom, DEFAULT_APP_NAME, MASCOT_NAME, MASCOT_NAME_EN } from '../lib/appName';

describe('appNameFrom', () => {
  it('設定の名前をそのまま使う（前後の空白は除く）', () => {
    expect(appNameFrom('モル塔')).toBe('モル塔');
    expect(appNameFrom('  名前  ')).toBe('名前');
  });
  it('無い・空・文字でない時は既定の名前', () => {
    expect(appNameFrom(undefined)).toBe(DEFAULT_APP_NAME);
    expect(appNameFrom(null)).toBe(DEFAULT_APP_NAME);
    expect(appNameFrom('   ')).toBe(DEFAULT_APP_NAME);
    expect(appNameFrom(42)).toBe(DEFAULT_APP_NAME);
  });
  it('既定は「モル塔」。英字・サブタイトル・エージェント名も決まっている', () => {
    expect(DEFAULT_APP_NAME).toBe('モル塔');
    expect(APP_NAME_EN).toBe('MolTower');
    expect(APP_SUBTITLE).toBe('考え続ける力を育てる');
    expect(MASCOT_NAME).toBe('モルティ');
    expect(MASCOT_NAME_EN).toBe('Molty');
  });
});
