# Project Context

がんばりクエスト - 子供の活動をゲーミフィケーションで動機付けする家庭内専用Webアプリ。
SvelteKit 2 + Svelte 5 (Runes) + Ark UI Svelte + SQLite + Drizzle ORM。TypeScript strict。

## Key Directories

- `src/routes/` - SvelteKit ファイルベースルーティング
- `src/lib/ui/` - Ark UI ラッパ・共通UIコンポーネント
- `src/lib/features/` - 機能単位のコンポーネント・ロジック
- `src/lib/domain/` - ドメインモデル・バリデーション
- `src/lib/server/` - DB・外部API・サービス層（server only）
- `docs/design/` - 設計ドキュメント（企画書〜テスト設計書）
- `docs/tickets/` - 開発チケット（Markdownベース）
- `docs/reference/` - 参考資料

## Coding Guidelines

- 型は必須。新規コードはすべて TypeScript strict で型付き。
- データ取得は `+page.ts` / `+layout.ts` の `load` を使用。コンポーネント内の直接 fetch 禁止。
- 状態管理は `$state` / `$derived` / `$effect` を基本。stores は最小限。
- UI は `$lib/ui/primitives`（Ark UI ラッパ）と `$lib/ui/components` からのみ利用。Ark UI を routes から直接 import しない。
- `+server.ts` から直接 ORM クライアントを呼び出さない。必ず `$lib/server/services` 経由。
- API エラーは `@sveltejs/kit` の `error`, `json` で一貫したレスポンスを返す。

## Build & Test

- 開発: `npm run dev`
- ビルド: `npm run build`
- テスト: `npx vitest`
- E2E: `npx playwright test`
- Lint: `npx biome check .`
- DB マイグレーション: `npx drizzle-kit push`

## Things Not To Do

- `src/routes` 配下のページコンポーネントにビジネスロジックを書かない。
- DB への直接アクセスは禁止。必ず `$lib/server/db` 経由。
- `.env` ファイルをコミットしない。
- `node_modules/` や `*.db` ファイルをコミットしない。
- 古い Svelte 4 / SvelteKit 1 の書き方（`$:` リアクティブ宣言等）を使わない。

## Further Context

- UI フレームワーク設計: @docs/reference/ui_framwork.md
- バックエンド設計: @docs/reference/backend_framework.md
- Gemini API ガイド: @docs/reference/gemini_image_generation_guide.md
- 家族情報（サブモジュール）: @personal/data/family.yml

## Compaction Rules

- コンパクション時は「変更ファイル一覧」「実行したテストコマンドと結果」「現在作業中のチケット番号」を必ず要約に残す。
- 作業中のチケットは `docs/tickets/` で管理。再開時はチケットのステータスを確認して継続する。

## Deploy

- 対象: NUCサーバー (Windows) `ssh kusaka-server@192.168.68.79`
- 認証: 親の管理画面のみPINコード、子供画面は認証なし（LAN内限定）
