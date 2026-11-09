// 作業時間の計算（純粋関数・P3）。端末の申告でなく、サーバーが付けた Event の時刻から出す。
// 作業時間 = 開始〜終了 から、離れていた間（leave〜return。終了時に離れたままなら leave〜終了）を除いたもの。

const ms = (iso) => Date.parse(iso);
const bySortedAt = (events) => [...events].sort((a, b) => ms(a.at) - ms(b.at)); // 安定ソート（同時刻は追記順）

// 現在離れているか（leave の後に return が無い）。順序の検査に使う。
export function isAway(events) {
  let away = false;
  for (const e of bySortedAt(events)) {
    if (e.type === 'leave') away = true;
    else if (e.type === 'return') away = false;
  }
  return away;
}

export function countLeaves(events) {
  return events.filter((e) => e.type === 'leave').length;
}

// events: 1 回の集中の Event。fallback: { startedAt, endedAt }（focus_start / focus_end が無い時の代わり）。
// 返り値: 分（小数 1 桁）。終了が決まっていなければ 0。
export function focusMinutes(events, fallback = {}) {
  const sorted = bySortedAt(events);
  const startEv = sorted.find((e) => e.type === 'focus_start');
  const endEv = [...sorted].reverse().find((e) => e.type === 'focus_end');
  const startIso = startEv?.at ?? fallback.startedAt;
  const endIso = endEv?.at ?? fallback.endedAt;
  if (!startIso || !endIso) return 0;
  const start = ms(startIso);
  const end = ms(endIso);
  if (!(end > start)) return 0;

  let away = 0;
  let leftAt = null;
  const clip = (t) => Math.min(end, Math.max(start, t));
  for (const e of sorted) {
    if (e.type === 'leave' && leftAt === null) leftAt = ms(e.at);
    else if (e.type === 'return' && leftAt !== null) {
      away += clip(ms(e.at)) - clip(leftAt);
      leftAt = null;
    }
  }
  if (leftAt !== null) away += end - clip(leftAt); // 終了時に離れたまま

  const minutes = (end - start - away) / 60000;
  return Math.round(Math.max(0, minutes) * 10) / 10;
}
