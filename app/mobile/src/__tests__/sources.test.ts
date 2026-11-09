import { domainOf, splitSources } from '../lib/sources';
import type { TutorMessage } from '../api/types';

const msg = (text: string, sources?: TutorMessage['sources']): TutorMessage => ({
  id: 'm',
  sessionId: 's',
  role: 'ai',
  kind: 'research',
  text,
  helpLevel: 'none',
  at: '2026-11-05T00:00:00Z',
  ...(sources ? { sources } : {}),
});

describe('出典', () => {
  test('ドメイン名だけを取る', () => {
    expect(domainOf('https://www.Example.com/a/b?c=1')).toBe('example.com');
    expect(domainOf('https://ja.wikipedia.org/wiki/x')).toBe('ja.wikipedia.org');
    expect(domainOf('ftp://x')).toBeNull();
  });

  test('本文の URL は本文から外し、出典名にする', () => {
    const r = splitSources(msg('要点です。\nhttps://ja.wikipedia.org/wiki/%E5%88%A4'));
    expect(r.body).toBe('要点です。');
    expect(r.sources).toEqual(['ja.wikipedia.org']);
  });

  test('sources の名前があればそれを使い、重ねない', () => {
    const r = splitSources(
      msg('要点', [
        { title: 'ja.wikipedia.org', url: 'https://ja.wikipedia.org/wiki/a' },
        { url: 'https://www.mext.go.jp/a' },
      ]),
    );
    expect(r.sources).toEqual(['ja.wikipedia.org', 'mext.go.jp']);
  });
});
