// Web の起動時に 1 回、<html lang>・アイコン・テーマ色を足す。
// output が single だと +html.tsx が使われないため。すでにある物は足さない（二重にならない）。
// ネイティブでは何もしない。

import { Platform } from 'react-native';
import { color } from '../theme';

export const WEB_LANG = 'ja';
export const WEB_ICON_HREF = '/favicon.svg';

type El = { setAttribute(k: string, v: string): void };
type Doc = {
  documentElement: El & { getAttribute(k: string): string | null };
  head: { appendChild(e: unknown): unknown };
  querySelector(sel: string): unknown;
  createElement(tag: string): El;
};

export function applyWebHead(doc: Doc, themeColor: string = color.primary): void {
  const html = doc.documentElement;
  const lang = html.getAttribute('lang');
  if (!lang || lang === 'en') html.setAttribute('lang', WEB_LANG);

  if (!doc.querySelector('link[rel~="icon"]')) {
    const link = doc.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('type', 'image/svg+xml');
    link.setAttribute('href', WEB_ICON_HREF);
    doc.head.appendChild(link);
  }
  if (!doc.querySelector('meta[name="theme-color"]')) {
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', themeColor);
    doc.head.appendChild(meta);
  }
}

export function setupWebHead(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  applyWebHead(document as unknown as Doc);
}
