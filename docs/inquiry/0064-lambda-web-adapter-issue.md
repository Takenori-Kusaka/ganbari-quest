# #0064 Deploy to AWS 失敗 — Lambda Web Adapter イメージ問題

## 相談概要

GitHub Actions の「Deploy to AWS」ワークフローが、Docker ビルド時に Lambda Web Adapter のイメージ取得に失敗しています。
正しいイメージ URI とバージョン、および Dockerfile の書き方についてアドバイスをいただきたいです。

---

## 1. 現在のエラー

**GitHub Actions ログ (2026-03-17):**
```
#3 ERROR: public.ecr.aws/awsguru/aws-lambda-web-adapter:0.8.4: not found
ERROR: failed to build: failed to solve: public.ecr.aws/awsguru/aws-lambda-web-adapter:0.8.4:
  failed to resolve source metadata for public.ecr.aws/awsguru/aws-lambda-web-adapter:0.8.4:
  public.ecr.aws/awsguru/aws-lambda-web-adapter:0.8.4: not found
```

**原因:** `public.ecr.aws/awsguru/aws-lambda-web-adapter` というリポジトリが ECR Public Gallery に存在しない。

---

## 2. 現在の Dockerfile（問題あり）

**`Dockerfile.lambda`:**
```dockerfile
# Lambda Web Adapter: converts Lambda events to HTTP requests
FROM public.ecr.aws/awsguru/aws-lambda-web-adapter:0.8.4 AS adapter  # ← ここが間違い

# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build SvelteKit
FROM deps AS build
COPY . .
RUN mkdir -p data && npm run build

# Stage 3: Lambda runtime
FROM node:22-alpine AS runtime
COPY --from=adapter /lambda-adapter /opt/extensions/  # ← コピー元パスも要確認
WORKDIR /app

# Copy SvelteKit build output + production dependencies
COPY --from=build /app/build/ ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Lambda Web Adapter settings
ENV PORT=3000
ENV HOST=0.0.0.0
ENV AWS_LWA_PORT=3000
ENV AWS_LWA_READINESS_CHECK_PATH=/api/health
ENV NODE_ENV=production

CMD ["node", "index.js"]
```

---

## 3. 確認したいこと

### Q1. 正しいイメージ URI は？

調査した限り、以下のいずれかが正しいようですが、確定できていません：

| 候補 | URI |
|------|-----|
| 候補A | `public.ecr.aws/awsguru/aws-lambda-adapter` |
| 候補B | `public.ecr.aws/aws-lambda-web-adapter/aws-lambda-web-adapter` |

### Q2. 推奨バージョンタグは？

- `0.9.1` ? `1.0.0-rc1` ? `latest` ?
- 安定版として推奨されるタグは何でしょうか

### Q3. COPY パスは正しい？

```dockerfile
COPY --from=adapter /lambda-adapter /opt/extensions/
```

イメージによってバイナリの配置パスが異なる可能性があります。正しいコピー元パスを確認したいです。

### Q4. ARM64 との互換性

CDK 側で Lambda を `ARM_64`（Graviton2）に設定しています。Lambda Web Adapter イメージは ARM64 に対応していますか？

---

## 4. アーキテクチャ全体像（参考）

```
                    ┌──────────────┐
                    │  CloudFront  │
                    └──────┬───────┘
                           │ HTTPS
                    ┌──────▼───────┐
                    │ Lambda Fn URL│
                    │(RESPONSE_    │
                    │  STREAM)     │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │  Lambda (Docker Image)  │
              │  ┌────────────────────┐ │
              │  │ Lambda Web Adapter │ │  ← /opt/extensions/ に配置
              │  │  (port 3000 を監視) │ │
              │  └────────┬───────────┘ │
              │           │ HTTP        │
              │  ┌────────▼───────────┐ │
              │  │ SvelteKit          │ │  ← node index.js (adapter-node)
              │  │ (port 3000)        │ │
              │  └────────────────────┘ │
              └─────────────────────────┘
                      │           │
              ┌───────▼──┐  ┌────▼────┐
              │ DynamoDB  │  │   S3    │
              └──────────┘  └─────────┘
```

### デプロイフロー（GitHub Actions 4フェーズ）

1. **CDK Deploy StorageStack** — ECR リポジトリ・DynamoDB・S3 を作成
2. **Docker build & push** — `Dockerfile.lambda` でビルド → ECR に push ← **ここで失敗**
3. **CDK Deploy all stacks** — Lambda（ECR イメージ参照）・CloudFront 等を作成
4. **Update Lambda** — 最新イメージに切り替え

### Lambda 設定（CDK）

```typescript
// infra/lib/compute-stack.ts
this.fn = new lambda.DockerImageFunction(this, 'SvelteKitFn', {
  functionName: 'ganbari-quest-app',
  code: lambda.DockerImageCode.fromEcr(props.repository, {
    tagOrDigest: 'latest',
  }),
  memorySize: 512,
  timeout: cdk.Duration.seconds(30),
  architecture: lambda.Architecture.ARM_64,  // ← Graviton2
  environment: {
    TABLE_NAME: props.table.tableName,
    ASSETS_BUCKET: props.assetsBucket.bucketName,
    AWS_LWA_PORT: '3000',
    PORT: '3000',
    HOST: '0.0.0.0',
    NODE_ENV: 'production',
  },
});
```

---

## 5. 環境情報

| 項目 | 値 |
|------|-----|
| AWS リージョン | us-east-1 |
| Lambda アーキテクチャ | ARM_64 (Graviton2) |
| Node.js バージョン | 22 (Alpine) |
| フレームワーク | SvelteKit 2 + adapter-node |
| CDK バージョン | v2 (TypeScript) |
| CI | GitHub Actions (OIDC 認証) |

---

## 6. 関連ファイル

- `Dockerfile.lambda` — Docker ビルド定義（修正対象）
- `infra/lib/compute-stack.ts` — Lambda CDK 定義
- `infra/lib/storage-stack.ts` — ECR リポジトリ CDK 定義
- `.github/workflows/deploy.yml` — デプロイワークフロー
