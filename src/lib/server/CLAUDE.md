# src/lib/server/ — バックエンド・サービス層ルール

## アーキテクチャ原則
- **サービス層経由**: `+server.ts` や `+page.server.ts` から Drizzle ORM や DB に直接アクセスしてはいけません。必ず `$lib/server/services` 配下のサービス層を経由してください。
- **エラーハンドリング**: API エラーは `@sveltejs/kit` の `error`, `json` を使用し、一貫したレスポンス形式を返してください。

## 開発プラン切替 (#758)
- `.env.local` で `DEBUG_PLAN` / `DEBUG_TRIAL` 等を設定し、開発環境で本番のプラン制限を上書き検証できます。詳細は `src/lib/server/debug-plan.ts` を参照してください。

## デモデータとスキーマ
- DBスキーマやデモデータを変更する際は、以下を必ず同期してください:
  - `tests/e2e/global-setup.ts`
  - `tests/unit/helpers/test-db.ts`
  - `src/lib/server/demo/demo-data.ts`
