// Expo Router の Web 用 HTML の雛形。タブの既定の文字・テーマ色・アイコンを足す（説明文は入れない）。

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
import { DEFAULT_APP_NAME } from '../lib/appName';
import { color } from '../theme';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>{DEFAULT_APP_NAME}</title>
        <meta name="theme-color" content={color.primary} />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
