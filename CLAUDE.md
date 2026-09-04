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
- `+server.ts` から ORM 直呼び禁止。`$lib/server/services` 経由（**機械強制**: `tests/unit/architecture/route-db-boundary.test.ts` が全 server route の禁止 import を fitness function で検出、#3152 Phase 2 / ADR-0061）
- API エラーは `@sveltejs/kit` の `error`, `json` で一貫レスポンス

## Build & Test

`npm run dev` / `dev:cognito` (#1026, 認証画面) / `build` / `biome check .` / `drizzle-kit push` / `vitest run` / `playwright test` / `test:storybook` / `test:e2e:matrix` (ADR-0040 mode×plan matrix 4 project, port 5201-5204, 重量レーン CI 組込 #2874)

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

`npm run pre-ready -- --pr <num>` 一括実行 (ADR-0030 / #1775 / #4121)。**全 6 step** を順次実行し各 fail で即停止 + 修正方針表示。**step 一覧の SSOT は `npm run pre-ready -- --help`**:

1. biome check / 2. svelte-check / 7. check-no-plan-literals (#972) / 7g. check-local-tz-date-getters (#4015 / #4127, TZ 依存の日付導出禁止 / JST SSOT 強制) / 9. Readiness gate = check-pr-body (PR 番号必須) / 11b. SS embed gate (#2918, UI 変更 PR の SS 未 embed hard-fail)

**選定基準は ADR-0007 §1-2 判断原則 v2** (#4121): 類型 1 (証跡の真正性 = Step 9 / 11b) と 類型 2 (顧客に見える正しさ = Step 1 / 2 / 7 / 7g) のうち安価なものだけを残す。**pre-ready の 6 step は CI が hard-fail させる検査のごく一部でしかない**。`gh pr checks <num>` で CI 側が pass (skipped でない) ことを確認してから Ready 化する。

#### CI `ci.yml` で hard-fail する検査（実測 SSOT、#4605）

以下 2 ブロックは `.github/workflows/ci.yml` の実測（`continue-on-error: true` も `|| true` も付かない step）であり、`tests/unit/docs/ci-hard-fail-check-list-ssot.test.ts` が ci.yml と突合する（列挙漏れ / 陳腐化 / 理由なし除外 / job 新設漏れで CI fail）。**手で足さない — ci.yml を変えたら test の指示どおり本ブロックを直す。**

`lint-and-test` job の hard-fail step（ローカルで個別に回すときのコマンドがそのまま key）:

<!-- ci-hard-fail-steps:start -->
- `npx biome check --error-on-warnings .` — Biome (pre-ready Step 1 と同一)
- `npm run lint:parallel` — 並行実装 SSOT (generate-lp-labels --check / sync-lp-fallback --check / LP innerHTML / @html)
- `node scripts/check-no-plan-literals.mjs` — プラン文字列直書き (pre-ready Step 7)
- `node scripts/check-cli-entry-guard.mjs` — CLI entry 判定の方言禁止
- `node scripts/check-workflow-sparse-checkout-closure.mjs` — sparse-checkout 列挙の閉包
- `node scripts/check-readdir-rotation-guard.mjs` — 緩い一致で世代を数える class の禁止
- `node scripts/check-repo-scan-test-declaration.mjs` — repo 走査 test の区分宣言
- `node scripts/check-local-tz-date-getters.mjs` — TZ 依存の日付導出禁止 (pre-ready Step 7g)
- `node scripts/check-license-key-leak.mjs --budget-ms 120000` — license key 再導入禁止
- `node scripts/check-no-direct-env-access.mjs` — `process.env` 直参照禁止
- `node scripts/check-no-waitfortimeout.mjs` — `scripts/` の `waitForTimeout` 禁止
- `node --test "scripts/__tests__/**/*.test.mjs"` — scripts の node:test 全件
- `npm run check:no-demo-route-dup` — demo route 二重実装禁止
- `npm run cspell` — スペルチェック (warning=error)
- `npx stylelint "src/**/*.css"` — CSS hex 直書き
- `npx eslint "tests/**/*.ts"` — ESLint Playwright (no-networkidle / no-wait-for-timeout)
- `npm run lint:typed` — ESLint type-aware (no-floating-promises / no-misused-promises、CI 限定)
- `npm run lint:svelte` — **ESLint Svelte** (recommended + XSS AST。`eslint-suppressions.json` で baseline 凍結 + ratchet = 新規違反のみ fail)
- `npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json --threshold warning` — **pre-ready Step 2 より厳しい**（CI は warning も fail）
- `cd infra && npx tsc --noEmit` — CDK 型検査
- `npm run type-coverage` — 型カバレッジ ratchet
- `npm run build` — 本体ビルド
- `npm run build-storybook -- --quiet` — Storybook ビルド (`stories` filter が true のときのみ。stories / `.storybook/**` / `src/lib/{ui,features}/**` に加え、コンパイル結果を変えうる `package.json` / `package-lock.json` / `svelte.config.js` / `vite.config.ts` / `tsconfig.json` / `src/app.html` も含む = #4859)
<!-- ci-hard-fail-steps:end -->

`ci.yml` のその他 hard-fail job（`lint-and-test` 以外。中身の step までは列挙しない）:

<!-- ci-hard-fail-jobs:start -->
- `marketplace-registry-integrity-check` / `deps-supply-chain-check` / `dependency-cruiser` / `cdk-cfn-lint`
- `unit-test` (vitest 2 shard) / `unit-test-merge` (coverage 閾値 ratchet + test anti-pattern)
- `storybook-test` / `e2e-test` / `e2e-matrix` / `e2e-cognito-dev` / `e2e-demo-lambda` / `a11y`
- `docker-build`
- `new-env-distribution-check` / `schema-change-tests-check` / `schema-migration-completeness-check`
- `main-pr-base-guard`
<!-- ci-hard-fail-jobs:end -->

**本ブロックが保証するのは `ci.yml` の範囲だけ**。他の workflow（`lp-metrics.yml` の LP 寸法・禁止語、visual regression 3 層、`pr-template-gate.yml` 等の PR body 系 gate）は突合対象外なので、`gh pr checks <num>` で個別に見る（`ci-gate` は skipped を failure に数えないため ci-gate green を根拠にしない）。

**Step 番号は表示上の識別子であり実行順ではない (#4048)**。実行は cheap-fail-first — PR body だけを見る検査 (Step 9) → 静的テキスト検査 (1 / 7 / 7g) → 型検査 (2) → SS 系 (11b) の順。

**pre-ready の PASS は「CI 緑」ではない (#4390)**。6 step は worktree HEAD だけを入力にするため、負荷 / タイミング依存の失敗・CI 側 job・**Draft 中しか走らない検査** (`pr-template-gate` は `draft == false` で初めて走る) は原理的に見ていない。加えて step の前に **base 鮮度 preflight** が走り、base が進み、かつ進んだ差分に **pre-ready の検査基準** (`PULL_REQUEST_TEMPLATE.md` / `PR_TEMPLATE_SECTIONS.json` / 検査 script と**その import 閉包**) が含まれる場合は **BLOCK する** (手元は旧基準・CI は新基準で判定するため、その PASS は成立しない)。検査基準が動いていなければ注記のみで止めない。

E2E / Storybook は別途 (`npx playwright test` / `npm run test:storybook`)。任意: `npx eslint "src/**/*.ts"` (#977) / `npm run type-coverage` / `npm run knip` (#970)。CI 自動拒否は `.github/workflows/ci.yml` 参照。

## 並行実装チェックリスト（修正前必須）

修正前に `docs/design/parallel-implementations.md` を確認:

- UI ラベル・用語 → `src/lib/domain/labels.ts` + `site/index.html` + `site/pamphlet.html` + `site/shared-labels.js` + `PAGE_GUIDE_LABELS` / `getChildTutorialLabels`
- 年齢モード → `src/routes/(child)/[uiMode=uiMode]/` + `src/lib/domain/validation/age-tier.ts`
- 本番画面 → デモ Lambda (#2097 PR-B3 で `src/routes/demo/**` 全削除、本番ルートを `AUTH_MODE=anonymous` + `DATA_SOURCE=demo` で起動)
- ナビ → 面を固定数で数えない。`AdminLayout` に管理画面の Desktop ドロップダウンと Mobile ボトムナビが同居（`AdminMobileNav` は存在しない）。他に `BottomNav`（子供）/ 設定サブナビ / 運営者ナビ / ページ内タブ。`grep -rn "<nav\b" src/` で変更が及ぶ面を確認する
- DB スキーマ → `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts`
- チュートリアル → `**/_guide.ts` + `PAGE_GUIDE_LABELS` (❓ ページガイド) + `tutorial-chapters-child.ts` (子供) + `demo-guide-state.svelte.ts` (デモ)

## Things Not To Do

CI 自動拒否される違反は該当 ADR / script に集約: hex 直書き / プリミティブ再実装 / インラインスタイル (@docs/DESIGN.md §9) / プラン文字列直書き (`check-no-plan-literals.mjs` #972) / カバレッジ閾値引下げ (`check-coverage-threshold.js`) / assertion 弱体化 (ADR-0006) / 新規 env 配布証跡欠落 (`check-new-required-env.mjs`) / LP 禁止語 (`measure-lp-dimensions.mjs` #1312/#1313)

**機械強制が無くレビューで担保するもの**: UI 文言の SSOT 逸脱 (`terms.ts` / `labels.ts` を経由しない日本語直書き、@docs/DESIGN.md §6 / ADR-0045)。プラン文字列だけは `check-no-plan-literals.mjs` が拾うが、それ以外の日本語直書きを検出する CI は無い。**ルールは生きているので、CI が緑でもレビューで見る。**

その他禁忌:
- `src/routes` ページにビジネスロジック直書き / DB 直接アクセス（必ず `$lib/server/db` 経由）
- `.env` / `node_modules/` / `*.db` コミット / 成果物のない `[x]` Done / `docs/tickets/` 新規ファイル
- `+page.server.ts` の旧 URL `redirect()` 直書き → @src/routes/CLAUDE.md
- E2E で `clearDialogGhosts` 新規使用（ダイアログバグ隠蔽）
- Pre-PMF 過剰防衛設計 (汎用監査ログ / S3+Athena / WAF 等) → ADR-0010
- 認証画面を `npm run dev` だけで Ready 化 → `npm run dev:cognito` (#1026)
- SS を CI 通過のためだけに添付 → UI/UX 自己判定証跡 (@docs/DESIGN.md §9)
- jscpd を PR hard-fail 昇格 (#971) / OSS 未調査で 10 行超独自実装 (`docs/decisions/README.md` §OSS 先調査ルール / #1350)
- LP / pricing に未実装機能を「実装済み」と記載 → ADR-0013
- `scripts/` に使い捨てスクリプト追加 → `npm run capture` 等 generic ツール拡充 (#1442)

## Critical バグ修正（ADR-0002）

`priority:critical` は ADR-0002 の 5 要件全て充足必須（E2E 回帰 / AC 全完了 / 提案全実装 / 5 年齢モード検証 / 直近 30 日重複変更チェック）。

## Session Agents & Skills

セッション起動時 `.claude/agents/` がロール自動活性化:
- `po-session.md` — PO（Issue 起票・優先度・事業判断、ロール定義は @docs/sessions/po-session.md）
- `dev-session.md` — Dev（実装・CI/CD・設計書同期、@docs/sessions/dev-session.md）
- `qm-session.md` — QM（PR レビュー・品質ゲート、@docs/sessions/qm-session.md）

タスク固有: `.claude/skills/` (オンデマンド発火)

**Agent Teams**: 各ロールが**自分のクローン内で**組む (PO チームの team / Dev チームの team、と別々に構築する)。**ロールを跨いだ team は組まない** — teammate は lead の作業ディレクトリ・gh 認証で動くため ADR-0022 の作成者 ≠ 承認者が空洞化する。**重い検証の並列化には使えない** (`heavy` lock はマシン全体で 1 本)。

**振り方 (2026-08-01 初回実運用、全ロール共通)**: ① **成果物がファイルに残る仕事を振る** — teammate の報告テキストは届かないことがある (read-only の調査でも出力先ファイルを指定する) / ② **完了は lead が `git diff` で自分で確認する** (通知を待たない) / ③ **teammate の出力は実物と突き合わせる** — teammate は数値・Issue 番号を推測で埋める / ④ **空振り 2 回で引き取る**。

使ってよい / いけない場面 + 振り方の SSOT → `docs/sessions/agent-teams.md`（**teammate を spawn する前に Read する**。常時ロードしない、#4210）

## Further Context

- @docs/DESIGN.md（デザイン SSOT、必読）
- 画像アセットを**作る / 追加するときだけ** Read する（常時ロードしない、#4210）: `docs/reference/gemini_image_generation_guide.md` / `docs/design/asset-catalog.md`
- @personal/data/family.yml (サブモジュール)

## Compaction Rules

コンパクション時は「変更ファイル一覧 / 実行テストコマンドと結果 / 作業中チケット番号」を要約に必ず残す。

## Auto Mode ガイドライン

以下は必ず確認を求める: `git push --force` / 本番デプロイ / DB スキーマ変更 / `.env` / `rm -rf` 等の破壊的操作。
