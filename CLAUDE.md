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
- `docs/decisions/` - ADR（Architecture Decision Records）

## Coding Guidelines

- 型は必須。新規コードはすべて TypeScript strict で型付き。
- データ取得は `+page.ts` / `+layout.ts` の `load` を使用。コンポーネント内の直接 fetch 禁止。
- 状態管理は `$state` / `$derived` / `$effect` を基本。stores は最小限。
- UI は `$lib/ui/primitives`（Ark UI ラッパ）と `$lib/ui/components` からのみ利用。
- `+server.ts` から直接 ORM クライアントを呼び出さない。必ず `$lib/server/services` 経由。
- API エラーは `@sveltejs/kit` の `error`, `json` で一貫したレスポンスを返す。

## Build & Test

- 開発: `npm run dev`
- ビルド: `npm run build`
- テスト: `npx vitest run`
- E2E: `npx playwright test`
- Lint: `npx biome check .`
- スペルチェック: `npm run cspell`（任意。CI では warn-only）
- DB マイグレーション: `npx drizzle-kit push`

### 開発中のプラン切替（#758、dev only）

`npm run dev` 実行時に `.env.local`（またはシェル env）で以下を設定すると、
`locals.context.plan` / `licenseStatus` / トライアル状態を上書きできる。
**本番ビルドでは無効**（`dev === false` でガード）。

- `DEBUG_PLAN=free|standard|family` — プランを直接指定
- `DEBUG_TRIAL=active|expired|not-started` — トライアル状態を上書き
- `DEBUG_TRIAL_TIER=standard|family` — `DEBUG_TRIAL=active` 時のティア

admin 画面右下に「DEBUG: plan=family」等のインジケータが表示される。
詳細は `.env.example` および `src/lib/server/debug-plan.ts` を参照。

### コミット前チェック（必須）

1. `npx biome check .` — lint エラーなし
2. `npx svelte-check` — 型エラーなし
3. `npx vitest run` — ユニットテスト全通過
4. `npx playwright test` — E2Eテスト全通過
5. 新ルール warn（noExcessiveCognitiveComplexity / noConsole / useMaxParams / noBarrelFile）は PR で 0 件増えないこと

### コミット前チェック（任意・推奨）

- `npx eslint "src/**/*.ts"` — SonarJS ルール（文字列重複・認知複雑度等）の検出（#977）
- `npm run type-coverage` — 型カバレッジが閾値以上（CI では必須、ローカルはメモリ消費大のため任意）
- `npm run knip` — 未使用 export / ファイル / 依存の検出（#970）

## CI 自動検出（CLAUDE.md に詳細説明不要 — CI が自動拒否）

biome（noExplicitAny, 未使用import）, svelte-check（TS strict）, stylelint（hex color）,
vitest --coverage（カバレッジ閾値）, playwright（E2E）, ESLint（svelte/no-inline-styles, インラインスタイル検出）。
詳細: `.github/workflows/ci.yml`

## 並行実装チェックリスト（修正前必須）

本プロジェクトは 8 カテゴリ以上の並行実装ペアを抱えている（同期漏れが頻発）。
修正前に必ず `docs/design/parallel-implementations.md` を参照し、以下のチェックを行うこと:

- [ ] **UI ラベル・用語** → `src/lib/domain/labels.ts` + `site/index.html` + `site/pamphlet.html` + `site/shared-labels.js` + `tutorial-chapters.ts`
- [ ] **年齢モード** → `src/routes/(child)/[uiMode=uiMode]/` 統合済み。年齢別バリアント設定は `src/lib/domain/validation/age-tier.ts`
- [ ] **本番画面 → デモ画面** も同等変更 (`src/routes/demo/`)
- [ ] **アプリ機能 → LP** の文言 (`site/`) も同期
- [ ] **ナビゲーション** → デスクトップ (`AdminLayout`) + モバイル (`AdminMobileNav`) + ボトムナビ (`BottomNav`)
- [ ] **DB スキーマ** → `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts`
- [ ] **チュートリアル** → 本番 + デモガイド両方 (`tutorial-chapters.ts` + `demo-guide-state.svelte.ts`)

## Things Not To Do

- `src/routes` 配下のページコンポーネントにビジネスロジックを書かない
- DB への直接アクセスは禁止。必ず `$lib/server/db` 経由
- `.env` ファイル、`node_modules/`、`*.db` ファイルをコミットしない
- 古い Svelte 4 / SvelteKit 1 の書き方（`$:` リアクティブ宣言等）を使わない
- チケットのゴールを実態なく完了（`[x]`）にしない。成果物が存在しないものを Done にしない
- `docs/tickets/` にチケットファイルを新規作成しない（GitHub Issues で管理）
- UI デザイン禁忌事項は `docs/DESIGN.md` §9 参照（hex直書き禁止、プリミティブ再実装禁止、インラインスタイル禁止 等）
- URL をリネーム・廃止した際に、個別の `+page.server.ts` や `+page.ts` に `redirect()` を書かない → `src/routes/CLAUDE.md` の旧 URL 廃止ルール参照
- `vite.config.ts` のカバレッジ閾値（thresholds）を引き下げない → CI が自動拒否（`scripts/check-coverage-threshold.js`）
- E2E テストで `clearDialogGhosts` を新規使用しない → アプリ側のダイアログバグを隠蔽するため
- `assert*Configured()` / `throw new Error('XXX is required')` / `process.env.X || (() => { throw ... })()` を新規追加するときに、PR 本文へ「配布済み: ENV」証跡を書かない → CI の `new-env-distribution-check` が red になる（ADR-0029、`scripts/check-new-required-env.mjs`）
- ADR-0029 禁止 5 項目（warn 化 / NODE_ENV skip / `ALLOW_*=true` / retry 延長 / `.skip` 追加）を行わない → 例外手続きは別 ADR で当該 ADR を supersede すること
- ライセンスプラン / 購読ステータス / ライセンスキー状態の値を文字列リテラルで直書きしない（#972）→ `$lib/domain/constants/{license-plan,subscription-status,license-key-status,auth-license-status}.ts` の定数経由で参照すること。`'family-monthly'` / `'family-yearly'` / `'grace_period'` は CI (`scripts/check-no-plan-literals.mjs`) が自動拒否
- Pre-PMF で過剰防衛設計（汎用監査ログ DynamoDB テーブル / S3+Athena / AWS WAF / IP 単位ブルートフォース検知 等）を新規追加しない（ADR-0034）→ HMAC 鍵強度 + API Gateway スロットリング + AWS Budgets + 既存 state カラムで Pre-PMF 段階は十分。採用するには ADR-0034 を supersede する新 ADR を先に起票すること
- **認証が絡む UI 画面** (login / signup / 管理画面 / ops / プラン別 UI) を `npm run dev` の自動認証モードだけで検証した状態で PR を Ready にしない（#1026）→ `npm run dev` は `/auth/login` を 302 redirect するためログインフォームが描画されず UI 検証ができない。必ず `npm run dev:cognito` で Cognito モックモード (port 5174) を起動し、`DEV_USERS` の該当アカウントでログインした上で `docs/DESIGN.md` §9 禁忌事項のセルフチェックを行うこと
- **スクリーンショットは CI を通すためではなく UI/UX デザイナー視点の自己判定証跡**として貼る（#1026）→ PR 本文に `![...](...)` さえあれば screenshot-check は通るが、それは目的ではない。撮った画像を自分で見て違和感があれば修正すること。PR template の「スクリーンショット / ビジュアルデモ」セクション冒頭の目的説明に従うこと
- jscpd を PR の hard-fail に昇格させない（別 ADR なしには）（#971）→ jscpd は週次レポートとして T3 階層で運用。PR ゲートに含めると開発体験が悪化する

## Critical バグ修正の必須要件（ADR-0005）

`priority:critical` のバグ修正は以下を全て満たすこと（詳細は ADR-0005 参照）:

1. 回帰テスト（E2E）を同一 PR 内で追加
2. Issue の Acceptance Criteria を全項目完了（部分実装で closes 禁止）
3. Issue で提案された対策を全て実装（部分実装は対症療法であり根本解決ではない）
4. 全 5 年齢モード（baby/kinder/lower/upper/teen）で実機検証 + スクリーンショット
5. 直近30日に同じファイルを変更した PR がないかチェック（リネーム/リファクタリングとの依存関係確認）

## 機能実装時の必須チェック

- 設計書の更新を忘れていないか → `docs/CLAUDE.md` の更新ルール表を確認
- テストを同梱しているか → `tests/CLAUDE.md` のテスト要件を確認
- UI 変更時のデザインシステム準拠 → `src/routes/CLAUDE.md` を確認

## Context-specific Rules（フォルダ作業時に自動ロード）

| ファイル | 内容 |
|---------|------|
| `src/routes/CLAUDE.md` | UI実装ルール、デザインシステム、用語管理、チュートリアル、Done基準 |
| `tests/CLAUDE.md` | テスト品質ルール（ADR-0020）、E2E固有ガイダンス |
| `docs/CLAUDE.md` | 設計書更新ルール、ADR管理・一覧、画像アセットルール |
| `.github/CLAUDE.md` | チケット管理、Draft PR運用、Issue起票ルール（ADR-0018） |
| `infra/CLAUDE.md` | AWS Lambda / NUC デプロイ手順 |

## Further Context

- **デザインシステム SSOT**: @docs/DESIGN.md ← デザイン関連の実装は**まずこのファイルを読む**
- UI フレームワーク設計: @docs/reference/ui_framwork.md
- バックエンド設計: @docs/reference/backend_framework.md
- Gemini API 画像生成ガイド: @docs/reference/gemini_image_generation_guide.md
- 画像アセット仕様: @docs/design/asset-catalog.md
- 家族情報（サブモジュール）: @personal/data/family.yml

## Compaction Rules

- コンパクション時は「変更ファイル一覧」「実行したテストコマンドと結果」「現在作業中のチケット番号」を必ず要約に残す。

## Auto Mode ガイドライン

Auto mode 使用時でも以下は必ず確認を求めること:

- `git push` / `git push --force` など本番リポジトリへの反映
- 本番サーバーへのデプロイ（ssh 経由の操作）
- DB のスキーマ変更（`drizzle-kit push`）やデータ削除
- `.env` や認証情報に関わるファイルの変更
- `rm -rf` 等の破壊的なファイル操作

