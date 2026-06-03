# Project Context

がんばりクエスト - 子供の活動をゲーミフィケーションで動機付けする家庭内専用Webアプリ。
SvelteKit 2 + Svelte 5 (Runes) + Ark UI Svelte + SQLite + Drizzle ORM。TypeScript strict。

**SSOT**: デザイン → @docs/DESIGN.md / 設計書 → @docs/CLAUDE.md / ADR 一覧 → @docs/decisions/README.md / **コードベース全体俯瞰 → @docs/codebase-map.md (#2185)**

## Key Directories

- `src/routes/` - ファイルベースルーティング / `src/lib/ui/` - UI コンポーネント / `src/lib/features/` - 機能ロジック
- `src/lib/domain/` - ドメイン / `src/lib/server/` - DB・サービス層
- `docs/design/` - 設計ドキュメント / `docs/decisions/` - ADR / `docs/sessions/` - PO/Dev/QA ロール定義

**全体マップ**: トップレベル / 主要サブディレクトリの役割俯瞰は @docs/codebase-map.md に集約。新規 dir 追加 / 大規模再編時は同ファイルも更新。

## Coding Guidelines

- TypeScript strict 必須。新規コードは全て型付き
- データ取得は `+page.ts` / `+layout.ts` の `load`。コンポーネント内 fetch 禁止
- 状態管理は `$state` / `$derived` / `$effect` 基本。stores は最小限。Svelte 4 / SvelteKit 1 構文 (`$:` 等) 禁止
- UI は `$lib/ui/primitives` (Ark UI ラッパ) と `$lib/ui/components` のみ
- `+server.ts` から ORM 直呼び禁止。`$lib/server/services` 経由
- API エラーは `@sveltejs/kit` の `error`, `json` で一貫レスポンス

## Build & Test

`npm run dev` / `dev:cognito` (#1026, 認証画面) / `build` / `biome check .` / `drizzle-kit push` / `vitest run` / `playwright test` / `test:storybook` / `test:e2e:matrix` (port 5201-5205, CI 未組込)

### 開発プラン切替 (#758、dev only)

`.env.local` で `DEBUG_PLAN` / `DEBUG_TRIAL` / `DEBUG_TRIAL_TIER` 上書き（本番ビルド無効）。詳細: `.env.example` / `src/lib/server/debug-plan.ts`（`DEBUG_LICENSE_KEY_VALID` は #2813 で license key 全廃に伴い撤廃済）

### サブディレクトリ別局所テストコマンド (#2184)

全体実行 (`npm run test` / `npm run pre-ready`) を待たず、局所変更を高速検証可能。詳細表は `docs/CLAUDE.md` §「サブディレクトリ別局所テストコマンド SSOT」。代表例:

```bash
npx vitest run src/routes/                                      # routes 配下 unit test
npx vitest run src/lib/server/services/                         # service 層 unit test
npx vitest run src/lib/domain/                                  # domain 層 unit test
npx playwright test tests/e2e/<spec>.spec.ts                    # E2E 個別 spec
cd infra && npx vitest run                                      # CDK 単体テスト
```

Ready 化前は依然として `npm run pre-ready -- --pr <num>` 全 step PASS が必須。

### Ready 化前チェック（必須）

`npm run pre-ready -- --pr <num>` 一括実行 (ADR-0030 / #1775 / #1920 で SSOT 検証 step 拡張)。10 step を順次実行し各 fail で即停止 + 修正方針表示:

1. biome check / 2. svelte-check / 3. vitest run / 4. check-hardcoded-strings (#1452) / 5. measure-lp-dimensions (#1163, LP 変更時のみ) / 6. sync-lp-fallback --check (#1945, LP / labels.ts 変更時のみ) / **7. check-no-plan-literals (#972 / Phase 5 F1)** / **8. generate-lp-labels --check (Phase 1 B1 / #1917, labels.ts / terms.ts / age-tier.ts 変更時のみ)** / 9. check-pr-body (PR 番号必須) / 10. capture (UI 変更時のみガイダンス)

E2E / Storybook は別途 (`npx playwright test` / `npm run test:storybook`)。任意: `npx eslint "src/**/*.ts"` (#977) / `npm run type-coverage` / `npm run knip` (#970)。CI 自動拒否は `.github/workflows/ci.yml` 参照。

## 並行実装チェックリスト（修正前必須）

修正前に `docs/design/parallel-implementations.md` を確認:

- UI ラベル・用語 → `src/lib/domain/labels.ts` + `site/index.html` + `site/pamphlet.html` + `site/shared-labels.js` + `tutorial-chapters.ts`
- 年齢モード → `src/routes/(child)/[uiMode=uiMode]/` + `src/lib/domain/validation/age-tier.ts`
- 本番画面 → デモ Lambda (#2097 PR-B3 で `src/routes/demo/**` 全削除、本番ルートを `AUTH_MODE=anonymous` + `DATA_SOURCE=demo` で起動)
- ナビ → `AdminLayout` + `AdminMobileNav` + `BottomNav`
- DB スキーマ → `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts`
- チュートリアル → `tutorial-chapters.ts` + `demo-guide-state.svelte.ts`

## Things Not To Do

CI 自動拒否される違反は該当 ADR / script に集約: hex 直書き / プリミティブ再実装 / インラインスタイル (@docs/DESIGN.md §9) / プラン文字列直書き (`check-no-plan-literals.mjs` #972) / カバレッジ閾値引下げ (`check-coverage-threshold.js`) / assertion 弱体化 (ADR-0006) / 新規 env 配布証跡欠落 (`check-new-required-env.mjs`) / LP 禁止語 (`measure-lp-dimensions.mjs` #1312/#1313) / hardcoded JP text 増加 (`check-hardcoded-strings.mjs` #1452)

その他禁忌:
- `src/routes` ページにビジネスロジック直書き / DB 直接アクセス（必ず `$lib/server/db` 経由）
- `.env` / `node_modules/` / `*.db` コミット / 成果物のない `[x]` Done / `docs/tickets/` 新規ファイル
- `+page.server.ts` の旧 URL `redirect()` 直書き → @src/routes/CLAUDE.md
- E2E で `clearDialogGhosts` 新規使用（ダイアログバグ隠蔽）
- Pre-PMF 過剰防衛設計 (汎用監査ログ / S3+Athena / WAF 等) → ADR-0010
- 認証画面を `npm run dev` だけで Ready 化 → `npm run dev:cognito` (#1026)
- SS を CI 通過のためだけに添付 → UI/UX 自己判定証跡 (@docs/DESIGN.md §9)
- jscpd を PR hard-fail 昇格 (#971) / OSS 未調査で 10 行超独自実装 (ADR-0014 / #1350)
- LP / pricing に未実装機能を「実装済み」と記載 → ADR-0013
- `scripts/` に使い捨てスクリプト追加 → `npm run capture` 等 generic ツール拡充 (#1442)

## Critical バグ修正（ADR-0002）

`priority:critical` は ADR-0002 の 5 要件全て充足必須（E2E 回帰 / AC 全完了 / 提案全実装 / 5 年齢モード検証 / 直近 30 日重複変更チェック）。

## 補佐設計品質ガード 6（#2373 / AN-5 #2180 補強 6）

補佐 (Claude / AI Agent) が Issue 起票時に守る 2 つの MUST-DO。詳細 SSOT → `docs/sessions/po-session.md` §「補佐設計品質ガード 6」+ `.claude/skills/issue-triage/SKILL.md` §「手順 F」:

1. **同領域 EPIC 既起票確認**: 新規 EPIC 起票前に `gh issue list --search "<keyword>" --state all` で過去 6 ヶ月の同領域 Issue を確認、「関連 Issue」セクションに列挙
2. **抽象パターン MUST-DO**: 3 つ目の類似 service / component を起票する前、Strategy / Factory / Registry 適用判断を PO に必須確認

監視: `node scripts/check-import-service-duplication.mjs`（150 行超の `*-import-service.ts` を列挙、warning のみ）。

## Session Agents & Skills

セッション起動時 `.claude/agents/` がロール自動活性化:
- `po-session.md` — PO（Issue 起票・優先度・事業判断、ロール定義は @docs/sessions/po-session.md）
- `dev-session.md` — Dev（実装・CI/CD・設計書同期、@docs/sessions/dev-session.md）
- `qa-session.md` — QA（PR レビュー・品質ゲート、@docs/sessions/qa-session.md）

タスク固有: `.claude/skills/` (11 Skills、オンデマンド発火)

## Further Context

- @docs/DESIGN.md（デザイン SSOT、必読）/ @docs/reference/ui_framwork.md / @docs/reference/backend_framework.md
- @docs/reference/gemini_image_generation_guide.md / @docs/design/asset-catalog.md
- @personal/data/family.yml (サブモジュール)

## Compaction Rules

コンパクション時は「変更ファイル一覧 / 実行テストコマンドと結果 / 作業中チケット番号」を要約に必ず残す。

## Auto Mode ガイドライン

以下は必ず確認を求める: `git push --force` / 本番デプロイ / DB スキーマ変更 / `.env` / `rm -rf` 等の破壊的操作。
