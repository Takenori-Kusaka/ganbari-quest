<h1 align="center">
  がんばりクエスト
</h1>

<p align="center">
  <strong>子供の「がんばり」をRPGに変える — 家庭内ゲーミフィケーションWebアプリ</strong>
</p>

<p align="center">
  <a href="https://github.com/sponsors/Takenori-Kusaka"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github" alt="Sponsor"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit 2">
  <img src="https://img.shields.io/badge/Svelte-5_(Runes)-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/tests-606_passing-brightgreen" alt="Tests">
</p>

<p align="center">
  <a href="./README.en.md">English</a> | 日本語
</p>

---

## 特徴

- **RPG風ゲーミフィケーション** — レベルアップ、ステータス5種、称号コレクション、コンボボーナスで日々の活動を冒険に
- **年齢対応UI** — 0歳（baby）〜15歳（teen）まで、成長に合わせてUIモードが自動変化
- **簡単操作** — 最大2タップで活動記録。デイリーミッション、チェックリストで習慣化
- **偏差値比較** — 発達心理学に基づく市場ベンチマークで「うちの子の強み」を可視化
- **家庭内完結** — LAN内で動作、外部通信なし。子供のデータは家族だけのもの
- **きせかえアバター** — ポイントで背景・フレーム・エフェクトを購入してカスタマイズ
- **キャリアプランニング** — マンダラチャートで将来の夢を構造化（大谷翔平方式）
- **セルフホスト可能** — Docker一発で自宅サーバーに展開。OSSだからコードも完全透明

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | SvelteKit 2 + Svelte 5 (Runes) |
| UI | Ark UI Svelte (Headless) + 独自デザインシステム |
| データベース | SQLite (WAL) + Drizzle ORM |
| テスト | Vitest (606件) + Playwright |
| Lint/Format | Biome |
| 言語 | TypeScript (strict) |
| インフラ | Docker + Node.js 22 |

## クイックスタート

### Docker（推奨）

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
docker compose up -d
```

`http://localhost:3000` にアクセス。初回はセットアップウィザードが表示されます。

### ローカル開発

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
npm install
cp .env.example .env
npm run dev
```

`http://localhost:5173` で開発サーバーが起動します。

## ディレクトリ構成

```
ganbari-quest/
├── src/
│   ├── routes/             # SvelteKit ファイルベースルーティング
│   │   ├── (child)/        # 子供向けページ (baby/kinder/teen)
│   │   ├── (parent)/       # 親の管理画面 (PIN認証付き)
│   │   └── api/            # REST API エンドポイント
│   └── lib/
│       ├── ui/             # Ark UI ラッパ + 共通コンポーネント
│       ├── features/       # 機能単位 (career, avatar 等)
│       ├── domain/         # ドメインモデル・バリデーション
│       └── server/         # DB・サービス層 (server only)
├── docs/
│   ├── design/             # 設計ドキュメント (12本)
│   └── tickets/            # 開発チケット (100+)
├── scripts/                # マイグレーション・バックアップ
├── tests/                  # ユニットテスト (32ファイル)
└── docker-compose.yml
```

## 環境変数

`.env.example` を `.env` にコピーして設定してください。

| 変数 | 必須 | 説明 |
|------|------|------|
| `DATABASE_URL` | Yes | SQLiteデータベースのパス |
| `HOST` | No | バインドホスト（デフォルト: `0.0.0.0`） |
| `PORT` | No | ポート番号（デフォルト: `3000`） |
| `ORIGIN` | No | アプリのURL |
| `GEMINI_API_KEY` | No | アバター画像AI生成用 |
| `GDRIVE_*` | No | Google Driveバックアップ用 |

## 開発コマンド

```bash
npm run dev          # 開発サーバー
npm run build        # プロダクションビルド
npx vitest run       # ユニットテスト (606件)
npx playwright test  # E2Eテスト
npx biome check .    # Lint
npx drizzle-kit push # DBマイグレーション
```

## コミュニティ

[![Discord](https://img.shields.io/badge/Discord-コミュニティ-5865F2?logo=discord&logoColor=white)](https://discord.gg/5pWkf4Z5)

質問・要望・体験談の共有は [Discordコミュニティ](https://discord.gg/5pWkf4Z5) で受け付けています。お気軽にご参加ください。

## コントリビュート

バグ報告・機能提案・PRを歓迎します。詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## サポート

がんばりクエストの開発を応援していただける方は [GitHub Sponsors](https://github.com/sponsors/Takenori-Kusaka) からご支援ください。

## ライセンス

[AGPL-3.0](./LICENSE) — 個人利用・セルフホスト・改造は自由です。
