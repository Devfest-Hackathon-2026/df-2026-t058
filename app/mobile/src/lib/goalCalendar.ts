// 目標の期限とステップの日を、Google カレンダーに終日の予定として入れる（#291・Web だけ・押した時だけ）。
// 時刻は付けない（時間は AI が決める方針・#265）。二重に入れないよう、入れた予定の ID を端末に覚える。
// 覚えるのは予定の ID・日付・題の照合用の短い値だけ。トークンと題の文は保存しない。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWriteToken, writeEvent, type AllDayBody, type MarkStore } from './googleCalendar';

// 画面が使う保存先（端末）。試験では別の物を渡す
export const goalCalStore: MarkStore = AsyncStorage;

export const GOAL_CAL_DESCRIPTION = 'モル塔から入れた予定です';
export const goalCalKey = (goalId: string): string => `goalCalendar.v1:${goalId}`;

export type GoalCalStep = { id: string; title: string; due?: string | null };
export type PlannedEvent = { key: string; body: AllDayBody };
export type SavedEvent = { id: string; date: string; sig: string };
export type SavedEvents = Record<string, SavedEvent>;

const DAY = 24 * 60 * 60 * 1000;
const JST = 9 * 60 * 60 * 1000;

// 日時の文 → 東京の日付（YYYY-MM-DD）。読めなければ null
export function tokyoDate(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + JST).toISOString().slice(0, 10);
}

const nextDate = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

const allDay = (summary: string, date: string): AllDayBody => ({
  summary,
  description: GOAL_CAL_DESCRIPTION,
  start: { date },
  end: { date: nextDate(date) }, // 終日の予定の終わりは次の日（含まない）
});

// 目標・ステップ → 入れる予定の一覧。期限が無い・読めない物は除く
export function goalEvents(goal: { text: string; deadline: string | null | undefined }, steps: GoalCalStep[]): PlannedEvent[] {
  const name = goal.text.replace(/\s+/g, ' ').trim();
  const out: PlannedEvent[] = [];
  const d = tokyoDate(goal.deadline);
  if (d) out.push({ key: 'goal', body: allDay(name, d) });
  for (const s of steps ?? []) {
    const sd = tokyoDate(s.due);
    if (sd) out.push({ key: `step:${s.id}`, body: allDay(`${name}：${s.title.replace(/\s+/g, ' ').trim()}`, sd) });
  }
  return out;
}

// 題の照合用の短い値（題の文そのものは保存しない）
export function sig(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export type EventDiff = {
  add: PlannedEvent[];
  update: { eventId: string; ev: PlannedEvent }[];
  keep: string[];
  remove: { key: string; eventId: string }[];
};

// 覚えている予定と比べる: 無い物は足す・日付か題が変わった物は直す・無くなった物は消す
export function diffEvents(planned: PlannedEvent[], saved: SavedEvents): EventDiff {
  const diff: EventDiff = { add: [], update: [], keep: [], remove: [] };
  const keys = new Set(planned.map((p) => p.key));
  for (const ev of planned) {
    const s = saved[ev.key];
    if (!s) diff.add.push(ev);
    else if (s.date !== ev.body.start.date || s.sig !== sig(ev.body.summary)) diff.update.push({ eventId: s.id, ev });
    else diff.keep.push(ev.key);
  }
  for (const [key, s] of Object.entries(saved)) if (!keys.has(key)) diff.remove.push({ key, eventId: s.id });
  return diff;
}

export async function savedEvents(store: MarkStore, goalId: string): Promise<SavedEvents> {
  try {
    const v = JSON.parse((await store.getItem(goalCalKey(goalId))) ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: SavedEvents = {};
    for (const [k, s] of Object.entries(v as Record<string, any>)) {
      if (typeof s?.id === 'string' && typeof s?.date === 'string' && typeof s?.sig === 'string') out[k] = { id: s.id, date: s.date, sig: s.sig };
    }
    return out;
  } catch {
    return {};
  }
}

async function save(store: MarkStore, goalId: string, v: SavedEvents): Promise<void> {
  try {
    await store.setItem(goalCalKey(goalId), JSON.stringify(v));
  } catch {
    // 保存できなくても、入れた予定はそのまま
  }
}

type Deps = {
  clientId: string;
  store: MarkStore;
  getToken?: (clientId: string) => Promise<string>;
  write?: typeof writeEvent;
};

const record = (ev: PlannedEvent, id: string): SavedEvent => ({ id, date: ev.body.start.date, sig: sig(ev.body.summary) });

// まとめて入れる（2 回目からは差分だけ）。途中で失敗しても、できた分は覚えてから投げ直す。トークンはこの中の変数だけ
export async function syncGoalToCalendar(
  goal: { id: string; text: string; deadline: string | null | undefined },
  steps: GoalCalStep[],
  deps: Deps,
): Promise<{ count: number }> {
  const planned = goalEvents(goal, steps);
  const saved = await savedEvents(deps.store, goal.id);
  const diff = diffEvents(planned, saved);
  if (diff.add.length + diff.update.length + diff.remove.length === 0) return { count: planned.length };
  const token = await (deps.getToken ?? requestWriteToken)(deps.clientId);
  const write = deps.write ?? writeEvent;
  const next: SavedEvents = { ...saved };
  try {
    for (const { key, eventId } of diff.remove) {
      await write(token, 'DELETE', eventId, null);
      delete next[key];
    }
    for (const { eventId, ev } of diff.update) {
      const r = await write(token, 'PATCH', eventId, ev.body);
      // カレンダー側で消されていたら、入れ直す
      const id = r.gone ? (await write(token, 'POST', null, ev.body)).id : eventId;
      if (id) next[ev.key] = record(ev, id);
      else delete next[ev.key];
    }
    for (const ev of diff.add) {
      const { id } = await write(token, 'POST', null, ev.body);
      if (id) next[ev.key] = record(ev, id);
    }
  } finally {
    await save(deps.store, goal.id, next);
  }
  return { count: planned.length };
}

// 入れた予定をまとめて消す（カレンダー側で消えていた物もそのまま外す）
export async function removeGoalFromCalendar(goalId: string, deps: Deps): Promise<{ count: number }> {
  const saved = await savedEvents(deps.store, goalId);
  const entries = Object.entries(saved);
  if (entries.length === 0) return { count: 0 };
  const token = await (deps.getToken ?? requestWriteToken)(deps.clientId);
  const write = deps.write ?? writeEvent;
  const next: SavedEvents = { ...saved };
  try {
    for (const [key, s] of entries) {
      await write(token, 'DELETE', s.id, null);
      delete next[key];
    }
  } finally {
    await save(deps.store, goalId, next);
  }
  return { count: entries.length };
}
