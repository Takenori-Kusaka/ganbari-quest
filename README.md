# がんばりクエスト

子供の日々の活動をゲーミフィケーションで動機付けし、成長を可視化する家庭内専用Webアプリケーション。

## 主な特徴

- **ゲーミフィケーション**: レベルアップ、ステータス表示、実績解除でやる気を引き出す
- **簡単操作**: 最大2タップで活動を記録できるUI
- **年齢対応**: 0〜18歳まで、年齢に応じた活動を自動表示（学習指導要領準拠）
- **ポイントシステム**: 活動に応じたポイント付与でお小遣い管理にも
- **子供別ページ**: テーマカラーやUIモードで個性を表現
- **親の管理画面**: PIN認証で保護された設定・管理機能

## クイックスタート

```bash
# 1. クローン
git clone https://github.com/your-username/ganbari-quest.git
cd ganbari-quest

# 2. セットアップ
npm install
cp .env.example .env

# 3. 起動
npm run dev
```

初回アクセス時にセットアップウィザードが表示されます。PINコードの設定と子供の登録を行ってください。

## 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | SvelteKit 2 + Svelte 5 (Runes) |
| UIライブラリ | Ark UI Svelte + Tailwind CSS |
| データベース | SQLite + Drizzle ORM |
| 画像生成 | Gemini API（任意） |
| テスト | Vitest + Playwright |
| Lint/Format | Biome |
| 言語 | TypeScript (strict) |

## ディレクトリ構成

```
ganbari-quest/
├── src/
│   ├── routes/           # SvelteKit ファイルベースルーティング
│   ├── lib/
│   │   ├── ui/           # UIコンポーネント
│   │   ├── features/     # 機能単位のロジック
│   │   ├── domain/       # ドメインモデル・バリデーション
│   │   └── server/       # DB・サービス層（server only）
│   └── hooks.server.ts   # 認証・リダイレクト
├── docs/
│   ├── design/           # 設計ドキュメント
│   ├── tickets/          # 開発チケット
│   └── reference/        # 参考資料
├── tests/                # テストコード
└── static/               # 静的ファイル
```

## 環境変数

`.env.example` を `.env` にコピーして設定してください。

| 変数 | 必須 | 説明 |
|------|------|------|
| `DATABASE_URL` | Yes | SQLiteデータベースのパス |
| `HOST` | No | バインドするホスト（デフォルト: `0.0.0.0`） |
| `PORT` | No | ポート番号（デフォルト: `3000`） |
| `ORIGIN` | No | アプリのURL（未設定時は自動検出） |
| `GEMINI_API_KEY` | No | アバター画像生成用（Gemini API） |

## 開発

```bash
npm run dev          # 開発サーバー起動
npm run build        # プロダクションビルド
npx vitest           # ユニットテスト
npx playwright test  # E2Eテスト
npx biome check .    # Lint
```

詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT License](./LICENSE)
