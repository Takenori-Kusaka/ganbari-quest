<h1 align="center">
  がんばりクエスト
</h1>

<p align="center">
  <strong>子供の「がんばり」をRPGに変える -- 家庭内ゲーミフィケーションWebアプリ</strong>
</p>

<p align="center">
  <a href="https://github.com/sponsors/Takenori-Kusaka"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github" alt="Sponsor"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit 2">
  <img src="https://img.shields.io/badge/Svelte-5_(Runes)-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker">
</p>

<p align="center">
  <a href="./README.en.md">English</a> | 日本語
</p>

---

## 特徴

- **RPG風ゲーミフィケーション** -- レベルアップ、ステータス5種、称号コレクション、コンボボーナスで日々の活動を冒険に
- **年齢対応UI** -- 5モード（baby / preschool / elementary / junior / senior）で、フォントサイズ・タップ領域・情報密度が自動変化
- **簡単操作** -- 最大2タップで活動記録。デイリーミッション、チェックリストで習慣化
- **偏差値比較** -- 発達心理学に基づく市場ベンチマークで「うちの子の強み」を可視化
- **家庭内完結** -- LAN内で動作、外部通信不要。子供のデータは家族だけのもの
- **きせかえアバター** -- ポイントで背景・フレーム・エフェクトを購入してカスタマイズ
- **キャリアプランニング** -- マンダラチャートで将来の夢を構造化（大谷翔平方式）
- **セルフホスト可能** -- Docker一発で自宅サーバーに展開。OSSだからコードも完全透明

## クイックスタート

### 前提条件

| 要件 | バージョン |
|------|-----------|
| Docker & Docker Compose | 20.10+ / v2+ |
| **-- または --** | |
| Node.js | 22+ |
| npm | 10+ |

### Docker（推奨・セルフホスト向け）

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
docker compose up -d
```

`http://localhost:3000` にアクセス。初回はセットアップウィザードが表示されます。

**初回起動時の動作:**
1. Docker イメージをビルド（マルチステージ、Node.js 22 Alpine ベース）
2. SQLite データベースが `./data/` に自動作成
3. スキーマ適用 & シードデータ投入
4. ポート 3000 でアプリ起動

### ローカル開発

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
npm install
cp .env.example .env
npm run dev
```

`http://localhost:5173` で開発サーバーが起動します（ホットリロード対応）。

## 設定

`.env.example` を `.env` にコピーして設定してください。すべての変数にデフォルト値があるため、設定なしでも動作します。

### 基本設定

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DATABASE_URL` | `./data/ganbari-quest.db` | SQLite データベースのパス |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `PORT` | `3000` | HTTP ポート |
| `ORIGIN` | 自動検出 | アプリの完全URL（リバースプロキシ使用時は明示的に設定） |

### オプション連携

| 変数 | 説明 |
|------|------|
| `AI_PROVIDER` | AI プロバイダー: `gemini` or `bedrock`（アバター画像のAI生成用） |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) API キー（`AI_PROVIDER=gemini` 時） |
| `GDRIVE_CLIENT_ID` | Google Drive バックアップ -- OAuth クライアントID |
| `GDRIVE_CLIENT_SECRET` | Google Drive バックアップ -- OAuth クライアントシークレット |
| `GDRIVE_REFRESH_TOKEN` | Google Drive バックアップ -- OAuth リフレッシュトークン |
| `GDRIVE_FOLDER_ID` | Google Drive バックアップ -- ターゲットフォルダID |
| `DISCORD_ALERT_WEBHOOK_URL` | 500 エラー通知用 Discord Webhook |
| `LOG_LEVEL` | ログレベル（デフォルト: `info`） |

### バックアップ設定

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `BACKUP_DIR` | `./data/backups` | ローカルバックアップディレクトリ |
| `BACKUP_RETENTION` | `10` | 保持するバックアップファイル数 |
| `BACKUP_POST_HOOK` | -- | バックアップ後スクリプト（例: `node scripts/hooks/gdrive-upload.cjs`） |

> **注:** 本番SaaS設定（`AWS_LICENSE_SECRET`, `STRIPE_*`, `CRON_SECRET` 等）はセルフホストでは不要です。セルフホスト環境ではすべてのコア機能が利用可能です。全変数の一覧は `.env.example` を参照してください。

## セルフホスティングガイド

### 最小システム要件

| リソース | 最小 | 推奨 |
|---------|------|------|
| CPU | 1コア | 2コア |
| RAM | 512 MB | 1 GB |
| ストレージ | 500 MB | 2 GB（バックアップ含む） |
| OS | Docker 対応 OS | Linux |

### 基本デプロイ

```bash
# クローン & 起動
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
docker compose up -d

# ログ確認
docker compose logs -f app

# 停止
docker compose down

# 最新版にアップデート
git pull
docker compose up -d --build
```

### データ永続化

以下のディレクトリが Docker ボリュームとしてマウントされ、コンテナ再起動後も保持されます。

| ディレクトリ | 内容 |
|-------------|------|
| `./data/` | SQLite データベースとバックアップ |
| `./uploads/` | ユーザーアップロードファイル（アバター等） |
| `./generated/` | AI 生成画像 |
| `./tenants/` | テナント固有データ |

### 自動バックアップ

バックアップサイドカーを有効にして、毎日 3:00 AM（JST）に自動バックアップを実行できます。

```bash
docker compose --profile backup up -d
```

Google Drive へのクラウドバックアップを有効にするには、`.env` ファイルに `GDRIVE_*` 変数を設定してください。詳細は `.env.example` を参照。

### HTTPS（リバースプロキシ）

HTTPS を使う本番デプロイでは、`docker-compose.yml` の Caddy セクションのコメントを外し、`Caddyfile` を作成します。

```
your-domain.example.com {
    reverse_proxy app:3000
}
```

`.env` を更新します。

```bash
ORIGIN=https://your-domain.example.com
```

nginx や Traefik 等、TLS を終端してポート 3000 に転送するリバースプロキシも利用可能です。

### LAN 内の他デバイスからアクセス

スマートフォンやタブレットからアクセスするには:

1. サーバーのローカル IP を確認（例: `192.168.1.100`）
2. `.env` に `ORIGIN=http://192.168.1.100:3000` を設定
3. 再起動: `docker compose up -d`
4. `http://192.168.1.100:3000` でアクセス

### ヘルスチェック

`GET /api/health` でヘルスエンドポイントが利用可能です（Docker の `HEALTHCHECK` で使用）。

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | SvelteKit 2 + Svelte 5 (Runes) |
| UI | Ark UI Svelte (Headless) + 独自デザインシステム |
| データベース | SQLite (WAL) + Drizzle ORM |
| テスト | Vitest + Playwright |
| Lint/Format | Biome + ESLint + Stylelint |
| 言語 | TypeScript (strict) |
| インフラ | Docker + Node.js 22 |

## 開発

### コマンド

```bash
npm run dev              # 開発サーバー (http://localhost:5173)
npm run build            # プロダクションビルド
npx vitest run           # ユニットテスト
npx playwright test      # E2E テスト
npx biome check .        # Lint & フォーマット
npx svelte-check         # 型チェック
npx drizzle-kit push     # DB マイグレーション
```

### ディレクトリ構成

```
ganbari-quest/
├── src/
│   ├── routes/              # SvelteKit ファイルベースルーティング
│   │   ├── (child)/         # 子供向けページ（年齢適応UI）
│   │   ├── (parent)/        # 親の管理画面（PIN認証付き）
│   │   └── api/             # REST API エンドポイント
│   └── lib/
│       ├── ui/              # Ark UI ラッパ + 共通コンポーネント
│       ├── features/        # 機能モジュール (career, avatar 等)
│       ├── domain/          # ドメインモデル・バリデーション
│       └── server/          # DB・サービス層 (server only)
├── docs/design/             # 設計ドキュメント
├── tests/                   # ユニット & E2E テスト
├── scripts/                 # マイグレーション・バックアップ・CI スクリプト
├── infra/                   # AWS CDK インフラ（SaaS）
├── docker-compose.yml       # Docker デプロイ設定
└── Dockerfile               # マルチステージプロダクションビルド
```

## SaaS vs セルフホスト

| | セルフホスト（このリポジトリ） | SaaS |
|---|---|---|
| **コスト** | 無料（自前ハードウェア） | 無料枠 + 有料プラン |
| **データ保存先** | 自分のサーバー | クラウド（AWS） |
| **セットアップ** | `docker compose up -d` | Web サイトで登録 |
| **アップデート** | `git pull && docker compose up -d --build` | 自動 |
| **認証** | ローカル PIN 認証 | AWS Cognito (Google SSO) |
| **AI 機能** | 自前 API キー設定 | 標準搭載 |
| **バックアップ** | 手動 or cron | 自動 |
| **サポート** | コミュニティ (GitHub Issues) | メールサポート |

## コントリビュート

バグ報告・機能提案・PRを歓迎します。詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## コミュニティ & サポート

- **Issue & ディスカッション**: [GitHub Issues](https://github.com/Takenori-Kusaka/ganbari-quest/issues)
- **メール**: [ganbari.quest.support@gmail.com](mailto:ganbari.quest.support@gmail.com)
- **スポンサー**: [GitHub Sponsors](https://github.com/sponsors/Takenori-Kusaka) -- 開発を応援していただける方はぜひ

## ライセンス

[AGPL-3.0](./LICENSE) -- 個人利用・セルフホスト・改造は自由です。改変版をネットワークサービスとして配布する場合は、同じライセンスでソースコードを公開する必要があります。
