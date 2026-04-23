# Project Context: がんばりクエスト

子供の活動をゲーミフィケーションで動機付けする家庭内専用Webアプリ。
SvelteKit 2 + Svelte 5 (Runes) + Ark UI Svelte + SQLite + Drizzle ORM。TypeScript strict。

## 核心的マインドセット
- **設計書が SSOT**: 実装前に設計書を更新し、書かれていない仕様は存在しないものとする (ADR-0001)。
- **品質のラチェット**: テストカバレッジや静的解析の閾値を決して下げない (ADR-0005)。
- **検証の徹底**: 実機での目視確認とスクリーンショット添付を必須とする。

## 主要ディレクトリ
- `src/routes/`: SvelteKit ファイルベースルーティング
- `src/lib/ui/`: Ark UI ラッパ・共通UIコンポーネント
- `src/lib/features/`: 機能単位のコンポーネント・ロジック
- `src/lib/domain/`: ドメインモデル・バリデーション・用語辞書
- `src/lib/server/`: DB・外部API・サービス層（server only）
- `docs/design/`: 設計ドキュメント（企画書〜テスト設計書）
- `docs/decisions/`: ADR（Architecture Decision Records）

## 開発コマンド
- 開発: `npm run dev` / `npm run dev:cognito` (認証が必要な場合)
- ビルド: `npm run build`
- テスト: `npx vitest run` / `npx playwright test`
- Lint: `npx biome check .` / `npx biome check --write .`
- 型チェック: `npx svelte-check`
- DB: `npx drizzle-kit push` / `npx drizzle-kit generate`

## コーディング・ガイドライン
- **TypeScript strict**: すべての新規コードに型を必須とする。
- **Svelte 5 Runes**: `$state`, `$derived`, `$effect` を基本とし、Svelte 4 の `$:` は禁止。
- **サービス層**: `+server.ts` や `+page.server.ts` から直接 ORM を呼ばず、必ず `$lib/server/services` を経由する。
- **UI コンポーネント**: `$lib/ui/primitives` と `components` を使用し、Ark UI を直接 import しない。
- **用語辞書**: ラベルや文言は `src/lib/domain/labels.ts` を SSOT とする (ADR-0009)。

## 必須チェックリスト (コミット/PR前)
1. `npx biome check .` (Lint/Format)
2. `npx svelte-check` (Type check)
3. `npx vitest run` (Unit tests)
4. `npm run test:storybook` (Component tests)
5. `npx playwright test` (E2E tests)

## 禁止事項 (Things Not To Do)
- **環境変数の不備**: `.env` をコミットしない。新規 env 追加時は `infra/GEMINI.md` の配布手順を遵守。
- **検証なしの完了**: 実際に画面を確認せずにタスクを完了としない。
- **直接アクセス**: DB への直接アクセス、コンポーネント内での直接 fetch を避ける。
- **リテラル直書き**: プラン名やライセンス状態などを文字列リテラルで書かない (定数を使用)。
- **独自実装の優先**: 10行を超える独自ロジックを書く前に、既存 OSS やパターンを調査する (#1350)。

## Context-specific Rules
詳細なルールは各フォルダの `GEMINI.md` を参照:
- `src/routes/GEMINI.md`: UI/デザイン、デザインシステム、URL廃止ルール
- `tests/GEMINI.md`: テスト品質、スキーマ変更テスト、E2Eガイダンス
- `docs/GEMINI.md`: 設計書更新、ADR管理、画像アセット
- `.github/GEMINI.md`: Issue/チケット運用、PR運用
- `infra/GEMINI.md`: AWS/NUC デプロイ、環境変数配布

## Gemini CLI 運用ルール
- **Validation**: すべての変更はテストまたは実機検証によって成功を証明すること。
- **Research**: 複雑な変更の前に `grep_search` 等で影響範囲を徹底的に調査すること。
- **Plan Mode**: 大規模な設計変更や新規機能追加時には `enter_plan_mode` で設計案を提示し承認を得ること。
