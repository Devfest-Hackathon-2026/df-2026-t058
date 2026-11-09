// 空の相談に置く例の質問。今日のチェックポイントの題・完了の目印から作る（AI は呼ばない）。
// 相談の部品（components/TutorChat.tsx）の、画面に依らない決まりもここに置く。

import type { HelpTotal, ReflectImage, TutorMessage, TutorRequest, TutorResult } from '../api/types';
import { COPY_HELP_MEDIUM, COPY_HELP_SMALL } from './copy';
import { tutorBody } from './tutorPhotos';

// 例の札は 1 種類（頭の語は付けない）
export interface TutorExample {
  text: string;
}

const clip = (s: string, n = 40) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// 題も目印も空なら例は出さない（無関係な固定の例文は出さない）
export function tutorExamples(cp: { title?: string; doneMark?: string } | null | undefined): TutorExample[] {
  const title = clip(cp?.title ?? '');
  const mark = clip(cp?.doneMark ?? '');
  const out: TutorExample[] = [];
  if (title) out.push({ text: `${title}のどこで止まっているか確かめたい` });
  if (mark) out.push({ text: `「${mark}」になるために、調べておきたいことがある` });
  return out;
}

// 例の札を押した時: 文を入力欄へ（写真はそのまま）
export function pickExample(ex: TutorExample): { text: string } {
  return { text: ex.text };
}

// 集中の画面に並べる札は 3 個まで
export const COMPACT_EXAMPLES = 3;

// 集中の画面で会話が主役になる時（時計を上の帯に小さくする）: 会話がある・返事待ち・入力中
export function chatIsActive(messageCount: number, pending: boolean, focused: boolean): boolean {
  return messageCount > 0 || pending || focused;
}

// 1 回の質問を送り、返事を今の会話の後ろに足す（失敗は投げる＝画面が入力を戻す）
export async function askTutor(
  call: (sessionId: string, body: TutorRequest) => Promise<TutorResult>,
  sessionId: string,
  before: TutorMessage[],
  text: string,
  images: ReflectImage[],
): Promise<{ messages: TutorMessage[]; help: HelpTotal }> {
  const r = await call(sessionId, tutorBody(text, images));
  return { messages: [...before, ...(r.messages ?? [])], help: r.helpTotal ?? { small: 0, medium: 0 } };
}

// 棒の左に置く言葉。色だけでヒント・やり方を分けない
export const BAR_MARK = { small: COPY_HELP_SMALL, medium: COPY_HELP_MEDIUM } as const;
