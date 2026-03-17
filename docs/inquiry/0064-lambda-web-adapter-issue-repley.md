必要な情報が十分に収集できました。回答を作成します。

***

## 結論：イメージ URI を `aws-lambda-adapter` に変更し、COPY パスに `lambda-adapter` を追加する

4つの質問に順番に回答します。

***

## Q1. 正しいイメージ URI

**正解は「候補A」** です。リポジトリ名は `aws-lambda-adapter`（`-web-` なし）： [github](https://github.com/awslabs/aws-lambda-web-adapter)

```
public.ecr.aws/awsguru/aws-lambda-adapter
```

`aws-lambda-web-adapter` というリポジトリは ECR Public Gallery に存在しません。`awsguru` namespace 配下のリポジトリ名が `aws-lambda-adapter`（ハイフン区切りで "web" なし）なので、元の Dockerfile の URI が根本原因です 。 [gallery.ecr](https://gallery.ecr.aws/awsguru/aws-lambda-adapter)

***

## Q2. 推奨バージョンタグ

**`0.9.1` が現時点の最新安定版（Latest）** です 。 [github](https://github.com/awslabs/aws-lambda-web-adapter/releases)

| タグ | ステータス |
|------|-----------|
| `0.9.1` | ✅ Latest（2025年4月リリース） [github](https://github.com/awslabs/aws-lambda-web-adapter/releases) |
| `0.9.0` | 旧安定版（2025年1月） [github](https://github.com/awslabs/aws-lambda-web-adapter/releases) |
| `0.8.4` | 旧安定版（2024年7月） [github](https://github.com/awslabs/aws-lambda-web-adapter/releases) |
| `latest` | 非推奨（再現性のためバージョン固定を推奨）|

`0.9.0` 以降では `AWS_LWA_ERROR_STATUS_CODES` など新機能が追加されています 。`latest` タグは将来のリリースで動作が変わるリスクがあるため、CI/CD では `0.9.1` のように固定することを強く推奨します。 [github](https://github.com/awslabs/aws-lambda-web-adapter/releases)

***

## Q3. COPY パスの修正

**コピー先パスに `lambda-adapter` というファイル名を含める必要があります** 。 [techblog.insightedge](https://techblog.insightedge.jp/entry/lambda-adapter)

```dockerfile
# ❌ 誤り（ディレクトリとして扱われる）
COPY --from=adapter /lambda-adapter /opt/extensions/

# ✅ 正しい（バイナリファイル名まで指定）
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
```

コピー元 `/lambda-adapter` はバイナリファイルです。コピー先も `/opt/extensions/lambda-adapter` とファイル名まで指定しないと Lambda がエクステンションとして認識しません 。 [techblog.recochoku](https://techblog.recochoku.jp/12030)

***

## Q4. ARM64（Graviton2）対応

**完全対応しています。** 公式 README に「Pre-compiled multi-arch images (x86_64 and arm64) are available」と明記されています 。 [github](https://github.com/awslabs/aws-lambda-web-adapter)

ただし、**GitHub Actions でビルドする際は `--platform linux/arm64` を明示的に指定する必要があります**。デフォルトの `ubuntu-latest` ランナーは `x86_64` のため、ARM64 イメージをビルドするには QEMU + Buildx が必要です 。 [zenn](https://zenn.dev/socialplus/articles/arm64-githubactions-lambda)

***

## 修正済み Dockerfile

```dockerfile
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

# ✅ 修正ポイント1: 正しいURI・バージョン・COPYパス
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /app

COPY --from=build /app/build/ ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

ENV PORT=3000
ENV HOST=0.0.0.0
ENV AWS_LWA_PORT=3000
ENV AWS_LWA_READINESS_CHECK_PATH=/api/health
# ✅ 修正ポイント2: レスポンスストリーミング有効化（CDK側でFUNCTION_URL invoke_mode=RESPONSE_STREAMを使う場合）
ENV AWS_LWA_INVOKE_MODE=response_stream
ENV NODE_ENV=production

CMD ["node", "index.js"]
```

***

## GitHub Actions のビルドステップ修正

ARM64 イメージをビルドするには `--platform linux/arm64` を指定します ： [zenn](https://zenn.dev/socialplus/articles/arm64-githubactions-lambda)

```yaml
- name: Set up QEMU
  uses: docker/setup-qemu-action@v3

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build and push
  uses: docker/build-push-action@v5
  with:
    context: .
    file: Dockerfile.lambda
    platforms: linux/arm64   # ← Graviton2 向け
    push: true
    tags: ${{ env.ECR_URI }}:latest
    provenance: false         # ← ECR との互換性のため推奨
```

`provenance: false` は ECR が OCI index manifest を正しく扱えない場合があるため付けておくと安全です 。 [blog.arthur1](https://blog.arthur1.dev/entry/2026/02/13/132102)

***

## まとめ：変更点一覧

| 項目 | 修正前（誤り） | 修正後（正しい） |
|------|--------------|----------------|
| イメージ URI | `public.ecr.aws/awsguru/aws-lambda-web-adapter:0.8.4` | `public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1` |
| COPY 先パス | `/opt/extensions/` | `/opt/extensions/lambda-adapter` |
| Docker ビルド platform | 未指定（x86_64） | `linux/arm64` |