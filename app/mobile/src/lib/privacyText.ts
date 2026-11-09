// プライバシーポリシーの本文（Issue #238）。画面（app/privacy.tsx）はこれを描くだけ。
// 書いてある事実の根拠は docs/privacy-policy-sources.md。コードの扱いを変えたら、ここも直す。

import { COPY_AGE_LIMIT_FULL } from './copy';

export const PRIVACY_TITLE = 'プライバシーポリシー';
export const PRIVACY_UPDATED = '2026-11-09';
export const PRIVACY_CONTACT = 'y2studyabout@gmail.com';

// ログインしていなくても開ける画面（AuthGate を通さない）
export const PUBLIC_PATHS = ['/privacy'] as const;
export const isPublicPath = (pathname: string | null | undefined): boolean =>
  (PUBLIC_PATHS as readonly string[]).includes((pathname ?? '').replace(/\/+$/, '') || '/');

export type PrivacySection = { heading: string; lines: string[] };

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    heading: '運営者と連絡先',
    lines: [
      'このアプリ「モル塔」は、チーム「考え続ける」が運営しています。',
      `お問い合わせ: ${PRIVACY_CONTACT}`,
    ],
  },
  {
    heading: 'ご利用の条件',
    lines: [COPY_AGE_LIMIT_FULL],
  },
  {
    heading: 'お預かりする情報',
    lines: [
      'ログインに使う表示名と、設定（通知の強さ）。',
      '目標の文・期限、選んだ段取りと、それを選んだ理由。',
      '集中の記録（始めた時刻・終えた時刻・離れた回数）と、振り返りのメモや結果。',
      '本人が入力欄に入れた資料の文（写真や資料から書き起こした文を含む）。',
      'AI への相談の文と、AI の返事。',
      '友達のつながり（友達コードと、だれと友達か）。',
      '通知を受け取ると決めた端末の、通知の宛先。',
    ],
  },
  {
    heading: '保存しない物',
    lines: [
      '写真・音声・PDF などの資料そのものは、AI で読んだり文字にしたりするためだけに使い、サーバーには保存しません。',
      'Google から受け取る許可の鍵（トークン）は、サーバーにも端末にも保存しません。',
    ],
  },
  {
    heading: 'Google のデータの扱い',
    lines: [
      'Google カレンダーと Google Classroom は、本人が許可した時だけ使います。課題の取り込みでは、読み取り専用で読みます。',
      '「カレンダーに入れる」を押した時だけ、その提案を予定として 1 件、Google カレンダーに書き込みます。目標の画面では、押した時だけ、目標の期限とステップの日を予定として書き込みます。書き込みの許可は、その時に、読み取りとは別に求めます。',
      '読むのはお使いのブラウザで、サーバーは Google のデータを直接受け取りません。',
      'カレンダーは予定の題・日時・説明の先頭、Classroom はクラス名・課題の題・期限・説明の先頭だけを入力欄に入れます。',
      '入力欄の文は、本人が「課題を拾う」を押した時だけサーバーに送られます。',
      'ログインは、表示名と招待コード、または「Google でログイン」で行います。Google でログインした場合も、メールアドレスは保存しません。保存するのは、名前（名）と、本人を見分けるための番号（Google の ID から作った値）だけです。',
      "MolTower's use and transfer to any other app of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements.",
      '（Google の API から受け取った情報の利用と他のアプリへの受け渡しは、「Google API サービスのユーザーデータに関するポリシー」の限定的な使用の要件を含めて、それに従います。）',
    ],
  },
  {
    heading: 'AI（Gemini）での処理',
    lines: [
      '段取りの案・相談の返事・振り返りの判定・資料や音声の書き起こし・課題の読み取りのために、Google Cloud の Vertex AI の Gemini に、その時に必要な文・写真・資料・音声を送ります。',
    ],
  },
  {
    heading: '保存先と期間',
    lines: [
      'お預かりした情報は、Google Cloud の Firestore に保存します。',
      'ハッカソンの審査が終わった後に、まとめて削除します。',
    ],
  },
  {
    heading: '削除のご依頼',
    lines: [`ご自分の情報を消してほしい時は、${PRIVACY_CONTACT} までご連絡ください。`],
  },
];
