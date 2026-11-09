// 調べた返事の出典。sources が来ればそれを、無ければ本文の URL を拾う。
// 出典は押せない文字にして、出典名（無ければドメイン名）だけ出す。押して外のブラウザが開くと、
// アプリが裏に回って時計が止まるため（P6「調べるのもアプリ内」）。中を読む表示は依存の追加が要るので未対応。

import type { TutorMessage } from '../api/types';

const URL_RE = /https?:\/\/[^\s)」』]+/g;

// https://www.example.com/a → example.com（URL の部品は RN では一部未実装なので正規表現で取る）
export function domainOf(url: string): string | null {
  const m = /^https?:\/\/([^/?#:\s]+)/i.exec(url);
  if (!m) return null;
  return m[1]!.toLowerCase().replace(/^www\./, '');
}

export function splitSources(m: TutorMessage): { body: string; sources: string[] } {
  const fromField = (m.sources ?? [])
    .map((s) => s.title?.trim() || domainOf(s.url))
    .filter((v): v is string => !!v);
  const inText = (m.text.match(URL_RE) ?? []).map(domainOf).filter((v): v is string => !!v);
  const body = m.text.replace(URL_RE, '').replace(/\n{2,}/g, '\n').trim();
  return { body, sources: [...new Set([...fromField, ...inText])] };
}
