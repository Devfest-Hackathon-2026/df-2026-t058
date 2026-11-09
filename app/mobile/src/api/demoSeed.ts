// デモ用の見本を入れるボタンを出すか（ホームが空で、サーバーが demoSeed: true を返す時だけ）。
export function showDemoSeed(health: { demoSeed?: boolean } | null | undefined, goalCount: number): boolean {
  return goalCount === 0 && health?.demoSeed === true;
}
