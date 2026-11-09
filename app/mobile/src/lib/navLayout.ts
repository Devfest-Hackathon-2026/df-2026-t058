// 下タブと PC の左レールの決め方。画面から切り出して試験する（React を読まない純粋な関数）。

export const RAIL_MIN_WIDTH = 900; // これ以上の幅の Web では、タブを左のレールにする
export const RAIL_WIDTH = 88;
export const COLUMN_WIDTH = 560; // 本文の列の幅（ui.tsx の Screen と同じ）

// タブの並び。name は (tabs)/ の中のファイル名（URL は / ・ /tower ・ /friends のまま）
export const TABS = [
  { name: 'index', title: '今日', path: '/' },
  { name: 'tower', title: '建物', path: '/tower' },
  { name: 'friends', title: '友達', path: '/friends' },
] as const;

export type TabName = (typeof TABS)[number]['name'];

export function isRail(width: number, os: string): boolean {
  return os === 'web' && width >= RAIL_MIN_WIDTH;
}

export interface TabBarLook {
  tabBarPosition: 'bottom' | 'left';
  // 左のレールでアイコンの下に文字を置けるのは material の形だけ（uikit で below-icon を左に置くと落ちる）
  tabBarVariant: 'uikit' | 'material';
  tabBarLabelPosition: 'below-icon';
  railWidth: number | null;
}

export function tabBarLookFor(width: number, os: string): TabBarLook {
  return isRail(width, os)
    ? { tabBarPosition: 'left', tabBarVariant: 'material', tabBarLabelPosition: 'below-icon', railWidth: RAIL_WIDTH }
    : { tabBarPosition: 'bottom', tabBarVariant: 'uikit', tabBarLabelPosition: 'below-icon', railWidth: null };
}

// 上の帯の左に戻る矢印を出すか。画面が「出さない」と決めた時（集中・振り返り）は出さない
export function showBackFor(opts: { hideBack?: boolean; hasHeaderLeft?: boolean }): boolean {
  return !opts.hideBack && !opts.hasHeaderLeft;
}

// 本文を 2 列に分けるか（案から選ぶ画面など）。左のレールと同じ 900px で切り替える。
// 幅だけで決める（iPad の横向きなど、Web 以外の広い画面も 2 列にする）
export const TWO_COLUMN_MIN_WIDTH = RAIL_MIN_WIDTH;

export function columnsFor(width: number): 1 | 2 {
  return width >= TWO_COLUMN_MIN_WIDTH ? 2 : 1;
}
