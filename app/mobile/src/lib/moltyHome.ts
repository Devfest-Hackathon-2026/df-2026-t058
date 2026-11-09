// ホームでモルティが最初に言うこと（話しかける前）と、その下に並べるボタン（UI 刷新・11/9）。
// 決め方はホームの主ボタンと同じ順（進行中 → 振り返り待ち → 今日の提案 → 選んだ目標の一歩 → 道が未決定 → 目標なし）。
// 文はモルティの砕けた敬語・2 文まで・一人称に名前を使わない。答えは言わない。数字の集計と目安の時間は言わない（11/9 本人）。

import type { AgentAction, HomeData, TodayProposalItem } from '../api/types';
import type { AgentLine } from './agentLines';
import { quote } from './agentLines';
import { friendName, isFinished, sortByDeadline } from './homeView';

type GoalEntry = HomeData['goals'][number];

export type MoltyHomeView = { line: AgentLine; actions: AgentAction[]; done?: boolean };

export const HOME_EMPTY_LINE: AgentLine = {
  text: 'まだ目標がないですね。課題を取り込むか、自分で書くところから始めましょう。',
  short: '課題を取り込むか、書いてみましょう。',
};

function nextStep(g: GoalEntry) {
  return [...(g.roadmap?.checkpoints ?? [])].sort((a, b) => a.order - b.order).find((c) => c.state !== 'done') ?? null;
}

// 友達が集中している時だけ足す 2 文目（焦りと楽しさ・P7）。1 文目が長い時は足さない
function withFriend(first: string, data: Pick<HomeData, 'feed'>): string {
  const f = data.feed?.[0];
  if (!f || Array.from(first).length > 40) return first;
  return `${first}${quote(friendName(f))}さんも、いま取り組んでいます。`; // 友達の様子は「取り組み」（11/9 本人）
}

export function moltyHome(
  data: Pick<HomeData, 'goals' | 'active' | 'toReflect' | 'feed'>,
  proposals: readonly TodayProposalItem[],
  pickedGoalId: string | null = null,
): MoltyHomeView {
  if (data.active) {
    return {
      line: { text: '集中の途中です。続きに戻りましょう。', short: '続きに戻りましょう。' },
      actions: [{ kind: 'resume', sessionId: data.active.id }],
    };
  }
  const pending = data.toReflect?.[0];
  if (pending) {
    return {
      line: { text: 'さっきの集中、どこまでできたか振り返りましょう。', short: '振り返りましょう。' },
      actions: [{ kind: 'reflect', sessionId: pending.id }],
    };
  }
  const goals = sortByDeadline(data.goals);
  if (goals.length === 0) return { line: HOME_EMPTY_LINE, actions: [{ kind: 'import' }, { kind: 'write' }] };

  // 一覧で目標を選んだ時は、その目標の次の一歩を言う
  const picked = pickedGoalId ? goals.find((g) => g.goal.id === pickedGoalId) : undefined;
  if (picked) {
    const cp = nextStep(picked);
    if (!picked.roadmap) {
      return {
        line: { text: `「${quote(picked.goal.text)}」は、進め方がまだ決まっていません。案を比べて決めましょう。`, short: '案を比べて決めましょう。' },
        actions: [{ kind: 'plan', goalId: picked.goal.id }],
      };
    }
    if (cp && picked.goal.kind === 'task') {
      // タスクは「終わらせる」ことが目標（#261）。一歩の名前は題と同じなので繰り返さない
      return {
        line: { text: `「${quote(picked.goal.text)}」を進めましょう。`, short: `「${quote(picked.goal.text)}」を進めましょう。` },
        actions: [{ kind: 'start', goalId: picked.goal.id, checkpointId: cp.id }],
      };
    }
    if (cp) {
      return {
        line: { text: `「${quote(picked.goal.text)}」の次は「${quote(cp.title)}」です。`, short: `次は「${quote(cp.title)}」です。` },
        actions: [{ kind: 'start', goalId: picked.goal.id, checkpointId: cp.id }],
      };
    }
    return {
      line: { text: `「${quote(picked.goal.text)}」は、全部の一歩が終わっています。`, short: '全部終わっています。' },
      actions: [],
      done: true,
    };
  }

  // 今日の提案（Gemini が選んだ順と理由）。1 件目を主ボタン、残りは一歩の名前で並べる
  const live = proposals.filter((p) => goals.some((g) => g.goal.id === p.goalId && nextStep(g)?.id === p.checkpointId));
  const first = live[0];
  if (first) {
    const reason = first.reason.replace(/[。.]$/, '');
    return {
      line: {
        text: withFriend(`今日は「${quote(first.title)}」からどうですか。${reason}。`, data),
        short: `今日は「${quote(first.title)}」からどうですか。`,
      },
      actions: live.slice(0, 3).map((p) => ({ kind: 'start' as const, goalId: p.goalId, checkpointId: p.checkpointId })),
    };
  }

  const noRoad = goals.find((g) => !g.roadmap);
  if (noRoad) {
    return {
      line: { text: `「${quote(noRoad.goal.text)}」は、進め方がまだ決まっていません。案を比べて決めましょう。`, short: '案を比べて決めましょう。' },
      actions: [{ kind: 'plan', goalId: noRoad.goal.id }],
    };
  }
  const withStep = goals.find((g) => !isFinished(g) && nextStep(g));
  if (withStep) {
    const cp = nextStep(withStep)!;
    return {
      line: { text: withFriend(`次は「${quote(cp.title)}」です。`, data), short: `次は「${quote(cp.title)}」です。` },
      actions: [{ kind: 'start', goalId: withStep.goal.id, checkpointId: cp.id }],
    };
  }
  return {
    line: { text: '今の目標は全部終わりました。次の目標を足しますか。', short: '次の目標を足しますか。' },
    actions: [{ kind: 'import' }, { kind: 'write' }],
    done: true,
  };
}
