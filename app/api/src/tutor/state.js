// 相談の「手を貸した度合い」の集計（純粋関数）。契約の変更点 §1（11/5）。
// 鍵（自分の案を出すまで次が開かない）はやめた。サーバーが持つのは度合いの記録だけ。
// 正は events（追記のみ・P5）。AI の返事ごとに help_small か help_medium を 1 件追記する（none＝問い返しだけは追記しない・#196）。

export const HELP_EVENT = { small: 'help_small', medium: 'help_medium' };

// events から { small, medium } を数える。他の種類は無視する。
export function helpTotalOf(events) {
  const total = { small: 0, medium: 0 };
  for (const e of events) {
    if (e.type === HELP_EVENT.small) total.small += 1;
    else if (e.type === HELP_EVENT.medium) total.medium += 1;
  }
  return total;
}

// 保存済みの相談メッセージから { asks, thoughtAsks } を数える（#253）。asks＝利用者の相談の回数、
// thoughtAsks＝そのうち本人の考え（thought）が付いた回数（＝「考えてから聞いた率」の材料）。本文は読まない。
export function askCountsOf(messages) {
  let asks = 0;
  let thoughtAsks = 0;
  for (const m of messages) {
    if (m?.role !== 'user') continue;
    asks += 1;
    if (m.hasThought === true) thoughtAsks += 1;
  }
  return { asks, thoughtAsks };
}
