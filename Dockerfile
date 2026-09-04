# Stage 1: Dependencies (with native module build tools)
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
# npm の prepare lifecycle は scripts/prepare.mjs を実行する (#3611 で inline sh から Node 化)。
# package*.json のみの stage では MODULE_NOT_FOUND で npm ci が exit 1 するため同 script を
# 先に COPY する (staging PDCA cycle 2 で検出、EPIC #3424。prepare.mjs は常に exit 0 設計)。
COPY scripts/prepare.mjs ./scripts/prepare.mjs
RUN npm ci

# Stage 2: Build
FROM deps AS build
ARG APP_MAJOR_VERSION=1
# BUILD_TIMESTAMP is a cache-busting build arg (#711 / PR #826 review).
# Passing a unique value (e.g. $(date +%s)) on every build causes the
# RUN layer below to be rebuilt even when COPY . . layer cache hits —
# ensuring the build actually runs and stamps a fresh APP_VERSION date.
ARG BUILD_TIMESTAMP=unknown
# NUC LAN デプロイ時は docker-compose.yml から "true" が渡され、
# svelte.config.js の csrf.checkOrigin を無効化する (#962)。
ARG DISABLE_CSRF_ORIGIN_CHECK=false
ENV APP_MAJOR_VERSION=${APP_MAJOR_VERSION}
ENV DISABLE_CSRF_ORIGIN_CHECK=${DISABLE_CSRF_ORIGIN_CHECK}
COPY . .
# APP_VERSION is computed by vite.config.ts (`define`) at build time, so every
# deployed image carries its own build date (#711). Nothing is generated into the tree.
# SvelteKit postbuild analysis imports server modules including DB client;
# create data dir so better-sqlite3 doesn't fail during build.
# The echo embeds BUILD_TIMESTAMP into the layer's command string, which
# makes the BuildKit cache key sensitive to the arg value.
RUN echo "Build at: ${BUILD_TIMESTAMP}" && mkdir -p data && npm run build

# Stage 3: Runtime (minimal image)
FROM node:22-alpine AS runtime

# #4207: alpine は tzdata を同梱しない。docker-compose.yml が `TZ=Asia/Tokyo` を渡しても
# libc がゾーンを解決できず UTC のままになり、**busybox crond が cron 式を UTC で解釈する**。
# 実害: 深夜 3 時のつもりで登録した日次バックアップ (`0 3 * * *`) が
# **12:00 JST (= 03:00 UTC) に走っていた** — 家庭向けアプリの本番 DB を、利用者が
# 起きている真昼にコピーしていた。
#
# `printenv TZ` は正しい値を返すため「設定を確認したつもり」になれるうえ、
# バックアップ自体は成功する (ファイルは毎日でき consecutiveFailures: 0) ので
# health も alert も何も言わない。目視では気づけない類の欠陥。
# 回帰は tests/unit/infra/compose-backup-volume.test.ts [TZ1] が compose から
# TZ 宣言 service を列挙して機械強制する。
RUN apk add --no-cache tzdata

WORKDIR /app

# Copy built application (flat layout: index.js, handler.js, client/, server/)
COPY --from=build /app/build/ ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Copy files needed for DB initialization (seed & schema push)
COPY --from=build /app/src/lib/server/db/seed.ts ./src/lib/server/db/seed.ts
COPY --from=build /app/src/lib/server/db/schema.ts ./src/lib/server/db/schema.ts
COPY --from=build /app/drizzle.config.ts ./

# EPIC #3620 AC-C5: PGlite cutover を image 同梱ツールで実行可能にする (staging/本番 同一手順)。
# `docker compose run --rm app npx tsx scripts/nuc-pglite-cutover.ts <export|import> ...`
# tsx は node_modules に既存 (devDeps 込み COPY)、$lib alias は tsconfig paths を tsx が解決、
# drizzle/pglite は PGlite boot 時 migration の SSOT (connection.ts)。手順 SSOT は
# docs/runbooks/nuc-pglite-cutover.md。
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/nuc-pglite-cutover.ts ./scripts/nuc-pglite-cutover.ts
# #3412: staging 用 PII-free 合成 seed CLI (deploy-nuc-staging.yml synthetic lane が
# `docker compose run --rm app npx tsx scripts/seed-staging.ts <generate|apply>` で実行)。
COPY --from=build /app/scripts/seed-staging.ts ./scripts/seed-staging.ts
# CLI が import する scripts/lib/runtime/ (nuc-cutover-verify 等) を dir ごと同梱する — 単体ファイル
# COPY だと lib module 追加のたびに漏れる (staging PGlite cycle 2 で ERR_MODULE_NOT_FOUND 実機露呈、#3620)。
# CI/dev 専用 helper は scripts/lib/ci/ に分離し image に入れない (#3659、image 純度 / attack surface)。
# COPY ↔ import の整合は tests/unit/architecture/dockerfile-copy-import-fitness.test.ts が機械検証する。
COPY --from=build /app/scripts/lib/runtime ./scripts/lib/runtime
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/tsconfig.json ./
# root tsconfig は .svelte-kit/tsconfig.json を extends し $lib paths はそちら側 (svelte-kit sync
# 生成物、build stage に存在)。tsx の alias 解決に必要な該当ファイルのみ COPY する。
COPY --from=build /app/.svelte-kit/tsconfig.json ./.svelte-kit/tsconfig.json

# Copy entrypoint script (strip Windows CRLF line endings)
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "index.js"]
