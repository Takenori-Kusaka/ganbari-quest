# がんばりクエスト - AGENTS.md

## Commands

```bash
npm run dev          # 開発サーバー起動
npm run build        # プロダクションビルド
npx vitest           # ユニットテスト実行
npx playwright test  # E2Eテスト実行
npx biome check .    # Lint・フォーマットチェック
npx biome check --write .  # Lint自動修正
npx drizzle-kit push       # DBマイグレーション適用
npx drizzle-kit generate   # マイグレーションファイル生成
```

## Project Structure

```
src/
├── routes/              # SvelteKit ファイルベースルーティング
│   ├── (child)/         # 子供用画面（認証なし）
│   ├── (parent)/        # 親の管理画面（PIN認証）
│   └── api/v1/          # JSON API エンドポイント
├── lib/
│   ├── ui/              # デザインシステム
│   │   ├── primitives/  # Ark UI 薄ラッパ
│   │   ├── components/  # 共通UIコンポーネント
│   │   └── styles/      # デザイントークン・CSS
│   ├── features/        # 機能単位モジュール
│   ├── domain/          # ドメインモデル・バリデーション
│   └── server/          # サーバーサイド専用
│       ├── db/          # Drizzle ORM スキーマ・リポジトリ
│       ├── services/    # ユースケース・アプリケーションサービス
│       └── config/      # 環境変数・設定
tests/
├── unit/                # Vitest ユニットテスト
└── e2e/                 # Playwright E2Eテスト
docs/
├── design/              # 設計ドキュメント群
├── tickets/             # 開発チケット
└── reference/           # 参考資料
```

## Tech Stack

- **Framework**: SvelteKit 2 + Svelte 5 (Runes)
- **UI**: Ark UI Svelte (@ark-ui/svelte) + Tailwind CSS
- **Language**: TypeScript (strict: true)
- **Database**: SQLite + Drizzle ORM
- **Test**: Vitest + Svelte Testing Library + Playwright
- **Lint**: Biome
- **Image Generation**: Gemini API (Nano Banana Pro)

## Code Style

```typescript
// Good - サービス層を経由したデータアクセス
// src/routes/api/v1/activities/+server.ts
import { getActivities } from '$lib/server/services/activity-service';
export async function GET({ url }) {
  const activities = await getActivities(url.searchParams);
  return json(activities);
}

// Bad - エンドポイントから直接DBアクセス
import { db } from '$lib/server/db/client';
export async function GET() {
  const activities = await db.select().from(activitiesTable);
  return json(activities);
}
```

```svelte
<!-- Good - $state を使ったリアクティブな状態管理 (Svelte 5) -->
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>

<!-- Bad - 古い Svelte 4 のリアクティブ宣言 -->
<script lang="ts">
  let count = 0;
  $: doubled = count * 2;
</script>
```

## Testing

- ユニットテスト: `tests/unit/` に配置。Vitest + Svelte Testing Library。
- E2Eテスト: `tests/e2e/` に配置。Playwright で主要フローをカバー。
- テストファイル命名: `*.test.ts` / `*.spec.ts`

## Git Workflow

- ブランチ: `feature/XXXX-チケット名` の形式
- コミットメッセージ: `feat:`, `fix:`, `docs:`, `refactor:`, `test:` のプレフィクス
- チケット単位でコミット＆プッシュ

## Boundaries

- **Always Do:**
  - テストを書いてから実装（TDD推奨）
  - 変更したファイルに対応するテストを更新
  - `$lib/server/services` 経由でビジネスロジックを実装
  - Svelte 5 の runes (`$state`, `$derived`, `$effect`) を使用

- **Ask First:**
  - 新しい npm パッケージの追加
  - DB スキーマの変更
  - API エンドポイントの追加・変更
  - デザイントークンの変更

- **Never Do:**
  - `.env` ファイルをコミットしない
  - `console.log` を本番コードに残さない
  - Svelte 4 の `$:` リアクティブ宣言を使わない
  - Ark UI を `src/routes` から直接 import しない
  - `+server.ts` から直接 ORM を呼び出さない
