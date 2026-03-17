# Contributing to がんばりクエスト

がんばりクエストへの貢献を歓迎します！バグ報告、機能提案、コードの改善など、どんな形でも大歓迎です。

## 開発環境の構築

### 前提条件

- Node.js 22+
- npm

### セットアップ

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
npm install
cp .env.example .env
npm run dev
```

ブラウザで `http://localhost:5173` にアクセスすると、初回セットアップウィザードが表示されます。

## コーディング規約

- TypeScript strict モードで型付き
- Svelte 5 (Runes) を使用: `$state`, `$derived`, `$effect`
- UIコンポーネントは `$lib/ui/components` に配置
- ビジネスロジックは `$lib/server/services` に集約
- `+server.ts` から直接 ORM を呼び出さない（サービス層経由）
- データ取得は `+page.ts` / `+layout.ts` の `load` を使用

詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

## テスト

```bash
npx vitest              # ユニットテスト（ウォッチモード）
npx vitest run          # ユニットテスト（CI向け）
npx playwright test     # E2Eテスト
npx svelte-check        # 型チェック
npx biome check .       # Lint
```

PRを作成する前に、`npx vitest run` が全件合格することを確認してください。

## ブランチ戦略

- `main`: プロダクション
- `feature/*`: 新機能
- `fix/*`: バグ修正

## プルリクエスト

1. フォークしてブランチを作成
2. 変更を実装（テスト追加を推奨）
3. `npx vitest run` と `npx svelte-check` が通ることを確認
4. プルリクエストを作成

## チケット管理

開発チケットは `docs/tickets/` にMarkdownで管理しています。

## ライセンス

本プロジェクトは [AGPL-3.0](./LICENSE) の下で公開されています。
貢献いただいたコードは同ライセンスの下で配布されます。
