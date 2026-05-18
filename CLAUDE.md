# Project Context (Global Layer)

がんばりクエスト - 子供の活動をゲーミフィケーションで動機付けする家庭内専用Webアプリ。
SvelteKit 2 + Svelte 5 (Runes) + Ark UI Svelte + SQLite + Drizzle ORM。TypeScript strict。

**SSOT**:
- プロダクト・ブランド・デザインシステム → `DESIGN.md` (プロジェクトルート)
- フロントエンド(UI)実装ルール → `src/routes/CLAUDE.md`
- バックエンド(サービス層)実装ルール → `src/lib/server/CLAUDE.md`
- インフラ(AWS/CDK)ルール → `infra/CLAUDE.md`
- テスト(E2E/Unit)ルール → `tests/CLAUDE.md`
- GitHub/CI/Issue運用ルール → `.github/CLAUDE.md`
- ドキュメント運用ルール・ADR → `docs/CLAUDE.md`
- ドメイン知識・業務ルール → `docs/reference/*.md`

## Key Directories

- `src/routes/` - フロントエンド・UIコンポーネント連携
- `src/lib/server/` - サーバーサイドロジック・データベース
- `infra/` - AWS CDKインフラストラクチャ
- `docs/` - 各種設計ドキュメントとアーキテクチャレコード (ADR)
- `tests/` - E2E (Playwright) と Unit (Vitest) テスト

## Global Coding Guidelines

- **TypeScript strict 必須**: 新規コードは全て型を付与してください。
- **Svelte 5**: 状態管理は `$state` / `$derived` / `$effect` を基本とします。Svelte 4 の `$:` 構文は禁止です。
- **アーキテクチャ境界の遵守**:
  - `src/routes` にビジネスロジックを直書きしないこと。
  - フロントエンドでの直接的な fetch や、DB への直接アクセスは避け、必ず `$lib/server/services` を経由すること。

## Build & Test

- `npm run dev` / `npm run dev:cognito` (認証が必要な場合)
- `npm run build`
- `npx biome check .`
- `npx vitest run` / `npx playwright test` / `npm run test:storybook`

### Ready 化前チェック（必須）

PRの提出前には `npm run pre-ready -- --pr <num>` を実行し、全10ステップの自動検証をパスさせる必要があります。
(biome format, svelte-check, vitest, hardcoded strings check, lp-dimensions, labels check などが含まれます)

## Things Not To Do (Global)

- `.env` / `node_modules/` / `*.db` のコミット禁止。
- 成果物のないままタスクを `[x]` (Done) にすることの禁止。
- Pre-PMFフェーズにおける過剰な防衛設計（汎用監査ログ、WAF等の早すぎる導入）は避けること (ADR-0010)。
- 破壊的操作 (`git push --force`, 本番デプロイ, DBスキーマ変更, `rm -rf`) は必ずユーザーに確認を求めること。

## Session Agents & Skills

セッション起動時 `.claude/agents/` がロール自動活性化:
- `po-session.md` — PO（Issue 起票・優先度・事業判断）
- `dev-session.md` — Dev（実装・CI/CD・設計書同期）
- `qa-session.md` — QA（PR レビュー・品質ゲート）
タスク固有: `.claude/skills/` (オンデマンド発火)

## Compaction Rules

コンパクション時は「変更ファイル一覧 / 実行テストコマンドと結果 / 作業中チケット番号」を要約に必ず残してください。
