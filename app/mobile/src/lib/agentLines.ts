// 各画面のエビ（エージェント）の発言は、ここ 1 か所にだけ書く（#257）。本人が一覧で読んで直せるように。
// text＝ふだんの発言（2 文まで）、short＝小さな画面・キーボードが出ている時の 1 文。
// 口調の規則（docs/character-brief-2026-11-07.md §3 を会話向けに緩めた物）:
//  ①砕けた敬語（〜ですね・〜しましょう・〜してください。11/9 に「だね・してみて」から統一）②一人称は使わない
//  ③絵文字・「！」の連発・伸ばす語尾は使わない ④1 つの発言は 2 文まで
//  ⑤答えを言わない・褒めすぎない・急かさない ⑥説明を長くしない。AI 臭い言い回しは使わない。

export type AgentLine = { text: string; short: string };

// 本人が入れた文を引用する時の長さ（字）
export const QUOTE_MAX = 20;

// 本人の文を、先頭 20 字の 1 行にする。文の区切り（。？！）と改行は空白にして、発言の文の数を変えない
export function quote(input: string | null | undefined): string {
  const flat = (input ?? '').replace(/[。．？?！!\r\n\t]/g, ' ').replace(/[ 　]+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join('').trim()}…` : flat;
}

// 文に分ける（。？? で区切る。区切りの無い最後の文も 1 文）
export function sentences(s: string): string[] {
  return (s.match(/[^。？?]+[。？?]*/g) ?? []).map((x) => x.trim()).filter(Boolean);
}

// 先頭の n 文だけ残す
export function firstSentences(s: string, n: number): string {
  return sentences(s).slice(0, Math.max(1, n)).join('');
}

// ---- 決まった発言 ----
export const AGENT_LINES = {
  login: {
    text: 'まずは名前と招待コードを入れてください。入ったら、何を進めたいか聞かせてください。',
    short: '名前と招待コードを入れてください。',
  },
  homeEmpty: {
    text: 'まだ目標がないですね。課題を取り込むか、自分で書くところから始めましょう。',
    short: '課題を取り込むか、書いてみましょう。',
  },
  importReading: {
    text: '課題を探しています。少し待ってください。',
    short: '課題を探しています。',
  },
} as const satisfies Record<string, AgentLine>;

// ---- 目標を書く（goal/new）の 5 ステップ。前のステップで本人が入れた物を受けて、次を言う ----

// ① 目標を聞く
export function goalIntro(name?: string | null): AgentLine {
  const who = quote(name);
  return {
    text: `${who ? `${who}さん、` : ''}何を進めたいですか。試験や課題を、一文で書いてください。`,
    short: '何を進めたいか、一文で書いてください。',
  };
}

// ② 目標を受けて、次（くわしく決める・次へ）を言う
export function afterGoalText(text: string | null | undefined): AgentLine {
  const q = quote(text);
  if (!q) return goalIntro();
  return {
    text: `「${q}」ですね。期限と時間は、おまかせのままでも進められます。`,
    short: `「${q}」ですね。`,
  };
}

// ③ 期限を聞く
export function deadlineAsk(goalText?: string | null): AgentLine {
  const q = quote(goalText);
  return {
    text: `${q ? `「${q}」は、` : ''}いつまでに終わらせたいですか。近い日ほど、1 日の量が増えます。`,
    short: 'いつまでに終わらせたいですか。',
  };
}

// ④ 1 日の時間を聞く（deadlineLabel＝選んだ期限の表示。まだ無ければ null）
export function minutesAsk(deadlineLabel?: string | null): AgentLine {
  const d = quote(deadlineLabel);
  return {
    text: `${d ? `期限は ${d} ですね。` : ''}1 日に使える時間は、おまかせでも決められます。`,
    short: '1 日に使える時間はどれくらいですか。',
  };
}

// ⑤ 教材を聞く（minutes＝1 日の分。おまかせなら null）
export function materialsAsk(minutes?: number | null): AgentLine {
  const head = minutes != null && Number.isFinite(minutes) && minutes > 0 ? `1 日 ${Math.round(minutes)} 分ですね。` : '時間はおまかせですね。';
  return {
    text: `${head}手元の教材やプリントがあれば、足してください。`,
    short: '手元の教材があれば、足してください。',
  };
}

// ---- 足す場面（goal/new・#315 準備のフロー）。話すとカードに入れ、次に要る物を 1 つだけ言う ----

export function addIntro(): AgentLine {
  return {
    text: '何を、いつまでに進めますか。課題の一覧や資料は、クリップから見せてください。',
    short: '何を、いつまでに進めますか。',
  };
}

// 話した目標を受けて（deadlineLabel＝読み取れた期限。無ければ null）
export function addHeard(goalText: string, deadlineLabel: string | null): AgentLine {
  const q = quote(goalText);
  if (!deadlineLabel) return { text: `「${q}」ですね。いつまでにしますか。`, short: 'いつまでにしますか。' };
  return {
    text: `「${q}」、${deadlineLabel} までですね。範囲が分かる物があれば見せてください。`,
    short: `${deadlineLabel} までですね。`,
  };
}

export function addDeadlineSet(deadlineLabel: string): AgentLine {
  return { text: `期限は ${deadlineLabel} にしました。これで決めますか。`, short: `期限は ${deadlineLabel} です。` };
}

export function addMaterialsIn(): AgentLine {
  return { text: '資料を読みました。この目標の間、ずっと残しておきます。', short: '資料を残しました。' };
}

export function addDecided(): AgentLine {
  return { text: '決めました。進め方を一緒に考えましょう。', short: '進め方を考えましょう。' };
}

// ---- 課題の取り込み（goal/import） ----

// 入口の案内。Google の読み込み・.ics（Web だけ）があるかで、言う手段を変える
export function importIntro(opts: { google: boolean; ics: boolean }): AgentLine {
  const ways = opts.google ? '写真や Google の読み込み' : opts.ics ? '写真やカレンダーのファイル' : '写真';
  return {
    text: `課題の一覧やお知らせの文を、そのまま貼ってください。${ways}からでも拾えます。`,
    short: '課題の文を貼るか、写真で取り込んでください。',
  };
}

// 取れた候補の一言
export function importFound(count: number): AgentLine {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return { text: '選べる課題が残っていません。貼り直してください。', short: '貼り直してください。' };
  return {
    text: `課題が ${n} 件見つかりました。タスクにする物を選んで、名前と期限を直してください。`,
    short: `課題が ${n} 件見つかりました。`,
  };
}

// ---- 考えポイントが増えた時（振り返りの後）。短く・褒めすぎない・答えを言わない ----
export function pointsGained(pt: number | null | undefined): AgentLine | null {
  const n = typeof pt === 'number' && Number.isFinite(pt) ? Math.floor(pt) : 0;
  if (n <= 0) return null;
  return { text: `考えた分が ${n} shell、積み上がりました。`, short: `${n} shell、増えました。` };
}

// 試験と一覧で読むための、全部の発言（動的な物は見本の入力で作る）
export function allAgentLines(): AgentLine[] {
  const long = 'あ'.repeat(80) + '。次の文？';
  return [
    ...Object.values(AGENT_LINES),
    goalIntro(),
    goalIntro('ゆうき'),
    goalIntro(long),
    afterGoalText('英検 2 級の二次試験に受かる'),
    afterGoalText(long),
    deadlineAsk(),
    deadlineAsk('期末の数学'),
    minutesAsk(),
    minutesAsk('11 月 30 日（日）'),
    materialsAsk(null),
    materialsAsk(30),
    importIntro({ google: true, ics: true }),
    importIntro({ google: false, ics: true }),
    importIntro({ google: false, ics: false }),
    importFound(0),
    importFound(3),
    pointsGained(12)!,
    // UI 刷新（11/9）で足した発言
    planLine({ thinking: true, count: 0, mode: 'pick', chosenName: null, steps: null }),
    planLine({ thinking: false, count: 3, mode: 'pick', chosenName: null, steps: null }),
    planLine({ thinking: false, count: 3, mode: 'pick', chosenName: '問題から入る', steps: 4 }),
    planLine({ thinking: false, count: 3, mode: 'edit', chosenName: '問題から入る', steps: 4 }),
    planLine({ thinking: false, count: 0, mode: 'own', chosenName: null, steps: null }),
    planLine({ thinking: false, count: 0, mode: 'pick', chosenName: null, steps: null }),
    startTalkGo('例題を 3 問解く'),
    REFLECT_ASK,
    REFLECT_STUCK_ASK,
    reflectPick({ judged: true, judgeable: true, aiWord: 'だいたい' }),
    reflectPick({ judged: true, judgeable: false, aiWord: null }),
    reflectPick({ judged: false, judgeable: false, aiWord: null }),
    builtLine(20, 4, 'gold'),
    builtLine(0, 0),
    builtLine(10, 2, 'silver', 0),
    builtLine(0, 0, null, 0),
    reviseOffer('behind'),
    reviseOffer('ahead'),
    REVISE_FAILED,
  ];
}

// ---- ロードマップの見直し（#353・#359）。振り返りの最後に、遅れ・先行の時だけ持ちかける。責めない・決めるのは本人 ----
export function reviseOffer(pace: 'behind' | 'ahead'): AgentLine {
  if (pace === 'behind') {
    return {
      text: 'ここまでおつかれさまです。残りのロードマップを、今の時間に合う形に直してみませんか。',
      short: '残りを今の時間に合う形に直しませんか。',
    };
  }
  return {
    text: '余裕がありそうです。前倒しで進むか、仕上げを足すか、ロードマップを考えてみませんか。',
    short: '前倒しか仕上げを考えてみませんか。',
  };
}
// 見直しの案を取れなかった時（話せば直せる）
export const REVISE_FAILED: AgentLine = {
  text: '案をうまく作れませんでした。直したい形を話してください。',
  short: '直したい形を話してください。',
};

// ---- 案から選ぶ（plan）。案を 1 つずつ見て、自分で比べて決める（P1・UI 刷新 11/9）。砕けた敬語 ----
export function planLine(s: {
  thinking: boolean;
  count: number; // 案の数
  mode: 'pick' | 'edit' | 'own';
  chosenName: string | null;
  steps: number | null;
}): AgentLine {
  if (s.thinking) return { text: '案を作っています。少し待ってください。', short: '案を作っています。' };
  if (s.mode === 'own') return { text: '自分で道を作れます。やることと、できたと言える目印を書いてください。', short: 'やることと目印を書いてください。' };
  if (s.mode === 'edit') return { text: '直したい所を書き換えてください。直した分も記録に残ります。', short: '直したい所を書き換えてください。' };
  if (s.count === 0) return { text: '案がまだありません。自分で作ることもできます。', short: '自分で作ることもできます。' };
  if (!s.chosenName) {
    return {
      text: `${s.count} つの案を、同じ物差しで重ねました。名前を押して、1 つずつ比べてください。`,
      short: '名前を押して、1 つずつ比べてください。',
    };
  }
  return {
    text: `「${quote(s.chosenName)}」は ${s.steps ?? 0} ステップです。これにするなら、理由を 1 つ選んでください。`,
    short: `「${quote(s.chosenName)}」は ${s.steps ?? 0} ステップです。`,
  };
}

// ---- 始める（start・#315）: 聞かずに一言まとめて集中へ。時間には触れない（11/9 本人） ----
export function startTalkGo(line: string): AgentLine {
  return { text: `「${quote(line)}」、始めましょう。`, short: '始めましょう。' };
}

// ---- 振り返り（reflect）。判定は材料から。決めるのは本人 ----
export const REFLECT_ASK: AgentLine = {
  text: 'おつかれさまです。どこまでできたか、ノートの写真か一言で見せてください。',
  short: '写真か一言で見せてください。',
};
// 見てもらう前の 1 問（行き詰まりの原因・P8・11/9 本人 A）。答えなくても進める
export const REFLECT_STUCK_ASK: AgentLine = {
  text: '見る前に 1 つだけ。手が止まった所があれば、一言で教えてください。',
  short: '手が止まった所はありましたか？',
};
export function reflectPick(s: { judged: boolean; judgeable: boolean; aiWord: string | null }): AgentLine {
  if (s.judged && s.judgeable && s.aiWord) {
    return { text: `見た限りでは「${s.aiWord}」です。自分ではどう思いますか。`, short: '自分ではどう思いますか。' };
  }
  if (s.judged) return { text: '写真とメモからは決めきれませんでした。下から選んでください。', short: '下から選んでください。' };
  return { text: 'どこまでできたか、下から選んでください。', short: '下から選んでください。' };
}

// 階を積んだ後: 考えた分（pt）と、灯った窓の数（窓の明かり・決定 11/9）
const COLOR_WORD: Record<string, string> = { gold: '金', silver: '銀', bronze: '銅' };
export function builtLine(pt: number | null | undefined, lit: number, color?: string | null, floors?: number | null): AgentLine {
  const n = typeof pt === 'number' && Number.isFinite(pt) ? Math.max(0, Math.floor(pt)) : 0;
  // 階が積まれなかった時（集中が短すぎた）は、色と窓を言わない（建物の絵と食い違わないように）
  if (floors === 0) {
    if (n <= 0) return { text: '今回は短かったので、階はまだ積んでいません。また次の一歩で会いましょう。', short: '階はまだ積んでいません。' };
    return { text: `考えた分が ${n} shell。今回は短かったので、階はまだ積んでいません。`, short: '階はまだ積んでいません。' };
  }
  if (n <= 0 || lit <= 0) return { text: '階を積みました。また次の一歩で会いましょう。', short: '階を積みました。' };
  const word = color ? COLOR_WORD[color] : undefined;
  if (!word) return { text: `考えた分が ${n} shell、窓が ${lit} つ灯りました。`, short: `窓が ${lit} つ灯りました。` };
  return { text: `考えた分が ${n} shell、${word}の階で窓が ${lit} つ灯りました。`, short: `${word}の階で窓が ${lit} つ灯りました。` };
}

// ---- 案から選ぶ（UI 刷新 2・11/9）: 選ぶ部品を並べず、モルティと話して決める。比べる→直す→理由を言って決める ----
export function planTalk(s: {
  thinking: boolean;
  count: number;
  mode: 'pick' | 'edit' | 'own';
  chosenName: string | null;
  steps: number;
  confirming: boolean;
}): AgentLine {
  if (s.thinking) return { text: '案を作っています。少し待ってください。', short: '案を作っています。' };
  if (s.confirming) return { text: 'どうしてこれにしましたか。一言で聞かせてください。', short: 'どうしてこれにしましたか。' };
  if (s.mode === 'own') return { text: '自分で道を作れます。やることを書くか、作りたい形を言ってください。', short: '作りたい形を言ってください。' };
  if (s.count === 0) return { text: '案がまだありません。自分で作ることもできます。', short: '自分で作ることもできます。' };
  if (!s.chosenName) {
    return { text: `${s.count} つの案を、同じ物差しで重ねました。気になる案を押すか、案への希望を言ってください。`, short: '気になる案を押してください。' };
  }
  return {
    text: `「${quote(s.chosenName)}」は ${s.steps} ステップです。これで進めるか、直したい所を言ってください。`,
    short: `「${quote(s.chosenName)}」は ${s.steps} ステップです。`,
  };
}
