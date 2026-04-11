# Stage 1: Dependencies (with native module build tools)
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build
FROM deps AS build
ARG APP_MAJOR_VERSION=1
# BUILD_TIMESTAMP is a cache-busting build arg (#711 / PR #826 review).
# Passing a unique value (e.g. $(date +%s)) on every build causes the
# RUN layer below to be rebuilt even when COPY . . layer cache hits —
# ensuring npm run version:generate actually runs and stamps a fresh date.
ARG BUILD_TIMESTAMP=unknown
ENV APP_MAJOR_VERSION=${APP_MAJOR_VERSION}
COPY . .
# Regenerate APP_VERSION at build time so every deployed image carries the
# build date, regardless of whether the caller committed a fresh version.ts (#711).
# SvelteKit postbuild analysis imports server modules including DB client;
# create data dir so better-sqlite3 doesn't fail during build.
# The echo embeds BUILD_TIMESTAMP into the layer's command string, which
# makes the BuildKit cache key sensitive to the arg value.
RUN echo "Build at: ${BUILD_TIMESTAMP}" && mkdir -p data && npm run version:generate && npm run build

# Stage 3: Runtime (minimal image)
FROM node:22-alpine AS runtime
WORKDIR /app

# Copy built application (flat layout: index.js, handler.js, client/, server/)
COPY --from=build /app/build/ ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Copy files needed for DB initialization (seed & schema push)
COPY --from=build /app/src/lib/server/db/seed.ts ./src/lib/server/db/seed.ts
COPY --from=build /app/src/lib/server/db/schema.ts ./src/lib/server/db/schema.ts
COPY --from=build /app/drizzle.config.ts ./

# Copy entrypoint script (strip Windows CRLF line endings)
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "index.js"]
