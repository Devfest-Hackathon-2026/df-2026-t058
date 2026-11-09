// ホームの小さな判断・計算。画面から切り出して試験する。

import type { Achievement, Checkpoint, HomeData } from '../api/types';
import { COPY_CONTINUE, COPY_START } from './copy';
import { levelWord } from './reflectView';

type GoalEntry = HomeData['goals'][number];

// 「今日やること」のカードは期限の近い順（同じ期限は元の並びのまま）
export function sortByDeadline(goals: GoalEntry[]): GoalEntry[] {
  return goals
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.goal.deadline.localeCompare(b.g.goal.deadline) || a.i - b.i)
    .map((x) => x.g);
}

// 期限までの日数（日付だけで数える。期限の日＝0）
export function daysLeft(deadline: string, now: Date): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
  if (!d) return 0;
  const end = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end - today) / 86400000);
}

export function daysLeftText(n: number): string {
  if (n > 0) return `あと ${n} 日`;
  return n === 0 ? '今日まで' : '期限を過ぎた';
}

// 下に固定する主ボタンは常に 1 つ: 集中中 → 続ける／振り返り待ち → 振り返る／今日の提案の 1 件目 → 始める／
// 開いた目標 → 始める（道が無ければ案から選ぶ）
export type PrimaryAction =
  | { kind: 'resume'; sessionId: string }
  | { kind: 'reflect'; sessionId: string }
  | { kind: 'start'; goalId: string; checkpoint: Checkpoint; fromProposal?: boolean }
  | { kind: 'plan'; goalId: string }
  | { kind: 'none' };

export function primaryAction(
  data: Pick<HomeData, 'active' | 'toReflect'>,
  open: GoalEntry | null,
  today: Checkpoint | null,
  // 今日の提案の 1 件目（proposalStart の結果）。あれば開いたカードより先
  first: { goalId: string; checkpoint: Checkpoint } | null = null,
): PrimaryAction {
  if (data.active) return { kind: 'resume', sessionId: data.active.id };
  const pending = data.toReflect?.[0];
  if (pending) return { kind: 'reflect', sessionId: pending.id };
  if (first) return { kind: 'start', goalId: first.goalId, checkpoint: first.checkpoint, fromProposal: true };
  if (!open) return { kind: 'none' };
  if (!open.roadmap) return { kind: 'plan', goalId: open.goal.id };
  return today ? { kind: 'start', goalId: open.goal.id, checkpoint: today } : { kind: 'none' };
}

export function primaryLabel(a: PrimaryAction): string | null {
  switch (a.kind) {
    case 'resume':
      return COPY_CONTINUE;
    case 'reflect':
      return '振り返る';
    case 'start':
      return `${COPY_START}　${a.checkpoint.estimateMin} 分`;
    case 'plan':
      return '案から選ぶ';
    default:
      return null;
  }
}

// 下の固定ボタンの上に出す、どの目標の分かの 1 行。ボタンが目標に結び付く時（はじめる・案から選ぶ）で、
// 目標が 2 件以上か、今日の提案から始める時だけ
export function footerGoalName(a: PrimaryAction, goals: GoalEntry[]): string | null {
  if (a.kind !== 'start' && a.kind !== 'plan') return null;
  const fromProposal = a.kind === 'start' && !!a.fromProposal;
  if (goals.length < 2 && !fromProposal) return null;
  return goals.find((g) => g.goal.id === a.goalId)?.goal.text ?? null;
}

// 今日の提案の 1 件目を、ホームの目標の中のチェックポイントにつなぐ。見つからない（古い提案・終わった一歩）なら null
export function proposalStart(
  proposals: readonly { goalId: string; checkpointId: string }[],
  goals: GoalEntry[],
): { goalId: string; checkpoint: Checkpoint } | null {
  const p = proposals[0];
  if (!p) return null;
  const cp = goals.find((g) => g.goal.id === p.goalId)?.roadmap?.checkpoints.find((c) => c.id === p.checkpointId);
  return cp && cp.state !== 'done' ? { goalId: p.goalId, checkpoint: cp } : null;
}

// 提案を取り直す目印: 各目標の次の一歩が変わった時だけ変わる（集中を終えて戻った時など）
export function proposalKey(goals: GoalEntry[]): string {
  return goals.map((g) => `${g.goal.id}:${g.goal.status}:${stepOf(g)?.id ?? '-'}`).join(',');
}

// 今日の提案の「今日やりたいこと」（note・#222）。上限は契約の 200 字
export const TODAY_NOTE_MAX = 200;

// 送る前の希望: 前後の空白（全角も）を切り、空なら undefined（送らない）。200 字を超える分は切る
export function todayNote(raw: string): string | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  return Array.from(t).slice(0, TODAY_NOTE_MAX).join('').trim();
}

// 連打しても最後の 1 回だけ: 少し待ってから送り、送った後に新しい依頼が来たら古い応答は捨てる
export function lastOnly<A, T>(
  run: (arg: A) => Promise<T>,
  apply: (r: { ok: true; value: T } | { ok: false }) => void,
  delayMs = 250,
): { request: (arg: A) => void; cancel: () => void } {
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    request(arg) {
      const n = ++seq;
      clear();
      const go = () => {
        timer = null;
        run(arg).then(
          (value) => n === seq && apply({ ok: true, value }),
          () => n === seq && apply({ ok: false }),
        );
      };
      if (delayMs > 0) timer = setTimeout(go, delayMs);
      else go();
    },
    cancel() {
      seq++;
      clear();
    },
  };
}

// 読み込み直した時に、1 件だけ増えた目標の ID（新しく作った目標）。初回・2 件以上増えた時（見本を入れた時）は null
export function newGoalId(prevIds: string[] | null, ids: string[]): string | null {
  if (!prevIds) return null;
  const added = ids.filter((id) => !prevIds.includes(id));
  return added.length === 1 ? (added[0] ?? null) : null;
}

// 目標が 0 件の時に出す、アプリの役目の 1 文と 3 つの手順（文は仮。人が決める＝owner-choices §8）
export const EMPTY_LEAD = '目標を、毎日の短い集中に分けて進めます。';
// 初回は課題の取り込みから（#187）
export const EMPTY_STEPS: readonly string[] = ['課題を取り込む', '案から道を選ぶ', '集中して、振り返る'];

// 今日の一歩＝道の中で、まだ終わっていない最初の分（CheckpointPath の todayCheckpoint と同じ決め方）
function stepOf(g: GoalEntry): Checkpoint | null {
  const cps = g.roadmap?.checkpoints ?? [];
  return [...cps].sort((a, b) => a.order - b.order).find((c) => c.state !== 'done') ?? null;
}

// 終わった目標＝道があり、丸がすべて完了
export function isFinished(g: GoalEntry): boolean {
  const cps = g.roadmap?.checkpoints ?? [];
  return cps.length > 0 && cps.every((c) => c.state === 'done');
}

// 今日の合計: 今日の一歩を持つ目標の件数と、その分の合計。0 件なら null（出さない）
export function todayTotal(goals: GoalEntry[]): { count: number; minutes: number } | null {
  const steps = goals.map(stepOf).filter((c): c is Checkpoint => !!c);
  if (steps.length === 0) return null;
  return { count: steps.length, minutes: steps.reduce((s, c) => s + c.estimateMin, 0) };
}

export function todayTotalText(t: { count: number; minutes: number }): string {
  return `今日 ${t.count} 件・合計 ${t.minutes} 分`;
}

// 急ぎ＝期限まで 3 日以内（期限の日・過ぎた物も含む）
export const URGENT_DAYS = 3;
export function isUrgent(days: number): boolean {
  return days <= URGENT_DAYS;
}

// 一覧の分け方: 終わった目標は下にたたむ。進める目標が 6 件を超えたら、先頭 5 件と「ほか N 件」。
// 開いている目標が隠れる位置にある時は、広げた状態にする（開いたカードが見えなくならないように）
export const LIST_MAX = 6;
export const LIST_HEAD = 5;
export function splitGoals(
  sorted: GoalEntry[],
  opts: { expanded: boolean; openId?: string | null },
): { shown: GoalEntry[]; hiddenCount: number; finished: GoalEntry[] } {
  const active = sorted.filter((g) => !isFinished(g));
  const finished = sorted.filter(isFinished);
  const openIndex = active.findIndex((g) => g.goal.id === opts.openId);
  if (active.length <= LIST_MAX || opts.expanded || openIndex >= LIST_HEAD) {
    return { shown: active, hiddenCount: 0, finished };
  }
  return { shown: active.slice(0, LIST_HEAD), hiddenCount: active.length - LIST_HEAD, finished };
}

// 「どこまでできたか」: 言葉と棒（例: だいたい ●●○）。まだ判定が無ければ「-」
export function achievementText(a: Achievement | null | undefined): string {
  if (a === null || a === undefined) return '-';
  return `${levelWord(a)} ${'●'.repeat(a)}${'○'.repeat(3 - a)}`;
}

// 札を下の固定欄に出すか。今日でない丸を選んだ時だけ（上の札は道の上にあり、画面の外になるため）
export function cardInFooter(selected: Checkpoint | null, today: Checkpoint | null): boolean {
  return !!selected && selected.id !== today?.id;
}

// 友達の名前。無ければ、ID の頭 2 文字（暫定。表記は人が決める）
export function friendName(item: { displayName: string; userId: string }): string {
  const name = item.displayName.trim();
  return name || item.userId.slice(0, 2);
}

// 横に並べた札を、選んだ札が見える位置まで送る量（なるべく真ん中に寄せる。端は越えない）
export function chipScrollX(input: {
  index: number;
  count: number;
  itemWidth: number;
  gap: number;
  viewportWidth: number;
}): number {
  const { index, count, itemWidth, gap, viewportWidth } = input;
  const content = count * itemWidth + Math.max(0, count - 1) * gap;
  const max = Math.max(0, content - viewportWidth);
  const x = index * (itemWidth + gap) - (viewportWidth - itemWidth) / 2;
  return Math.min(max, Math.max(0, x));
}
