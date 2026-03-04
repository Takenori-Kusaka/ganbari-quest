# Docker化とCI/CD改善

### ステータス

`Done`

---

### 概要

アプリケーションをDocker化し、docker composeで一発起動できる環境を整備する。GitHub Actionsでイメージビルドの自動テストを行い、NUCサーバーへのデプロイもDockerコンテナベースに移行する。

### 背景・動機

現在のデプロイはビルド成果物をSCPでNUCサーバーに直接配置する方式で、以下の課題がある:
- 環境依存（Node.jsバージョン、native module のビルド環境等）
- OSSとして第三者が利用する際のセットアップコストが高い
- better-sqlite3のnative rebuildが環境ごとに必要

Docker化により、`docker compose up` だけで動作する環境を提供し、開発者・利用者双方の負担を大幅に軽減する。

**要件2**: Docker化・CI/CD改善

### ゴール

- [x] `Dockerfile` を作成（multi-stage build: deps → build → runtime）
- [x] `.dockerignore` を作成
- [x] `docker-compose.yml` を作成（app + バインドマウント）
- [x] SQLiteデータベースをDockerボリュームにマウント（永続化）
- [x] uploadsディレクトリをDockerボリュームにマウント（アバター画像永続化）
- [ ] バックアップスクリプトがコンテナ内から実行可能であること
- [ ] Google Driveバックアップが維持されること（サービスアカウントキーのマウント）
- [x] GitHub Actions に `docker build` テストジョブを追加
- [x] NUCサーバーのデプロイをDockerコンテナ起動方式に移行
- [x] `docker compose up -d` で初回起動時にseedが自動実行される仕組み
- [x] ヘルスチェックエンドポイント（`/api/health`）をDockerのhealthcheckに設定

### 技術方針

#### Dockerfile（multi-stage）

```
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build
FROM deps AS build
COPY . .
RUN npm run build

# Stage 3: Runtime
FROM node:22-alpine AS runtime
RUN apk add --no-cache sqlite
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/src/lib/server/db/seed.ts ./src/lib/server/db/seed.ts
COPY --from=build /app/src/lib/server/db/schema.ts ./src/lib/server/db/schema.ts
COPY scripts/ ./scripts/
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "build/index.js"]
```

#### docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - db-data:/app/data
      - uploads:/app/uploads
    env_file: .env
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data

volumes:
  db-data:
  uploads:
  caddy-data:
```

#### GitHub Actions追加ジョブ

```yaml
docker-build:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: docker build -t ganbari-quest:test .
    - run: docker compose up -d
    - run: sleep 5 && curl -f http://localhost:3000/api/health
    - run: docker compose down
```

### 依存

- #0041 OSS汎用化（Docker化とドキュメント整備は並行可能だが、seed処理の汎用化が必要）

### 作業メモ

- better-sqlite3はAlpine Linuxでのビルドに `python3`, `make`, `g++` が必要（depsステージで）
- NUCサーバー(Windows)にはDocker Desktopのインストールが前提
- 既存のGoogle Drive バックアップスクリプトはコンテナ内の `/app/scripts/` から実行
- cronジョブはホストのタスクスケジューラから `docker exec` で実行する方式

### 成果・結果

**Docker化完了:**
- Dockerfile（multi-stage build: deps → build → runtime）
- docker-compose.yml（バインドマウント方式: ./data, ./uploads, ./generated）
- .dockerignore
- scripts/docker-entrypoint.sh（初回DB自動作成・seed実行）
- GitHub Actions にdocker-buildジョブ追加

**NUCサーバーデプロイ完了（2026-03-03）:**
- Docker Desktop（Linux containers）でコンテナ起動確認
- 既存データ（SQLite DB + アバター画像7枚）をバインドマウントディレクトリに移行
- ヘルスチェック（/api/health）正常応答確認
- 子供選択・アバター画像配信の動作確認
- コンテナ名: `ganbari-quest-app-1`
- デプロイ先: `C:\Docker\ganbari-quest\`

**Dockerビルド時の注意点:**
- Docker Desktop SSH接続時は `docker context use default` が必要（`desktop-linux`はSSHから動作しない）
- `.docker/config.json` の `credsStore: "desktop"` はSSHセッションから認証エラーになるため削除が必要
- SvelteKit postbuild分析がサーバモジュール（better-sqlite3等）をimportするため、ビルド時に `mkdir -p data` が必要

### 残課題・次のアクション

- Docker Hub / GitHub Container Registry へのイメージ公開（OSS化後）
- Watchtower等による自動更新の検討
- バックアップスクリプトの `docker exec` 対応（現在はホストから直接ファイルアクセス可能）
