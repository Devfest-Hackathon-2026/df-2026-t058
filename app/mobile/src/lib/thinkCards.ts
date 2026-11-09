// 集中の画面の「取り組み中の場面」の札（#194）: 手が止まった／合ってるか確認／メモ。
// 札ごとの薄い例・送れるか・送る本文・intent を、画面に依らずここで決める（components/TutorChat.tsx が使う）。

import type { TutorIntent, TutorRequest, TutorResult } from '../api/types';
import {
  COPY_CARD_CHECK,
  COPY_CARD_MEMO,
  COPY_CARD_STUCK,
  COPY_CHECK_PHOTO_ONLY,
  COPY_HINT_CHECK,
  COPY_HINT_MEMO,
  COPY_HINT_STUCK,
} from './copy';

export type ThinkCard = 'stuck' | 'check' | 'memo';

export const THINK_CARDS: readonly { card: ThinkCard; label: string }[] = [
  { card: 'stuck', label: COPY_CARD_STUCK },
  { card: 'check', label: COPY_CARD_CHECK },
  { card: 'memo', label: COPY_CARD_MEMO },
];

// 札の名前を課題に合わせる（11/9 本人「固定にしない」）。題と「できたの目印」の言葉で、取り組みの種類を見分ける。
// 働き（stuck＝考えを書いてヒント 1 段・check＝自分の答えを見せて確かめる・memo＝端末に残す）は変えない（P2）。
// AI は呼ばない（集中を始めた瞬間に出したいので、待たせない）。どれにも当たらなければ今の札のまま。
const CARD_KINDS: readonly { re: RegExp; stuck: string; check: string; memo: string }[] = [
  { re: /問題|解く|解け|計算|過去問|演習|証明|式|ドリル/, stuck: '解き方が浮かばない', check: '答えを確かめたい', memo: '解き方をメモ' },
  { re: /書く|書け|レポート|作文|小論|エッセイ|構成|スライド|原稿|まとめる/, stuck: '書き出せない', check: '構成が合ってるか', memo: '案をメモ' },
  { re: /読む|読め|読み|文献|論文|教科書|章|p\./, stuck: '内容がつかめない', check: '読み取りが合ってるか', memo: '要点をメモ' },
  { re: /覚え|暗記|単語|用語|語彙/, stuck: '覚えられない', check: '覚えたか確かめる', memo: '覚え方をメモ' },
  { re: /作る|実装|コード|プログラム|アプリ|動か/, stuck: '進め方が分からない', check: '動きが合ってるか', memo: '気づきをメモ' },
  { re: /練習|発音|スピーチ|面接|音読|話す/, stuck: 'うまくできない', check: 'できているか確かめる', memo: '気づきをメモ' },
];
export function cardsFor(cp: { title?: string | null; doneMark?: string | null } | null | undefined): readonly { card: ThinkCard; label: string }[] {
  const words = `${cp?.title ?? ''} ${cp?.doneMark ?? ''}`;
  const k = CARD_KINDS.find((x) => x.re.test(words));
  if (!k) return THINK_CARDS;
  return [
    { card: 'stuck', label: k.stuck },
    { card: 'check', label: k.check },
    { card: 'memo', label: k.memo },
  ];
}

// サーバーが intent を受けるようになったら true にする（#194 の時点の main のサーバーには intent が無い）。
// false の間も札の動き（薄い例・送れる条件）は効く。
export const TUTOR_SEND_INTENT = false;

// 「手が止まった」の書き出し（押すと入力欄に入る）
export const STUCK_STARTERS: readonly string[] = ['分かっているのは', '次に思いつくのは'];

// 札 → 送る intent。札なし・メモは付けない（自由に聞く）
export function intentOf(card: ThinkCard | null): TutorIntent | undefined {
  return card === 'stuck' || card === 'check' ? card : undefined;
}

// 札ごとの入力欄の薄い例。札なしは呼ぶ側の既定
export function hintOf(card: ThinkCard | null, fallback: string): string {
  if (card === 'stuck') return COPY_HINT_STUCK;
  if (card === 'check') return COPY_HINT_CHECK;
  if (card === 'memo') return COPY_HINT_MEMO;
  return fallback;
}

// 送れるか。手が止まった＝自分の考えが要る（書き出しだけでは送れない）。合ってるか確認＝本文か写真が要る
export function canSend(card: ThinkCard | null, text: string, photoCount: number): boolean {
  const t = text.trim();
  if (card === 'check') return t.length > 0 || photoCount > 0;
  if (card === 'stuck') return t.length > 0 && !STUCK_STARTERS.includes(t);
  return t.length > 0;
}

// 送る本文。写真だけの「合ってるか確認」は決まった一文を付ける（サーバーは本文 1 字以上が要る）
export function sendText(card: ThinkCard | null, text: string, photoCount: number): string {
  const t = text.trim();
  return !t && card === 'check' && photoCount > 0 ? COPY_CHECK_PHOTO_ONLY : t;
}

// 書き出しの札を押した時: 欄が空なら書き出しを入れ、書いてあれば後ろに足さない（消さない）
export function applyStarter(cur: string, starter: string): string {
  return cur.trim() ? cur : starter;
}

// 送る関数に intent を足す（無い時・送らない設定の時はそのまま）
export function withIntent(
  call: (sessionId: string, body: TutorRequest) => Promise<TutorResult>,
  intent: TutorIntent | undefined,
  enabled: boolean = TUTOR_SEND_INTENT,
): (sessionId: string, body: TutorRequest) => Promise<TutorResult> {
  if (!intent || !enabled) return call;
  return (sessionId, body) => call(sessionId, { ...body, intent });
}
