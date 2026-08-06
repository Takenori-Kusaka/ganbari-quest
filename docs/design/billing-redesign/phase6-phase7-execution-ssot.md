# Phase 7 統合 PR 実行手順 SSOT — Stripe webhook 5 phase migration 整合 (Epic #2525 Phase 6 子 1、#2683 補強)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2661 (Phase 6 グループ A 最優先) / #2683 (補強 — 2 Product 構成 + API ver 訂正 + 副次制約 4 反映) |
| 親 | Phase 6 親 (Phase 5 → Phase 7 橋渡し SSOT) / Epic #2525 |
| 上位 (Phase 5) | #2639 (子 1 Stripe Product / Price、**#2683 で 2 Product 各 1 Price 代替案 D に変更**) / #2640 (子 2 proration、**#2683 でダウン即時 + Stripe credit memo パターンに変更**) / #2641 (子 3 webhook 冪等性) / #2642 (子 4 archive 統合) / #2643 (子 5 atom / compound 配置) |
| 連動 (Phase 7) | #2531 (実装 PR 群) / #2627 (Stripe Dashboard PO 手動操作) |
| ステータス | 設計確定 (本 PR で確定、コード変更なし) / **2026-05-30 補強 #2683: 2 Product 各 1 Price 反映 + API version 維持判断 (`2026-04-22.dahlia`) + 副次制約 4 Webhook immutable を 5 phase migration 根拠として明文化** / **2026-06-03 補強 #2788 (license key 完全全廃): 既存 5 step の前に Step 0 (PR-L0〜L5、license key 全廃) を前置。PR-L3 admin/license 削除を Step 2-3 rename と統合 (§3 Step 0)** |
| 起点 | Phase 5 全 5 子の確定事項 (2 Product 各 1 Price + proration + webhook 冪等性 + 共通 archive + atom SSOT) を Phase 7 統合 PR の実行手順に落とし込み、cutover 失敗 / migration 順序事故 / kill switch 不在を構造的に防止 |

> **位置づけ**: Phase 6 グループ A の最優先成果物。Phase 5 で確定したアーキ層 5 子 + Phase 7 子 #2627 (Stripe Dashboard PO 手動操作) を「**Phase 7 統合 PR 5 step × 各 step AC + ロールバックポイント + 実 file path**」「**Stripe Dashboard #2627 7 領域 (A-G) 同期 timeline**」「**Stripe webhook migration 5 phase (setup→shadow→cutover→retire) の自プロダクト転用**」の 3 観点で統合 SSOT 化する。Phase 7 実装者は本 docs を参照するだけで cutover 順序を一意に決定できる状態を確立する。

## 1. 設計背景 (§1)

### 1.1 課題: Phase 5 全 5 子は確定したが、Phase 7 実装順序が docs 化されていない

Phase 5 で確定した 5 子のアーキ:

| 子 | docs SSOT | 確定事項 (#2683 補強後) |
|---|---|---|
| #2639 | [phase5-stripe-product-architecture](phase5-stripe-product-architecture.md) | **2 Product 各 1 Price + lookup_key** (#2683 代替案 D) + apiVersion **`'2026-04-22.dahlia'` 維持** (#2683 訂正) + Webhook 5 event 購読 (`subscription_schedule.*` 3 種は #2683 で scope 外) + **副次制約 4 件** (#2683 で Webhook destination immutable を追加) |
| #2640 | [phase5-proration-architecture](phase5-proration-architecture.md) | アップ即時 (`always_invoice`) / **ダウン即時 + Stripe credit memo** (#2683 訂正、`subscription_schedules` API 不使用) / Preview API |
| #2641 | [phase5-webhook-idempotency-architecture](phase5-webhook-idempotency-architecture.md) | `stripe_webhook_events` dedup table + 4 backend / 30 日 retention / dispatcher 入口 dedup |
| #2642 | [phase5-archive-unified-architecture](phase5-archive-unified-architecture.md) | `archived_reason` enum (3 値: `trial_expired` / `downgrade_user_selected` / `dunning_canceled`) + 4 backend |
| #2643 | [phase5-atom-ssot-architecture](phase5-atom-ssot-architecture.md) | terms.ts 3 atom + labels.ts 5 compound 配置 + atom 統合 5 step PR 計画 (#2683 で `cancelPendingRedirect` atom 不要化、subscription_schedule 不使用のため) |

しかし**「Phase 7 統合 PR をどの順序でマージするか」「DB migration / atom rename / Stripe Dashboard 同期がどの timeline で動くか」が docs 横断で散在**し、Phase 7 実装者の自由裁量に委ねられる。並列 PR 衝突 / cutover 順序事故 / kill switch 不在のリスクを抱えたまま実装段階に入る。

### 1.2 課題: Stripe Dashboard #2627 (PO 手動操作) との同期タイミングが暗黙的

Phase 7 統合 PR は Stripe Dashboard 側の 7 領域 (Product / Price / Webhook / Customer Portal / Tax / Test clock / Production cutover) と物理的に同期する必要がある。**コード PR マージ vs Stripe Dashboard 反映** のどちらが先かを誤ると以下が発生する:

- Dashboard 先行 + コード未マージ → 新 lookup_key 解決 API 障害でアプリ起動失敗
- コード先行 + Dashboard 未反映 → 旧 Price ID 直読でチェックアウト 404 / 二重 priceId 状態
- Production cutover 前に Test mode 検証未完 → Test clock E2E が未実行で本番リスク残存

### 1.3 課題: cutover 失敗時の kill switch が未設計

Stripe API バージョン更新時、Stripe 公式は既存 Webhook destination の api_version が immutable なため新規 destination 作成が必須と定める。kill switch (`USE_LOOKUP_KEY`) を設計しないと、cutover 失敗時に 72 時間 rollback window を活用できず、本番 incident 長期化リスクを抱える。

### 1.4 設計がなかった場合に何が困るか

1. **Phase 7 PR の並列衝突**: atom 追加 PR と rename PR が同時 push → hard conflict、QM 工数浪費
2. **Stripe Dashboard 反映漏れ**: Webhook 購読 event 5 → 8 種拡張 (Phase 5 子 1) が Dashboard 側で未反映のまま PR マージ → 新規 3 event (`subscription_schedule.aborted` / `_canceled` / `_completed`) が silent drop
3. **cutover 失敗時の長期 incident**: feature flag なし → 旧コード revert PR が必要 → 72 時間 rollback window を逃す → Stripe API version bump の rollback (`72h window`) も同時に巻き戻し不能
4. **DB migration 順序事故**: `stripe_webhook_events` table が Phase 7 step 4 (Webhook dedup) より前に必要だが、step 1 (DB migration) で先行配備されていないと dedup が機能しない

## 2. 設計原則 (§2)

| 原則 | 内容 | 根拠 |
|------|------|------|
| **5 step 順序確定** | Phase 7 統合 PR は 5 step に分割し、各 step 完了で次 step 着手可能 (各 step 独立マージ可、step 間で rebase drift 回避) | Stripe webhook migration 5 phase / ADR-0020 (PR size ≤ 500 行) / [[per-issue-execution-workflow]] |
| **Stripe Dashboard 同期 = step 1 (Test mode) + step 4 (Production cutover) の 2 回** | コード PR とは独立タスクで PO 手動操作 (#2627)、コード PR マージ前に Test mode で全 Webhook + Price 構築完了を確認 | Phase 5 子 1 §5 実装手順 8 step / Stripe 公式 build-subscriptions |
| **feature flag による kill switch** | `USE_LOOKUP_KEY` (lookup_key 解決失敗時に env var fallback) | LaunchDarkly / Unleash 業界標準 |
| **DB migration 先行** | `stripe_webhook_events` (子 3) + `archived_reason` enum (子 4) は step 1 で同時投入 (dedup 機構の schema 配備済み状態を担保) | ADR-0031 (DB migration 互換) / 子 3 §4.1 dispatcher 入口 dedup |
| **atom 統合 5 step は Phase 5 子 5 SSOT を参照** | 本 docs は順序の全体図のみ示し、各 step の詳細は子 5 #2643 §6 を参照 (DRY、SSOT 1 段集約) | ADR-0045 (atom / compound) / Phase 5 子 5 §6 |
| **72 時間 rollback window 活用** | apiVersion bump (`2026-04-22.dahlia` → `2026-05-27.dahlia`) は Stripe 公式 72h rollback window を利用、cutover 失敗時に Dashboard で旧 apiVersion に巻き戻し | Stripe `api/versioning` 72h policy / 子 1 §3.4 |

## 3. Phase 7 統合 PR 5 step (§3) ⭐ 本 docs の核

各 step は **独立マージ可能** な分割単位。step 間で rebase drift を最小化するため、**Step 0 → step 1 → 2 → 3 → 4 → 5** の順次マージを推奨する。並列マージは step 2 内部 (子 5 #2643 §6 で 5 step に再分割) のみ許可。

> **⚠️ 2026-06-03 補強 #2788: Step 0 (license key 完全全廃) を前置**: [phase1-license-key-removal-final-requirements.md](phase1-license-key-removal-final-requirements.md) (#2790 マージ済) で license key の SaaS / NUC 完全全廃が確定したため、既存 5 step (DB migration → atom 統合 → lookup_key → Webhook → env var 削除) の**前に Step 0 (PR-L0〜L5、license key 全廃)** を前置する。Step 0 の起点 PR-L0 (`assertLicenseKeyConfigured` no-op 化) は起動不能リスクを消す expand であり、atom rename (Step 2) より前に license routes / service / 認可ゲートを撤去することで、後続 step が license key 残存に依存しない clean な状態を担保する。**PR-L3 (routes 物理削除、`admin/license` 含む) は Step 2-3 (`admin/license` → `admin/subscription` rename) と統合**: rename ではなく削除になるため、Step 2-3 では `admin/subscription` 新設 + `/admin/license` → `/admin/subscription` 永久リダイレクト entry 追加のみ実施し、旧 `admin/license/**` の物理削除は PR-L3 で行う。**PR-L5 (DB 列・enum 物理削除 + env 撤去) は Step 5 (旧 env var 削除) と統合**。

### Step 0: license key 完全全廃 (#2788 PR-L0〜L5、[phase1-license-key-removal-final-requirements.md](phase1-license-key-removal-final-requirements.md) §4)

| 項目 | 内容 |
|---|---|
| **目的** | license key 層 (service / routes / 認可ゲート / DB 列・enum / LP / メール / env) を SaaS / NUC 問わず完全全廃し、認可を Stripe Subscription 一本化する。冗長な input path (license key) の除去であり「移行」ではない (補強 3 §2.1) |
| **6 PR 分割 (expand-contract、補強 3 §4)** | PR-L0〜L5。expand (PR-L0〜L3) で書込・参照経路を撤去、contract (PR-L5) で DB 列・enum・env を破壊的削除 |
| **PR-L0 (expand、起点)** | `assertLicenseKeyConfigured` (`hooks.server.ts` L43-45) を no-op 化。`AWS_LICENSE_SECRET` 未設定時の production throw 源を最初に消し、以降の削除 PR を安全化。**起動不能リスクが本 PR で消滅** |
| **PR-L1** | 入力経路削除 (signup キー入力 section / `admin/license` action / `handleCheckoutCompleted` の `issueLicenseKey` + `sendLicenseKeyEmail` 冗長層)。entitlement は `tenant.status=ACTIVE` で既付与済 (key 経由しない、補強 3 §3.3) |
| **PR-L2 (contract、最慎重)** | `capabilities.ts` L77 `nuc-prod && !licenseKey.valid` deny 撤廃 + `Capability` 型 `redeem.license_key` / `DenyReason` 型 `license-key-invalid` / evaluator 削除 + `EvaluationLicenseKey` 型 (`evaluation-context.ts`) + `getDebugLicenseKeyOverride` (`debug-plan.ts` / `hooks.server.ts`) 撤廃。**NUC write 回帰防止 E2E 必須** (5 年齢モード、`phase1-nuc US-N3` 整合) |
| **PR-L3 (routes 物理削除、Step 2-3 統合)** | `src/routes/ops/license/**` (4 subroute) + `src/routes/api/cron/license-expire/**` + `src/routes/api/v1/admin/license/**` + `license-key-service.ts` (700 行) 物理削除。**`admin/license/**` は Step 2-3 で `admin/subscription` 新設 + 永久リダイレクト後、本 PR で旧 dir 削除** (論点 3 物理削除、`phase6-context-decisions-6.md §3.3`) |
| **PR-L4 (LP / メール / LEGACY_URL_MAP)** | `site/help/license-key.html` 完全削除 + `/help/license-key` → `/admin/subscription` 301 redirect (論点 4) + `site/shared-labels.js` licenseKey namespace (47 key) 撤去 + `site/pricing.html` 「購入後ライセンスキーをメールでお送りします」→ subscription 文面 + `email-service.ts` 件名「ライセンスキーをお届け」削除 + `check-license-key-leak.mjs` CI gate (全廃前提、NUC 例外なし) |
| **PR-L5 (contract、Step 5 統合)** | DB 列・enum 物理削除 (`licenseKey` 列 DROP + `LICENSE_KEY_STATUS` / `LICENSE_PLAN` enum 定義削除 + `LicenseRecord` table DROP、4 backend: sqlite / dynamodb / demo / fixture) + env 撤去 (`AWS_LICENSE_SECRET` / `ALLOW_LEGACY_LICENSE_KEYS` を CDK / Secrets / GitHub Variables 3 系統)。**rollback 不可点** (列 DROP 後 forward-fix のみ、Pre-PMF 顧客ゼロ前提で許容、列 DROP 直前に本番 DynamoDB `licenseKey()` prefix item 最終確認推奨、補強 3 §3.8) |
| **AC** | (a) 機械削除完了 (import 残存 0 grep) (b) 認可移行 E2E (5 年齢モード NUC write 可能 + production build 起動成功) (c) 冗長層削除検証 (Stripe Checkout → `tenant.status=ACTIVE` entitlement、key 経由しない integration test) (d) DB 物理削除 4 backend 整合 (e) `check-license-key-leak.mjs` CI gate PASS (f) LEGACY_URL_MAP redirect + `tests/e2e/legacy-url-redirect.spec.ts` PASS (g) 各 PR で `npm run pre-ready -- --pr <pr>` PASS。詳細 10 項目は補強 3 §5 |
| **ロールバック判断基準** | PR-L0〜L4 は revert 可能 (expand)。**PR-L5 は列 DROP 後 revert 不可** (forward-fix のみ)。PR-L2 の NUC write E2E FAIL → PR-L2 revert + 認可ゲート撤廃を再設計 |
| **kill switch** | PR-L0 の no-op 化で起動不能リスク消滅後は kill switch 不要 (license key は冗長層、撤去で振る舞い不変)。PR-L5 contract のみ列 DROP 前の `licenseKey()` prefix item 確認を gate とする |
| **Stripe Dashboard 同期** | なし (license key は Stripe Subscription と独立、認可は subscription-based に既に移行済、補強 3 §2.1)。campaign 配布は Stripe Coupon / Promotion Code 代替 (OQ-2)、`legacy-count` cron 代替は `customer.subscription.deleted` webhook |
| **前提 PR** | なし (Step 0 の PR-L0 が起点)。PR-L0〜L2 を Step 1 (DB migration) と並行/前置、PR-L3 を Step 2-3 統合、PR-L5 を Step 5 統合 |

### Step 1: DB migration (子 3 #2641 + 子 4 #2642 連動、推定 200 行)

| 項目 | 内容 |
|---|---|
| **目的** | `stripe_webhook_events` 新規 + `archived_reason` enum 拡張を 4 backend (sqlite / dynamodb / in-memory / interface) で同期投入 |
| **対象 file** | `src/lib/server/db/schema.ts` (sqlite 4 location 拡張) / `src/lib/server/db/dynamodb/keys.ts` (`stripeWebhookEventKey`) / [src/lib/server/db/demo/webhook-event-repo.ts](src/lib/server/db/demo/webhook-event-repo.ts) (新規) / [src/lib/server/db/interfaces/webhook-event-repo.interface.ts](src/lib/server/db/interfaces/webhook-event-repo.interface.ts) (新規) / [src/lib/domain/archive-types.ts](src/lib/domain/archive-types.ts) (新規 `ARCHIVED_REASONS` enum) / `tests/e2e/global-setup.ts` + `tests/fixtures/legacy-schema/2026-05.sql` (e2e fixture 同期) / `tests/unit/helpers/test-db.ts` (unit fixture 同期) / `docs/design/parallel-implementations.md` (DB スキーマ並行実装欄追記) |
| **AC** | (a) `npx drizzle-kit generate` で migration 生成、`db:push` で sqlite に物理反映確認 (b) `npx vitest run src/lib/server/db/` PASS (c) 既存 NULL archived レコード → `'downgrade_user_selected'` で補充 migration (子 4 原則 4) (d) `docs/design/parallel-implementations.md` の DB スキーマ並行実装欄に `ARCHIVED_REASONS` 同期手順追加 (e) `npm run pre-ready -- --pr <step1-pr>` 全 step PASS |
| **ロールバック判断基準** | sqlite migration 失敗 (drizzle-kit エラー) / dynamodb GSI conflict / e2e fixture 同期漏れ → step 1 PR revert + step 2 着手保留 |
| **kill switch** | なし (DB schema は前方互換、新 column / table 追加のみで既存 read 経路に影響なし) |
| **Stripe Dashboard 同期** | なし (本 step は内部 schema のみ) |
| **前提 PR** | Step 0 PR-L0〜L2 (license key 認可ゲート撤去) と並行/前置可能 (DB migration は新 table 追加のみで license key 全廃と独立)。#2788 で Step 0 を 5 step の前に前置 |

### Step 2: atom 統合 5 step (子 5 #2643 §6 を参照)

| 項目 | 内容 |
|---|---|
| **目的** | terms.ts 3 atom 追加 + labels.ts 5 compound 追加 + `LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS` rename + `PLAN_TERMS.family` → `.premium` rename + LP 再生成。**#2788: `admin/subscription` 新設 + 永久リダイレクトのみ実施、旧 `admin/license/**` の物理削除は Step 0 PR-L3 で行う** (rename ではなく削除、論点 3 / `phase6-context-decisions-6.md §3.3`) |
| **詳細順序** | **Phase 5 子 5 [phase5-atom-ssot-architecture.md §6](phase5-atom-ssot-architecture.md) を参照** (本 docs では順序の全体図のみ提示)。各 sub step (2-1 〜 2-5) は子 5 SSOT で完全確定済 |
| **対象 file** | `src/lib/domain/terms.ts` (3 atom 追加) / `src/lib/domain/labels.ts` (5 compound 追加 + 1 rename) / `src/routes/admin/subscription/**` (新設、旧 `admin/license/**` のロジックを移植) / `site/shared-labels.js` (`scripts/generate-lp-labels.mjs` 再生成) / `src/lib/server/routing/legacy-url-map.ts` (`/admin/license` → `/admin/subscription` 永久リダイレクト entry)。**旧 `src/routes/admin/license/**` の物理削除は Step 0 PR-L3 で実施 (#2788)** |
| **AC** | (a) 子 5 §6 各 sub step の AC PASS (b) `npm run pre-ready` Step 7 (`check-no-plan-literals`) + Step 8 (`generate-lp-labels --check`) PASS (c) `src/lib/server/routing/legacy-url-map.ts` に永久エントリ追加確認 (Phase 1 補強 1 FR-6 整合) (d) `tests/e2e/legacy-url-redirect.spec.ts` PASS |
| **ロールバック判断基準** | atom rename 後の `npm run pre-ready` Step 7 で plan literal 直書き残存検出 → sub step ごとに revert (子 5 §6 で各 sub step 独立マージ可確認済) |
| **kill switch** | なし (atom rename は 1 行修正で 95 件伝播、Stripe API と独立) |
| **Stripe Dashboard 同期** | なし (本 step は labels / routes のみ) |
| **前提 PR** | Step 1 (DB migration) マージ済 + Step 0 PR-L2 (license key 認可ゲート撤去) マージ済 (#2788、atom rename 前に license routes 依存を解消)。旧 `admin/license/**` 物理削除は本 step 後の PR-L3 で実施 |

### Step 3: lookup_key 移行 (子 4 #2664 + 子 1 #2639 連動、推定 250 行、#2683 補強で apiVersion bump scope 外化)

| 項目 | 内容 |
|---|---|
| **目的** | env var 直読 (`STRIPE_PRICE_STANDARD_MONTHLY` 等 4 件) を `prices.list({ lookup_keys })` 経由参照に切替 + lookup_key 段階移行 (Stripe `transfer_lookup_key` 経由)。**apiVersion は `'2026-04-22.dahlia'` 維持** (#2683 訂正: `'2026-05-27.dahlia'` は preview リリースで本番不採用、本 step では bump しない) |
| **対象 file** | `src/lib/server/stripe/config.ts` (`STRIPE_PRICES` 定数 → `getPlans()` lookup_key 解決関数に rewrite) / [tests/unit/lib/server/stripe/config.test.ts](tests/unit/lib/server/stripe/config.test.ts) (新規 lookup_key 解決 mock) / [tests/unit/lib/server/stripe/client.test.ts](tests/unit/lib/server/stripe/client.test.ts) (新規 apiVersion `'2026-04-22.dahlia'` 維持 assert) / `.env.example` (`USE_LOOKUP_KEY` feature flag 追加、デフォルト `true`) / `docs/guides/stripe-setup-guide.md` (4 商品手動作成 → **2 Product 各 1 Price + lookup_key** 手順に全面改訂、#2683 代替案 D 反映) |
| **AC** | (a) lookup_key 解決成功時に新 priceId を返す + 失敗時に env var fallback 動作 (`USE_LOOKUP_KEY=false` で旧経路、kill switch) (b) `npx vitest run src/lib/server/stripe/` PASS (c) apiVersion `'2026-04-22.dahlia'` を維持していることを unit test で assert (#2683) (d) `docs/guides/stripe-setup-guide.md` の手順で PO が Test mode Dashboard を 2 Product 構成で構築可能なことを確認 (e) `npm run pre-ready -- --pr <step3-pr>` PASS |
| **ロールバック判断基準** | (a) lookup_key 解決 Stripe API 障害が複数回連続 → `USE_LOOKUP_KEY=false` で env var fallback 即時切替 (b) #2683 訂正で apiVersion bump 廃止のため、本 step での apiVersion 関連 rollback は発生しない |
| **kill switch** | `USE_LOOKUP_KEY` env var (デフォルト `true`、`false` で env var 直読の旧コード経路) |
| **Stripe Dashboard 同期** | **Test mode で先行作成必須** (本 step マージ前に PO #2627 で Test mode の **2 Product / 各 1 Price / lookup_key** / Webhook 構築済の状態を担保、#2683 代替案 D 反映) |
| **前提 PR** | Step 1 + Step 2 マージ済 + Stripe Dashboard Test mode 構築完了 (PO #2627) |

#### Step 3-a 実装完了記録 (PR #2717 / Issue #2716)

| 項目 | 内容 |
|---|---|
| **実装 PR** | [#2717 feat(billing): #2716 Phase 7 PR-3a — Stripe lookup_key caching layer + USE_LOOKUP_KEY flag 配備](https://github.com/Takenori-Kusaka/ganbari-quest/pull/2717) |
| **対象 Issue** | #2716 |
| **マージ commit** | `af430e0a` (2026-05-30) |
| **配備 file** | `src/lib/server/stripe/price-cache.ts` (新規 caching layer) + `src/lib/server/stripe/config.ts` (`isLookupKeyEnabled` / `getPriceId` 関数経由化) + `.env.example` (USE_LOOKUP_KEY default `false` 配備) |
| **テスト追加** | `tests/unit/server/stripe/price-cache.test.ts` + `tests/unit/server/stripe/lookup-key-config.test.ts` (flag 分岐 + lookup_key 経路 + env var fallback) |
| **本 PR scope (Step 3-a only)** | caching layer 実装 + `USE_LOOKUP_KEY=false` default で配備のみ、本番動作不変 (env var 直読継続)。Production cutover は PR-3b (#2721) に持ち越し |
| **本番影響** | default `USE_LOOKUP_KEY=false` で本番 Lambda 動作不変。Production Stripe Dashboard の lookup_key 発行も PO 手動操作で Test mode のみ完了 |
| **次工程** | PR-3b (#2721) で `USE_LOOKUP_KEY=true` 物理 cutover + CDK env 配備 + GitHub Actions Variables 経路追加 |

#### Step 3-b 実装完了記録 (PR #2721 候補 / Issue #2721) — 本 PR

| 項目 | 内容 |
|---|---|
| **対象 Issue** | #2721 |
| **配備 file** | `src/lib/server/stripe/client.ts` (`STRIPE_API_VERSION` 物理 bump `'2026-05-27.dahlia'` → `'2026-04-22.dahlia'`、補強 PR #2684 docs SSOT との物理同期) + `infra/lib/compute-stack.ts` (Lambda env 3 件配備: `USE_LOOKUP_KEY` / `STRIPE_WEBHOOK_SHADOW_MODE` / `STRIPE_WEBHOOK_SECRET_TEST`) + `.github/workflows/deploy.yml` (CDK context 3 件追加: cdk diff + cdk deploy の 2 箇所) + `.env.example` (USE_LOOKUP_KEY default `true` 更新) |
| **テスト追加** | `tests/unit/server/stripe/client-api-version.test.ts` (新規、stable / preview 厳密 assert regression gate) + `tests/unit/infra/multi-lambda-cdk.test.ts` (3 ケース追加: 本番 Fn env 配備 + demo Fn omit 検証) |
| **本 PR scope (Step 3-b cutover)** | (1) apiVersion 物理 bump (補強 PR #2684 で docs 訂正のみ実施、client.ts 物理同期が漏れていた構造的欠落の補修) + (2) PR-3a 配備済 `USE_LOOKUP_KEY` の Production cutover (`true` default 配備) + (3) PR-4a 配備済 `STRIPE_WEBHOOK_SHADOW_MODE` / `STRIPE_WEBHOOK_SECRET_TEST` の CDK context 経由配布完了 (PR-4a では env 配備のみで GitHub Actions → CDK 経路が未配線だった) |
| **本番影響** | (a) apiVersion `'2026-04-22.dahlia'` stable 化により preview リリース脱却。副次制約 4 (Webhook destination api_version immutable) には未触 (Webhook destination 自体は PR-4b で新規作成) (b) Production Lambda env に `USE_LOOKUP_KEY=true` 配備で lookup_key 経路 cutover (Stripe API 障害時は env var fallback、kill switch 有効) (c) shadow mode 関連 env は default `false` のまま、PR-4b cutover まで本番 Webhook 動作不変 |
| **前提** | **#2627 Production Stripe Dashboard 同期完了 (PO 手動操作、2026-05-31)**: 2 Product + Price 各 1 (lookup_key=`standard_monthly` / `premium_monthly`、内税) + Customer Portal (代替案 D) + Tax + Branding が Production mode で配備済 (#2627 comment confirmation) |
| **kill switch 操作** | (a) `USE_LOOKUP_KEY` cutover 失敗時: GitHub Actions Variables に `USE_LOOKUP_KEY=false` 設定 → CDK redeploy で env var 直読経路に巻き戻し (約 30 秒で反映) (b) apiVersion ロールバック: `client.ts:8` を `'2026-05-27.dahlia'` (旧値) に戻す revert PR + Lambda 再 deploy (Webhook destination は PR-4b 未実施のため不整合発生せず) |
| **次工程** | (a) 1-2 week staging 検証 (Sentry error rate < 0.5% / Stripe API 障害率 / lookup_key cache hit rate) (b) PR-4b (Webhook cutover) 着手判断 (c) PR-5 (旧 env var 物理削除 + 旧 Webhook destination retire) |

### Step 4: Webhook 受信口 (子 3 #2641 + Stripe 公式 5 phase 整合、#2683 補強で event 一覧変更)

> **現状の正解 (#4128)**: **受信口は `/api/stripe/webhook` の 1 本**。shadow mode / `webhook-v2` / 2 destination 並存は**採用しない**。
> shadow mode は「署名検証だけして 200 を返す」経路で、Stripe は 200 を受けると再送しないため、
> destination の切替順序を誤ると課金 event が台帳にも残らず消える。この失敗モードは 2026-07-26 の実障害と同 class であり、
> 「いざという時のため」に残す価値より env 1 個の誤設定で課金を落とすリスクが上回ると判断して撤去した。
> 以下の 4-a / 4-b / 4-c は**実行されない**。受信口が 1 本であることは
> `tests/unit/architecture/stripe-webhook-single-entrypoint.test.ts` が CI で固定する。
> dedup の現行仕様 (insert-first) は `docs/design/07-API設計書.md` §POST /api/stripe/webhook と
> `docs/design/08-データベース設計書.md` §stripe_webhook_events が SSOT。

| 項目 | 内容 |
|---|---|
| **目的** | dispatcher 入口 dedup (`handleWebhookEvent` 冒頭、L221) + Webhook 購読 event 5 種維持 (下記「購読 event SSOT」ブロックと同一集合。旧計画の `subscription_schedule.*` 3 種 / `credit_note.created` は handler が無いため購読しない) |
| **対象 file** | `src/lib/server/services/stripe-service.ts` (`handleWebhookEvent` dispatcher 入口の insert-first dedup) / `src/routes/api/stripe/webhook/+server.ts` (**唯一の受信口**) / `src/lib/server/db/interfaces/webhook-event-repo.interface.ts` + 各 backend 実装 (`claim` / `finalize` / `releaseClaim`) / `tests/unit/services/stripe-webhook-dedup.test.ts` / `tests/unit/architecture/stripe-webhook-single-entrypoint.test.ts` (受信口 1 本の fitness function、#4128) |
| **AC** | (a) 同一 event.id 重複到達時に `retry_count` increment + handler 1 回のみ実行 (b) 「購読 event SSOT」ブロックの 5 event 全種を受信 + DB に `handler_result='success'` 物理確認 (新規購入経路 = `checkout.session.completed` を含む) (c) `npm run pre-ready -- --pr <step4-pr>` PASS |
| **kill switch** | 無し (#4128 で撤去)。受信口を落とす kill switch は「課金 event を捨てる switch」でしかないため持たない。障害時は Stripe Dashboard 側で destination を無効化し、再送 (3 日) で復旧させる |
| **Stripe Dashboard 同期** | Production mode で Webhook destination 作成 (PO #2627 領域 F) |
| **将来の apiVersion bump 時** | **Phase 5 子 1 #2644 §4.4 副次制約 4 (Webhook destination api_version immutable)** により、既存 destination の api_version は変更不可。新 destination を**同一 URL** (`/api/stripe/webhook`) に向けて新 api_version で作成し、旧 destination を無効化する (route を増やさない)。並行到達期間の重複は insert-first dedup が吸収する |
| **前提 PR** | Step 1 + Step 2 + Step 3 マージ済 + Stripe Dashboard Production mode 構築完了 (PO #2627) |

#### 購読 event SSOT (Step 4 Dashboard 設定 / AC (b) の対象集合)

実装の `dispatchWebhookEvent` の `case` と同一集合。Phase 5 子 1 §4.3 のブロックと一致する:

<!-- webhook-subscribed-events:start -->
- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
<!-- webhook-subscribed-events:end -->

本ブロックは `tests/unit/docs/stripe-webhook-subscribed-events-ssot.test.ts` が実装と突合する。handler の無い event を足すと Dashboard で購読しても永久に沈黙するため、`case` 追加と同一 PR でのみ変更する。

#### Step 4-a (shadow mode) の撤回記録 (#4128)

shadow mode endpoint は PR #2714 (Issue #2713) で配備されたが、**cutover (4-b) は実行されないまま #4128 で撤去した**。

| 項目 | 内容 |
|---|---|
| **撤回理由** | shadow mode は署名検証後に log を 1 行出して 200 を返すだけの経路。Stripe は 200 を受けると再送しないため、Dashboard の destination を先に切り替えると課金 event が **台帳にも残らず消える**。2026-07-26 の実障害 (初回の有料課金が丸ごと落ち無通知) と同 class の失敗モードを、env 1 個の誤設定で踏める状態だった |
| **撤去したもの** | `/api/stripe/webhook-v2` route / `isWebhookShadowModeEnabled` / `getWebhookSecretForShadow` / Lambda env 2 件 (`compute-stack.ts` + `deploy.yml` + `.env.example`) |
| **代替** | 受信口は `/api/stripe/webhook` の 1 本に確定。api_version 変更が必要になった場合は、新 destination を**同一 URL** に向けて作成し旧 destination を無効化する (route を増やさない)。並行期間の重複到達は insert-first dedup が吸収する |
| **再発防止** | `tests/unit/architecture/stripe-webhook-single-entrypoint.test.ts` — 受信口の本数 / 全受信口が `handleWebhookEvent` に dispatch すること / shadow mode の残存 (src + infra + workflow + .env.example) を CI で検査する |

### Step 5: 旧 env var 削除 + 旧 4 Price archive (推定 100 行)

| 項目 | 内容 |
|---|---|
| **目的** | step 3 の 1 週間 smoke test PASS 後、旧 env var (`STRIPE_PRICE_STANDARD_MONTHLY` / `_STANDARD_YEARLY` / `_FAMILY_MONTHLY` / `_FAMILY_YEARLY`) を CDK 設定 / GitHub Secrets / Lambda env から削除 + 旧 4 Price を Stripe Dashboard で archive。**#2788: Step 0 PR-L5 (DB 列・enum 物理削除 + `AWS_LICENSE_SECRET` / `ALLOW_LEGACY_LICENSE_KEYS` 撤去) を本 step と統合** (env / 破壊的 migration を最後にまとめて実施、rollback 不可点) |
| **対象 file** | `infra/lib/compute-stack.ts` (Lambda env から旧 4 env var 削除) / `.github/workflows/*.yml` (GitHub Variables から削除) / `.env.example` (旧 env var 削除 + `USE_LOOKUP_KEY` feature flag も削除可能性 PO 判断) / `src/lib/server/stripe/config.ts` (env var fallback コード削除、lookup_key 必須化) |
| **AC** | (a) CDK diff で旧 env var 4 件削除確認 (b) Lambda 再 deploy で起動成功 (c) Stripe Dashboard で旧 4 Price archived 状態確認 (d) Phase 1 補強 2 Open question 4 「active subscription 0 件」を step 5 直前に再確認 (PO 判断、Phase 5 子 1 R6 整合) (e) `npm run pre-ready -- --pr <step5-pr>` PASS |
| **ロールバック判断基準** | (a) Lambda 起動失敗 → CDK rollback (`cdk deploy --rollback`) で env var 再投入 (b) 旧 4 Price archive 後に active subscription 検出 (Phase 1 補強 2 Open question 4 が崩れた場合) → Stripe API で Price un-archive |
| **kill switch** | なし (本 step は撤去のみ、復活は CDK rollback で対応) |
| **Stripe Dashboard 同期** | 旧 4 Price archive (PO #2627 G 領域、Production mode) |
| **前提 PR** | Step 1 + Step 2 + Step 3 + Step 4 全マージ済 + 1 週間 smoke test PASS |

## 4. Stripe Dashboard #2627 同期 timeline マトリクス (§4)

Stripe Dashboard #2627 で PO が手動操作する 7 領域 (A-G) と、Phase 7 統合 PR 5 step のマージ timing の整合性を表で確定する。**「コード PR マージ vs Stripe Dashboard 反映」の片方先行禁止ゾーン**を明示する。

### 4.1 7 領域 (A-G、#2683 補強で 2 Product 構成反映)

| 領域 | Stripe Dashboard 操作 | Phase 7 step 同期 timing |
|---|---|---|
| **A** | Test mode で **2 Product (`prod_STANDARD` + `prod_PREMIUM`) 各 1 Price** (`standard_monthly` / `premium_monthly` lookup_key、`inclusive` 税込) (#2683 代替案 D) | **Step 3 マージ前**必須 (Step 3 PR の Pre-Ready CI が Test mode lookup_key 解決確認を含む) |
| **B** | Test mode で Customer Portal config 設定 (子 1 §3.2 の 12 項目、**`subscription_update.products` に 2 entries** + `proration_behavior='always_invoke'` + `schedule_at_period_end` 撤去、#2683) | Step 3 マージ前 (A と同時、PO 1 セッションで完遂) |
| **C** | Test mode で Webhook destination 作成 (disabled、購読 event は Step 4 の「購読 event SSOT」ブロックの 5 種をそのまま設定する) | **Step 4-a マージ前**必須 |
| **D** | Test mode で Test clock customer 作成 (子 2 #2662 連動、6 シナリオ用、#2683 でダウンシナリオは即時 + credit memo 検証に変更) | Step 4-a 着手前 (E2E 計画段階で PO が事前構築) |
| **E** | Production mode で 2 Product / 各 1 Price / lookup_key / Customer Portal config を Test mode と同設定で作成 (#2683 反映) | **Step 4-b マージ前**必須 (Production cutover 前) |
| **F** | Production mode で Webhook destination 作成 (disabled、Step 4-b マージ時に有効化、#2683 副次制約 4: api_version は新 destination 作成時の Dashboard 設定値で immutable) | Step 4-b マージ時に PO が Dashboard で有効化 (同期コミット) |
| **G** | Production mode で旧 4 Price archive + 旧 Webhook destination delete | **Step 5 マージ後** 1 週間 smoke test PASS 後 |

### 4.2 片方先行禁止ゾーン (mermaid timeline)

```mermaid
gantt
    title Phase 7 統合 PR 5 step × Stripe Dashboard #2627 7 領域 同期 timeline
    dateFormat YYYY-MM-DD
    axisFormat %m/%d

    section Phase 7 統合 PR
    Step 1 DB migration          :s1, 2026-06-01, 3d
    Step 2 atom 統合 5 step       :s2, after s1, 5d
    Step 3 lookup_key 移行       :s3, after s2, 5d
    Step 4 Webhook cutover       :crit, s4b, after s3, 1d
    Step 4 検証 (1週間 smoke)     :s4b-verify, after s4b, 7d
    Step 4-c retire              :s4c, after s4b-verify, 1d
    Step 5 旧 env var 削除        :s5, after s4c, 2d

    section Stripe Dashboard #2627 (PO 手動)
    A+B Test mode Product/Price/Portal     :crit, ab, 2026-06-04, 1d
    C Test mode Webhook (disabled)          :crit, c, before s4b, 1d
    D Test mode Test clock customer         :d, 2026-06-09, 1d
    E Production Product/Price/Portal      :crit, e, before s4b, 1d
    F Production Webhook enable (cutover)   :crit, f, during s4b, 1d
    G Production 旧 4 Price archive         :g, after s4b-verify, 1d
```

### 4.3 同期失敗時の検出ポイント

| 失敗パターン | 検出 | 対処 |
|---|---|---|
| A+B 未完で Step 3 マージ | Step 3 PR の Pre-Ready で `prices.list({ lookup_keys })` mock 解決成功するが、本番 staging 起動で `INVALID_LOOKUP_KEY` | Step 3 を revert、PO #2627 で A+B 完遂後再 push |
| C 未完で Step 4 マージ | 新 destination で event 受信 0 件 | PO #2627 で C 完遂後、新 destination を有効化 |
| E 未完で Step 4-b マージ | Production cutover で新 lookup_key 解決失敗 (Production mode Price 不在) | Step 4-b 即時 revert (kill switch `USE_LOOKUP_KEY=false` 有効化)、PO #2627 で E 完遂後再 push |
| F 同期遅延 (Step 4-b マージ後 Dashboard 未有効化) | 「購読 event SSOT」ブロックの 5 event が silent drop (新規購入 `checkout.session.completed` を含むため課金反映が止まる) | PO に Discord alert 通知、Dashboard で F 即時有効化 (5 分以内対応) |
| G 早期実行 (Step 5 マージ前に旧 4 Price archive) | active subscription 顧客の請求継続失敗 (Phase 1 補強 2 Open question 4 が崩れた場合) | Stripe API で旧 4 Price un-archive (Stripe 公式 archive 解除)、Step 5 マージまで再 archive 保留 |

## 5. 将来の Stripe apiVersion bump 時の webhook destination 切替 (§5、#2683 補強で副次制約 4 を根拠化)

**受信口は `/api/stripe/webhook` の 1 本のみ**で、2 destination を並存させる shadow mode 方式は採用しない (#4128、§Step 4 「現状の正解」参照)。将来 SDK apiVersion を bump する際 (本 Phase 7 では現状 `'2026-04-22.dahlia'` 維持のため発動しない) の手順を本 §5 で SSOT 化する。

> **#2683 補強 (2026-05-30)**: 新 destination 作成が**強制必須**となる根拠は、Phase 5 子 1 #2644 #2683 補強で SSOT 化された**副次制約 4: Webhook destination api_version immutable** ([phase5-stripe-product-architecture.md §4.4](phase5-stripe-product-architecture.md))。Stripe API は既存 destination の api_version 変更を `400 Bad Request` で拒否するため、SDK apiVersion 変更時は新 destination 作成が必須。

### 5.1 手順

| 手順 | 内容 |
|---|---|
| **1. 新 destination 作成** | Stripe Dashboard で新 destination を **同一 URL** (`/api/stripe/webhook`) に向けて新 api_version で作成 (Test mode → Production mode の順) |
| **2. 切替** | 新 destination を有効化 + 旧 destination を無効化。並行到達期間の重複は insert-first dedup (`stripe_webhook_events`) が吸収する |
| **3. 監視** | エラー率 / 顧客 inquiry / DB inconsistency を監視 (§8 R4 参照) |
| **4. Retire** | 1 週間 smoke test PASS で旧 destination を delete |

### 5.2 kill switch SSOT

`.env.example` に以下 feature flag を SSOT として配備 (Phase 5 子 1 整合):

```bash
# .env.example (Phase 7 Step 3 で追加)
# Stripe lookup_key 解決の段階移行 (Phase 7 Step 3 / Phase 5 子 1 §3.4)
# true (default): prices.list({ lookup_keys }) で解決
# false (fallback): env var STRIPE_PRICE_* で直読 (kill switch)
USE_LOOKUP_KEY=true
```

`src/lib/server/stripe/config.ts` で `process.env.USE_LOOKUP_KEY` を読み取り、`boolean` 解釈 (`'true'` のみ true、それ以外 false)。LaunchDarkly / Unleash 等の外部 feature flag platform は **Pre-PMF 段階で導入しない** (ADR-0010 過剰防衛回避)、env var 1 件で最小構成。webhook 受信口自体には kill switch を持たない (§Step 4 「kill switch」参照)。

## 6. atom 統合 5 step (子 5 #2643 §6) との全体 sequence (§6)

子 5 #2643 で確定した atom 統合 5 step (Step 2 内部) と、本 docs の Phase 7 統合 PR 5 step (Step 1-5) の全体 sequence を整理する。

### 6.1 全体 sequence (mermaid flowchart)

```mermaid
flowchart TD
    S0[Step 0: license key 完全全廃<br/>PR-L0〜L5 #2788] --> S1[Step 1: DB migration<br/>stripe_webhook_events + archived_reason enum]
    S0 --> S0a[PR-L0: assertLicenseKeyConfigured no-op]
    S0a --> S0b[PR-L1: 入力経路削除]
    S0b --> S0c[PR-L2: 認可ゲート撤廃 NUC write E2E]
    S0c --> S0d[PR-L3: routes 物理削除 Step 2-3 統合]
    S0d --> S0e[PR-L4: LP/メール/LEGACY_URL_MAP]
    S0e --> S0f[PR-L5: DB 列/enum 物理削除 Step 5 統合]
    S1 --> S2[Step 2: atom 統合 5 step]
    S2 --> S2a[Step 2-1: terms.ts 3 atom 追加]
    S2a --> S2b[Step 2-2: labels.ts 5 compound 追加]
    S2b --> S2c[Step 2-3: LICENSE_PAGE_LABELS → SUBSCRIPTION_PAGE_LABELS rename]
    S2c --> S2d[Step 2-4: PLAN_TERMS.family → .premium atom rename]
    S2d --> S2e[Step 2-5: generate-lp-labels.mjs 再生成 LP 反映]
    S2e --> S3[Step 3: lookup_key 移行<br/>+ apiVersion bump]
    S3 --> S4[Step 4: Webhook 受信口<br/>単一 destination]
    S4 --> S4c[Step 4-c: retire 旧 destination delete]
    S4c --> S5[Step 5: 旧 env var 削除 + 旧 4 Price archive]

    S2a -.->|並列マージ可| S2b
    S2b -.->|並列マージ可| S2c

    classDef critical fill:#f9f,stroke:#333,stroke-width:2px
    class S0c,S0f,S1,S3,S4,S5 critical
```

### 6.2 atom 統合 5 step との競合回避

子 5 #2643 §6 で **Step 2-1 / 2-2 は並列マージ可** と確定。本 docs の Phase 7 統合 PR 5 step では:

- **Step 2 全体は Step 1 完了後に着手**: DB migration が先行することで、Step 2 の atom rename で参照される DB column / enum 値が存在する状態を担保
- **Step 2 内部の 5 sub step は子 5 SSOT に従い順次/並列マージ判断**: 本 docs では順序の全体図のみ示し、詳細順序は子 5 §6 参照
- **Step 2 完了 (5 sub step 全マージ済) を Step 3 着手の前提とする**: lookup_key 移行 (Step 3) で参照される `PLAN_TERMS.premium` atom 名が rename 済の状態を担保

### 6.3 LP 再生成 (Step 2-5) と env var 削除 (Step 5) の同期

Step 2-5 で `generate-lp-labels.mjs` 再生成済 (LP 側 `site/shared-labels.js` に新 atom 値が反映) の状態で、Step 5 で旧 env var を削除する。LP は Stripe API と独立しているため Step 5 と直接の同期は不要だが、**Phase 1 補強 1 FR-6 永久リダイレクト** (`/admin/license` → `/admin/subscription`) は Step 2-3 で投入済の状態で Step 5 を実行する。

## 7. impact-analysis 4 layer 防御 + 21 カテゴリ checklist (§7)

本 PR は **docs 設計のみ** で新規 1 ファイル追加。L1-L4 影響範囲は最小だが、Phase 7 統合 PR に向けた **事前見積** として記録。

### L1 構文 (ast-grep / ripgrep)

| 検出パターン | 件数 (Phase 7 実測予測) | step |
|---|---|---|
| `STRIPE_PRICE_*` env var 直読 | 4 件 (`src/lib/server/stripe/config.ts`) | Step 3 + Step 5 |
| `apiVersion` 'dahlia' string | 1 件 (`src/lib/server/stripe/client.ts`) | Step 3 |
| `handleWebhookEvent` dispatcher | 1 件 ([src/lib/server/services/stripe-service.ts](src/lib/server/services/stripe-service.ts) L221) | Step 4-a |
| `LICENSE_PAGE_LABELS` 参照 | 218 件 (Phase 1 補強 1 確認) | Step 2-3 |
| `PLAN_TERMS.family` 参照 | 95 件 (Phase 1 補強 2 Explore) | Step 2-4 |
| `archived_reason` 列参照 | 22 件 (子 4 §5 L1 確認) | Step 1 |
| `/admin/license` URL 参照 | 308 件 (Phase 1 補強 1 確認) | Step 2-3 (redirect entry) + Step 0 PR-L3 (旧 dir 物理削除、#2788) |
| **license key 言及 (`ライセンスキー` / `license-key` / `licenseKey`)** | **142 occurrence (28 file、src) + LP 3 file + メールテンプレ (補強 3 §1.1)** | **Step 0 PR-L0〜L5 (#2788、完全全廃 + `check-license-key-leak.mjs` CI gate)** |

### L2 意味 (型 / 同名異義)

- **`'family'` (表示プラン名 vs 内部識別子)**: Phase 1 補強 2 FR-5 で明文化済。Step 2-4 atom rename PR で表示名のみ rename、enum / DB 値は Step 1-5 全 step で**変更しない** (Phase 1 補強 1 FR-5 の legacy 互換性整合)
- **`STRIPE_PRICE_*` env var の 3 系統 (CDK Lambda env / GitHub Actions Variables / .env.example)**: Step 5 で 3 系統同時撤去
- **`webhook` (旧 endpoint vs 新 endpoint)**: Step 4-a で `/api/stripe/webhook` (旧) + `/api/stripe/webhook-v2` (新) が並存、Step 4-c で旧削除

### L3 構造 (依存グラフ)

```
Step 1 (DB migration)
  ↓ (新 schema 配備)
Step 2 (atom 統合 5 step、子 5 §6)
  ↓ (新 atom + 新 routes)
Step 3 (lookup_key 移行 + apiVersion bump)
  ↓ (Stripe API SDK 経路新化)
Step 4: Webhook 受信口 (単一 destination、dedup で冪等性担保)
  ↓ (Webhook handler 切替完了)
Step 5 (旧 env var 削除 + 旧 4 Price archive)
```

各 step は前 step マージ済を前提とする。Step 2 内部の 5 sub step は子 5 §6 で並列マージ可とした sub step 以外は順次マージ。

### L4 派生 artifact 21 カテゴリ checklist (主要項目)

| # | カテゴリ | 影響 step |
|---|---|---|
| 1 | DB schema | Step 1 (`stripe_webhook_events` table + `archived_reason` enum) |
| 2 | DB 保存済 string value | Step 1 (`archived_reason` NULL → `'downgrade_user_selected'` 補充) / Step 4 (`stripe_webhook_events` の 30 日 retention 自動 cleanup) |
| 7 | Stripe Product / Price / Webhook | Step 3 + Step 4 + Step 5 (Dashboard 同期 §4) |
| 11 | analytics event name | 影響なし (Stripe webhook event の type は Step 4 で受信 event 拡張、analytics 内部 event は変更なし) |
| 12 | dashboard / alert | Step 4-c で Stripe Dashboard 旧 destination delete (Discord alert) |
| 13 | Help Center / FAQ | Step 3 で `docs/guides/stripe-setup-guide.md` 全面改訂 |
| 16 | GitHub Actions / pipeline | Step 5 で `STRIPE_PRICE_*` GitHub Variables 削除 |
| 17 | deployment env / secrets | Step 5 で CDK / Lambda env / GitHub Secrets 撤去 (本 PR の Step 5 §影響範囲) |
| 18 | i18n platform | Step 2-5 で `scripts/generate-lp-labels.mjs` 再生成 (子 5 §6 整合) |
| 19 | fixture / seed / golden | Step 1 で e2e fixture 同期 (`tests/e2e/global-setup.ts` + `tests/fixtures/legacy-schema/2026-05.sql`) / Step 2 で atom snapshot 更新 |
| 21 | audit log / 過去レコード | 影響なし (Phase 1 補強 2 Open question 4 で「active subscription 0 件」確定済、過去レコードへの破壊的影響なし) |

## 8. 想定リスク + ロールバック詳細 (§8)

子 5 #2656 (Phase 6 子 5 ロールバック詳細、別 Issue 担当) で全リスクを SSOT 化する。本 docs では Phase 7 統合 PR 5 step に特化した主要リスク 5 件のみ抜粋。

| # | リスク | 検出 | ロールバック手順 |
|---|---|---|---|
| R1 | Step 1 DB migration で 4 backend 同期漏れ (e2e fixture 未更新) | e2e spec で `archived_reason` NOT NULL 制約違反 | Step 1 revert (drizzle migration rollback)、子 4 §3.4 e2e fixture 同期手順を再実行 |
| R2 | Step 2-3 rename で `LEGACY_URL_MAP` 永久リダイレクト未投入 | `tests/e2e/legacy-url-redirect.spec.ts` FAIL | Step 2-3 revert、`src/lib/server/routing/legacy-url-map.ts` entry 追加後再 push |
| R3 | Step 3 lookup_key 解決 Stripe API 障害連発 (5xx > 10% / 1 hour) | Sentry alert / Lambda CloudWatch alarm | `USE_LOOKUP_KEY=false` で env var fallback (kill switch、Lambda env 即時切替) |
| R4 | 将来の apiVersion bump 時、新 destination 切替でエラー率 > 1% / 顧客 inquiry > 3 件 / DB inconsistency | DataDog dashboard / 顧客 inquiry log | Stripe Dashboard で旧 destination を再有効化 + 新 destination を無効化 (§5 手順整合) |
| R5 | Step 5 旧 4 Price archive 後に active subscription 検出 | Stripe Dashboard subscriptions list / billing 失敗 inquiry | Stripe API で旧 4 Price un-archive (Stripe 公式 archive 解除)、Step 5 PR revert |

詳細は子 5 #2656 (Phase 6 子 5) を参照 (本 docs では順序の全体図のみ)。

## 9. ADR 起票推奨 (§9)

Phase 6 完了時に **1 件の新 ADR 起票推奨** (Phase 6 計画書 v2 §「ADR 起票推奨」整合):

- **ADR 候補名**: 「Phase 7 統合 PR cutover シーケンスと kill switch 戦略」
- **context**:
  - Stripe webhook migration 5 phase (setup → shadow → cutover → retire) を自プロダクトに転用
  - feature flag (`USE_LOOKUP_KEY`) で kill switch 実装
  - 72h rollback window 活用 (apiVersion bump)
- **選択肢比較** (OSS 先調査ルール ADR-0014 整合):
  - **A. Stripe 公式 5 phase + 自前 env var kill switch** (本 PR 採用)
  - **B. Stripe 公式 5 phase + LaunchDarkly feature flag platform**: 不採用 (Pre-PMF 過剰防衛、ADR-0010)
  - **C. Stripe 公式 5 phase + Unleash OSS**: 不採用 (同上)
  - **D. 5 phase なしで big-bang cutover**: 不採用 (cutover 失敗時の長期 incident リスク)
- **整合**: ADR-0010 (Pre-PMF、最小構成) / ADR-0020 (PR size ≤ 500 行 = 5 step 分割の根拠) / ADR-0045 (atom / compound)
- **起票タイミング**: Phase 7 統合 PR 全 step マージ完了後、別 PR で起票。TOP 10 active 40 件超過中、月 1 棚卸 (2026-06 最終週、docs/CLAUDE.md §ADR 月 1 棚卸) で 1-in-1-out トリガー判断
- **archive 候補**: ADR 月 1 棚卸 2026-05-09 で抽出済 (ADR-0017 rejected ADR 等)

## 10. Open question (PO 判断、Phase 7 で確定、§10)

| # | 軸 | 論点 | 推奨案 | 状態 |
|---|---|------|------|------|
| 2 | **UX** | Step 5 で `USE_LOOKUP_KEY` feature flag 自体も削除?env var fallback 経路を恒久残存? | 削除推奨 (kill switch の長期残存は dead code 化、PMF 後にも必要なら別 PR で再設計)。Step 5 マージで `USE_LOOKUP_KEY` env var + fallback コード両方削除 | Phase 7 Step 5 着手時 PO 判断 |
| 3 | **security** | Step 4 cutover 失敗時のロールバック手順を本番想定で 1 度実演 (Test mode で)?Pre-Ready 必須化? | 実演必須化推奨 (本番 cutover の dry-run、子 5 #2656 §「kill switch 実演」で SSOT 化、本 PR scope 外)。Pre-Ready チェックリストに「Test mode で kill switch 実演 PASS」を追加 | Phase 7 Step 4-a Pre-Ready 設計時に確定 |
| 5 | **security (adversarial)** | Step 5 で旧 env var 削除する際、CDK rollback (`cdk deploy --rollback`) でロールバック可能にするため env var 削除 PR と CDK deploy を separate するべき?同時 PR で deploy も含めるべき? | separate 推奨 (rollback 余地確保)。Step 5 を 2 PR に分割: (5-a) コード変更 + env var fallback 削除、(5-b) CDK / GitHub Secrets 撤去。5-a 完了後 1 週間 smoke test PASS で 5-b 着手 | Phase 7 Step 5 着手時 PO 判断 |

## 11. テスト計画 (§11、Phase 7 一括実行)

| カテゴリ | テスト内容 | ファイル | 実行 step |
|---|---|---|---|
| **Test clock E2E** | アップ即時 / ダウン期末 / ダウン取消 / dunning Smart Retries 8 attempts / Customer Portal 期末ダウン / 7 日 trial → 課金 (6 シナリオ、子 2 #2662 SSOT) | [tests/e2e/billing](tests/e2e/billing) 配下 (Phase 7 新規 dir) | Phase 7 Step 3 + Step 4 |
| **unit test** | lookup_key 解決ロジック + apiVersion bump + Webhook dedup + atom rename | [tests/unit/lib/server/stripe](tests/unit/lib/server/stripe) 配下 / [tests/unit/lib/domain](tests/unit/lib/domain) 配下 | 各 step |
| **integration test** | Webhook dedup table 経由の冪等性 + `subscription_schedule.aborted` 新 event handler + `archived_reason='dunning_canceled'` 物理書込み | `tests/integration/stripe-webhook-*.test.ts` glob (新規) | Step 4-a + Step 4-b |
| **migration test** | 既存 NULL `archived_reason` レコード → `'downgrade_user_selected'` 補充 | [tests/integration/db/archived-reason-migration.test.ts](tests/integration/db/archived-reason-migration.test.ts) (新規、子 4 §7.2) | Step 1 |
| **Storybook** | hybrid confirm UI (Preview API 結果表示) + ArchivedResourceBanner 5 mode 不表示 | Phase 3 #2573 + #2575 連動 | Step 2 + Step 3 |
| **e2e legacy URL redirect** | `/admin/license` → `/admin/subscription` 永久リダイレクト | `tests/e2e/legacy-url-redirect.spec.ts` (既存拡張) | Step 2-3 |

詳細 test 計画は子 2 #2662 (Test clock 6 シナリオ) を参照。本 docs では step 単位の test 配置のみ示す。

## 12. 影響範囲事後検証 (本 PR scope、§12)

| 項目 | 内容 |
|---|---|
| **本 PR 変更ファイル** | 新規 1 ファイル: `docs/design/billing-redesign/phase6-phase7-execution-ssot.md` |
| **着手前見積** | 推定 400-500 行 (Phase 6 子 5 件中、最も大きい順序 SSOT) |
| **実際の影響範囲** | docs 設計のみ、コード変更ゼロ。Phase 7 実装 PR (Step 1-5) で参照される SSOT |
| **乖離度** | 0% (見積通り) |
| **L1-L4 防御** | L1 (構文): 本 PR では既存コード参照なし、Phase 7 実測予測のみ記載 / L2 (意味): `'family'` 同名異義 + env var 3 系統を明文化 / L3 (構造): mermaid flowchart で全体 sequence 図示 / L4 (派生 artifact): 21 カテゴリ checklist 主要項目記載 |

## 13. 関連 (§13、2026-05-29 整合)

### Phase 1 (上位要件)
- [phase1-license-key-removal-final-requirements](phase1-license-key-removal-final-requirements.md) — **Phase 1 補強 3 (#2788、license key 完全全廃、Step 0 PR-L0〜L5 の元、FR-5 自己矛盾訂正)**
- [naming-url-integrity-requirements](phase1-naming-url-integrity-requirements.md) — Phase 1 補強 1 (`/admin/license` → `/admin/subscription` rename、Step 2-3 整合。FR-5 は補強 3 で訂正済)
- [plan-naming-pricing-axis-requirements](phase1-plan-naming-pricing-axis-requirements.md) — Phase 1 補強 2 (family → premium rename + 月額のみ、Step 2-4 整合)
- [checkout-requirements](phase1-checkout-requirements.md) — Phase 1 checkout (lookup_key 参照、Step 3 整合)
- [dunning-requirements](phase1-dunning-requirements.md) — Phase 1 dunning (webhook 冪等性、Step 4 整合)

### Phase 2 (UX ジャーニー)
- [checkout-journey](phase2-checkout-journey.md) — Reverse Trial パターン C
- [plan-change-journey](phase2-plan-change-journey.md) — Tier Change + Notion 型 Pattern A

### Phase 5 (アーキ、全 5 子)
- [phase5-stripe-product-architecture](phase5-stripe-product-architecture.md) (子 1 #2639) — Step 3 + Step 4 の元情報
- [phase5-proration-architecture](phase5-proration-architecture.md) (子 2 #2640) — Step 3 + Step 4 の Preview API
- [phase5-webhook-idempotency-architecture](phase5-webhook-idempotency-architecture.md) (子 3 #2641) — Step 1 + Step 4 の dedup table
- [phase5-archive-unified-architecture](phase5-archive-unified-architecture.md) (子 4 #2642) — Step 1 の `archived_reason` enum
- [phase5-atom-ssot-architecture](phase5-atom-ssot-architecture.md) (子 5 #2643) — **Step 2 内部の 5 sub step SSOT (本 docs では順序の全体図のみ、詳細は子 5 §6 参照)**

### Phase 6 同位 (本 PR 関連子 issue)
- 本 PR (#2661) は Phase 6 グループ A 最優先 (他子 #2662 / #2663 / #2664 / #2665 の前提)
- 子 2 #2662 (Test clock 6 シナリオ詳細設計、グループ B)
- 子 3 #2663 (DB migration script 詳細設計、グループ B)
- 子 4 #2664 (文脈判断 6 件 + lookup_key 段階移行 + API version bump、グループ B)
- 子 5 #2665 (ロールバック詳細 + kill switch SSOT + Phase 1 構造的欠落 3 件、グループ C)

### Phase 7 (実装、本 PR の落とし先)
- #2531 (Phase 7 実装) — 本 docs を参照して 5 step 統合 PR を実行
- #2627 (Stripe Dashboard PO 手動操作) — 本 docs §4 timeline マトリクス整合

### ADR (関連)
- ADR-0010 (Pre-PMF、最小構成 kill switch、LaunchDarkly 不採用)
- ADR-0012 (Anti-engagement、lock-in 罠回避)
- ADR-0014 (OSS 先調査、Stripe 公式 5 phase + 自前 env var の組合せ)
- ADR-0020 (PR size ≤ 500 行、5 step 分割の根拠)
- ADR-0031 (DB migration 互換、Step 1)
- ADR-0045 (atom / compound、Step 2)
- ADR-0049 (retention、Step 1 + Step 4 の 30 日 cleanup)

### memory (関連)
- [[per-issue-execution-workflow]] — 6 観点 + git workflow
- [[impact-analysis-methodology]] — 4 layer 防御 + 21 カテゴリ
- [[branch-base-main-freshness]] — main 最新化 + push 前 rebase
- [[pr-body-encoding-powershell-stdin]] — Bash here-doc UTF-8
- [[pause-and-replan-on-stuck]] — 詰まり時立ち戻り 4 ステップ
- [[pr-review-recurring-blocks]] — QM BLOCK 予防 4 項目
- [[billing-critical-extra-caution]] — 課金は Bucket A でもさらに別格
- [[adr0010-interpretation]] — Pre-PMF は「過剰追加」回避、品質を削る口実ではない
- [[root-design-blind-spot]] — license key 23 回失敗の構造的再発防止
- [[deep-research-product-specific]] — 自プロダクト固有の問いに focus

## 14. 根拠 (primary source、§14)

### Stripe 公式 (Phase 5 子 1 deep-research 14 URL 再利用 + Phase 6 5 phase migration 追加)

- [Stripe migrate-snapshot-to-thin-events (5 phase migration)](https://docs.stripe.com/webhooks/migrate-snapshot-to-thin-events) — 本 docs §5 の元
- [Stripe API versioning (72h rollback window)](https://docs.stripe.com/api/versioning) — Step 3 apiVersion bump
- [Stripe webhooks (handle duplicate events / at-least-once delivery)](https://docs.stripe.com/webhooks#handle-duplicate-events) — Step 4 dedup
- [Stripe build-subscriptions (lookup_key recommended pattern)](https://docs.stripe.com/billing/subscriptions/build-subscriptions) — Step 3 lookup_key
- [Stripe manage-prices (transfer_lookup_key)](https://docs.stripe.com/products-prices/manage-prices) — Step 3 lookup_key 段階移行
- [Stripe Customer Portal Configure (期末ダウン公式制約)](https://docs.stripe.com/customer-management/configure-portal) — Step 4 + #2627 領域 B + E
- [Stripe Subscription Schedules (phases / release)](https://docs.stripe.com/billing/subscriptions/subscription-schedules) — Step 3 + Step 4 (子 1 §3.3 整合)
- [Stripe Test clocks API (advance / 2 interval)](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage) — 子 2 #2662 連動
- [Stripe import-subscriptions-toolkit (10h rollback window)](https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit) — Step 4 ロールバック判断基準

### 業界根拠 (Phase 6 計画書 v2 §「業界根拠 primary source 22 URL」より抜粋)

- IEEE 1016-2009 SDD 12 viewpoints / Sommerville Software Engineering Ch.6 (HLD = Phase 5 vs LLD = Phase 6 三段階)
- LaunchDarkly / Unleash (feature flag kill switch、本 PR では Pre-PMF 過剰防衛として不採用)
- Vercel Rolling Releases (gradual rollout に類似)
- Atlassian spec-first / SAFe Spike / Thoughtbot Design Spike

### 自プロダクト関連
- [Phase 6 計画書 v2](../../../tmp/reviews/phase6-execution-plan.md) — 本 PR の起点
- [Phase 5 子 1 deep-research](../../../tmp/reviews/phase5-stripe-product-research.md) — Stripe 公式 14 URL の verbatim 検証済 SSOT
- Phase 1 補強 1 + 補強 2 (`phase1-naming-url-integrity-requirements.md` + `phase1-plan-naming-pricing-axis-requirements.md`)
- Phase 5 子 5 [phase5-atom-ssot-architecture.md §6](phase5-atom-ssot-architecture.md) — Step 2 内部 5 sub step SSOT
