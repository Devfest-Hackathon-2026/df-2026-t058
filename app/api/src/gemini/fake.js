import { fakeRoadmap } from '../roadmap/candidates.js';
import { fakeRoadmapChat } from '../roadmap/chat.js';
import { fakeRoadmapRevise } from '../roadmap/revise.js';

// GEMINI_MODE=fake で `node src/index.js` を起動した時の見本の応答（purpose ごと）。
// 画面の流れを最後まで通すためだけの物。本物の答えらしい中身は書かず、見本だと分かる文にする。
// 試験（test/）はこれを使わない（createApp に fakeResponses を渡した時だけ効く）。
//  - roadmap: 3 案（roadmap/candidates.js の fakeRoadmap）
//  - hint（ふつうの相談）: やり方を尋ねる文なら medium、それ以外は small
//  - research: 見本の文だけ（出典は付けない＝実在しない URL を作らない）
//  - achievement: 写真が無ければ「判定できない」（本人が選ぶ流れ）、あれば 2
//  - stuck: 次の一歩の候補 2 つ
//  - extract: 課題の候補 3 件（見本の名前）
const MEDIUM_WORDS = /やり方|どうやって|どうすれば|手順|解き方/;

// 相談の入力（tutor/prompts.js の buildInput）の最後の <user_text> が今回の入力。
function lastUserText(input) {
  const all = String(input?.user ?? '').match(/<user_text>([\s\S]*?)<\/user_text>/g) || [];
  return all.length ? all[all.length - 1] : '';
}

export const demoFakeResponses = Object.freeze({
  // roadmap は 3 か所で使う: 案づくりと、道の会話（roadmap/chat.js・input.kind が roadmap-chat・#262）と、
  // 道の見直し（roadmap/revise.js・input.kind が roadmap-revise・#358）
  roadmap: async (input) =>
    input?.kind === 'roadmap-chat'
      ? fakeRoadmapChat(input)
      : input?.kind === 'roadmap-revise'
        ? fakeRoadmapRevise(input)
        : fakeRoadmap(),
  hint: async (input) =>
    MEDIUM_WORDS.test(lastUserText(input))
      ? { reply: '（見本の返事・やり方の説明）まず、使えそうな考え方を 1 つ選んで、例題に当ててみてください。', helpLevel: 'medium', answerRevealed: false }
      : { reply: '（見本の返事・問い返し）いま、どこまで分かっていて、どこで止まっていますか。', helpLevel: 'small', answerRevealed: false },
  research: async () => ({ reply: '（見本の調べた結果）本物の Gemini につなぐと、ここに調べた事実と出典が出ます。', helpLevel: 'small', answerRevealed: false }),
  achievement: async (input) =>
    Array.isArray(input?.images) && input.images.length > 0
      ? { judgeable: true, achievement: 2, reason: '（見本の判定）写真から、目印の一部まで進んだと読みました。' }
      : { judgeable: false, reason: '（見本の判定）写真や資料が無いので、材料から判定できません。' },
  material: async () => ({ text: '（見本の書き起こし）第1章 〜 第3章 / 演習問題 1〜10' }),
  voice: async () => ({ text: '（見本の書き起こし）この問題の考え方が分かりません' }),
  // 課題の取り込み（#139）: 見本の候補 3 件。期限は今日（日本時間）から 3 日後・7 日後・なし。
  // extract は 2 か所で使う: 課題の取り込みと、ロードマップの見積り（roadmap/estimate.js・input.kind が estimate・#268）。
  extract: async (input) => {
    if (input?.kind === 'estimate') {
      const n = (String(input.user).match(/^\d+\.$/gm) || []).length;
      return { minutes: Array.from({ length: n }, () => 30) };
    }
    // 予定の判定（import/classify.js・input.kind が classify・#264）: 見本は「すべて課題・迷う時の扱い」。
    if (input?.kind === 'classify') {
      const ids = [...String(input.user).matchAll(/^id: (\S+) /gm)].map((m) => m[1]);
      return { results: ids.map((id) => ({ id, isTask: true, title: '（見本）予定の題', deadline: '', minutes: 0, reason: '（見本）迷うので課題に' })) };
    }
    const day = (n) => new Date(Date.now() + 9 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
    return {
      candidates: [
        { text: '（見本）レポート第3回', deadline: day(3), note: '（見本）授業のページから提出' },
        { text: '（見本）小テスト 第5章', deadline: day(7), note: '' },
        { text: '（見本）発表の資料づくり', deadline: '', note: '' },
      ],
    };
  },
  // stuck は 2 か所で使う: 相談の候補（tutor/options.js・input.kind が stuck-options）と、振り返りの次の一歩。
  stuck: async (input) =>
    input?.kind === 'stuck-options'
      ? { options: [{ label: '（見本）問題の意味が取れない' }, { label: '（見本）途中で考えが合わない' }, { label: '（見本）用語が思い出せない' }] }
      : { nextSteps: ['（見本）いちばん小さい例を 1 つだけやる', '（見本）止まった所を一行で書き出す'] },
  // モルティと話す（agent/routes.js・#307）: 形だけ合う見本。fake の時は経路がルールの返事に source: ai を付けて返す
  // （「答え」「解き方」「教えて」を含む時は topic: content の形・agent/state.js の fakeReply）。
  agent: async () => ({ reply: '（見本の返事）進め方を一緒に考えましょう。', actions: [], topic: 'plan' }),
});
