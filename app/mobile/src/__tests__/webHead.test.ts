import { applyWebHead, WEB_ICON_HREF } from '../lib/webHead';

function fakeDoc(lang: string | null = 'en') {
  const attrs: Record<string, string | null> = { lang };
  const head: { a: Record<string, string> }[] = [];
  const mk = () => {
    const a: Record<string, string> = {};
    return { a, setAttribute: (k: string, v: string) => { a[k] = v; } };
  };
  return {
    attrs,
    head,
    doc: {
      documentElement: {
        getAttribute: (k: string) => attrs[k] ?? null,
        setAttribute: (k: string, v: string) => { attrs[k] = v; },
      },
      head: { appendChild: (e: unknown) => head.push(e as { a: Record<string, string> }) },
      querySelector: (sel: string) =>
        head.find((e) => (sel.startsWith('link') ? e.a['rel'] === 'icon' : e.a['name'] === 'theme-color')) ?? null,
      createElement: mk,
    },
  };
}

describe('applyWebHead', () => {
  it('lang・アイコン・テーマ色を足す', () => {
    const f = fakeDoc();
    applyWebHead(f.doc, '#123456');
    expect(f.attrs['lang']).toBe('ja');
    expect(f.head[0]?.a).toEqual({ rel: 'icon', type: 'image/svg+xml', href: WEB_ICON_HREF });
    expect(f.head[1]?.a).toEqual({ name: 'theme-color', content: '#123456' });
  });
  it('2 回呼んでも二重にならない', () => {
    const f = fakeDoc();
    applyWebHead(f.doc);
    applyWebHead(f.doc);
    expect(f.head.length).toBe(2);
  });
});
