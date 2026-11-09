# Cloud Run 用。画面（Expo の Web 書き出し）と API（app/api）を 1 つの入れ物で配る。
# 1 段目: app/mobile を npm ci して Web に書き出す（画面は同じ場所の /api を呼ぶ＝same-origin）。
FROM node:24-slim AS web
WORKDIR /mobile
COPY app/mobile/package.json app/mobile/package-lock.json ./
RUN npm ci
COPY app/mobile ./
RUN EXPO_PUBLIC_API_MODE=real EXPO_PUBLIC_API_URL=same-origin npx expo export --platform web --output-dir /web

# 2 段目: サーバー（依存パッケージは無いので npm ci は不要）。1 段目の書き出しを /app/public に置いて配る。
FROM node:24-slim
WORKDIR /app
COPY app/api/package.json ./
COPY app/api/src ./src
COPY --from=web /web ./public
ENV NODE_ENV=production
ENV STATIC_DIR=/app/public
# Cloud Run が PORT を渡す（既定 8080）
USER node
CMD ["node", "src/index.js"]
