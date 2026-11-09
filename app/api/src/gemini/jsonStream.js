// Gemini のストリーミング（#235）で届く断片を扱う小さな部品（依存なし）。

// 断片（JSON の文の一部）を足していき、トップの object の中の配列 key（既定 candidates）の要素が
// 閉じた所（{ と } の対応がそろった所）で 1 つずつ JSON.parse して返す。
// 文字列の中の { } と \" は数えない。最大 max 件まで（それより後は返さない）。
// push(text) -> 新しく閉じた要素の配列。読めない要素は飛ばす（最後の全体の検査で落ちる）。
export function createArrayItemScanner({ key = 'candidates', max = Infinity } = {}) {
  let buf = '';
  let pos = 0;
  const stack = []; // 開いている { と [
  let inStr = false;
  let esc = false;
  let strStart = -1;
  let lastKey = null; // トップの object の中で、最後に閉じた文字列
  let arrayDepth = -1; // 対象の配列が開いた時の stack の長さ
  let itemStart = -1;
  let count = 0;

  return {
    push(text) {
      buf += text;
      const out = [];
      for (; pos < buf.length; pos += 1) {
        const ch = buf[pos];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') {
            inStr = false;
            if (stack.length === 1) lastKey = buf.slice(strStart + 1, pos);
          }
          continue;
        }
        if (ch === '"') {
          inStr = true;
          strStart = pos;
        } else if (ch === '{' || ch === '[') {
          if (ch === '[' && stack.length === 1 && lastKey === key && arrayDepth < 0) arrayDepth = stack.length + 1;
          if (ch === '{' && arrayDepth > 0 && stack.length === arrayDepth) itemStart = pos;
          stack.push(ch);
        } else if (ch === '}' || ch === ']') {
          stack.pop();
          if (ch === '}' && itemStart >= 0 && stack.length === arrayDepth) {
            const raw = buf.slice(itemStart, pos + 1);
            itemStart = -1;
            if (count < max) {
              try {
                out.push(JSON.parse(raw));
                count += 1;
              } catch {
                // 読めない要素は飛ばす
              }
            }
          }
          if (ch === ']' && arrayDepth > 0 && stack.length === arrayDepth - 1) arrayDepth = 0; // 配列が閉じた（もう探さない）
        }
      }
      return out;
    },
  };
}

// SSE（text/event-stream）を分解する。push(text) -> [{ event, data }]（data は data: 行を改行でつないだ文字列）。
// 改行は \n・\r\n どちらも受ける。空行でイベントが閉じる。: で始まる行（注釈）は捨てる。
export function createSseParser() {
  let buf = '';
  let event = '';
  let data = [];
  return {
    push(text) {
      buf += text;
      const out = [];
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line === '') {
          if (data.length > 0 || event !== '') out.push({ event: event || 'message', data: data.join('\n') });
          event = '';
          data = [];
        } else if (line.startsWith(':')) {
          // 注釈
        } else {
          const i = line.indexOf(':');
          const field = i < 0 ? line : line.slice(0, i);
          const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
      return out;
    },
  };
}

// サーバーが送る 1 つのイベント（data は JSON 1 行）。
export function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
