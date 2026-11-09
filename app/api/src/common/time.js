// 時刻はサーバーが付ける（契約 §1）。試験で差し替えられるよう ctx.now を使う。
export const nowIso = (ctx) => (ctx.now ? ctx.now() : new Date()).toISOString();
