# Contributing to がんばりクエスト

## 開発環境の構築

### 前提条件

- Node.js 22+
- npm

### セットアップ

```bash
git clone https://github.com/your-username/ganbari-quest.git
cd ganbari-quest
npm install
cp .env.example .env
npm run dev
```

## コーディング規約

- TypeScript strict モードで型付き
- Svelte 5 (Runes) を使用: `$state`, `$derived`, `$effect`
- UIコンポーネントは `$lib/ui/components` に配置
- ビジネスロジックは `$lib/server/services` に集約
- `+server.ts` から直接 ORM を呼び出さない（サービス層経由）

詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

## テスト

```bash
npx vitest              # ユニットテスト
npx vitest run          # ユニットテスト（CI向け）
npx playwright test     # E2Eテスト
npx svelte-check        # 型チェック
npx biome check .       # Lint
```

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
