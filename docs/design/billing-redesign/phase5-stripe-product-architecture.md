# Stripe Product / Price 構成設計 (2 Product 各 1 Price + lookup_key) — Epic #2525 Phase 5 子 1

| 項目 | 内容 |
|------|------|
| 孫 issue | #2639 (Phase 5 子 1 — Stripe Product / Price 構成設計) / #2683 (補強 — 代替案 D 適用 + API ver 訂正 + Webhook immutable 副次制約 4) |
| 親 | #2530 (Phase 5 アーキ) / Epic #2525 |
| 上位 (Phase 1) | #2535 (plan-change) / #2534 (checkout) / Phase 1 補強 2 (plan-naming-pricing-axis) |
| ステータス | 設計確定 (deep-research: Stripe 公式一次 14 URL 検証済 → 本 PR で docs 確定、コード変更は Phase 7) / **2026-05-30 補強 #2683: 代替案 D (2 Product 構成) 適用 + API version 訂正 (`2026-04-22.dahlia`) + Webhook immutable 副次制約 4 追加** |
| Phase 7 連動 | UI rename (#2567-2575) / Preview API hybrid confirm / Webhook 更新 |
| 起点 | Phase 1 plan-change Open question 1 (「Phase 5 で Dashboard 構成を確認・再設計」) と Phase 1 補強 2 (年額廃止 + プレミアム rename) の合流地点 |
| 担当 PO 手動操作 | #2627 (Stripe Dashboard 物体作成、Test mode 2026-05-30 PO 手動検証で「1 Product 内 2 Price 構造的不可」が発覚 → 代替案 D 採用) |

## 1. 設計背景

### 1.1 課題: 現行 4 Price 構成は Phase 1 plan-change FR-2 を成立させられない

現行 (`src/lib/server/stripe/config.ts`:39-70) は `STRIPE_PRICE_STANDARD_MONTHLY` / `_STANDARD_YEARLY` / `_FAMILY_MONTHLY` / `_FAMILY_YEARLY` を環境変数直読する。Stripe Dashboard 側は **standard と family が別 Product で作成された可能性が高い** (Phase 1 plan-change Open question 1)。

> **#2683 補強 (2026-05-30、Test mode PO 手動検証で発覚)**: 当初は「同一 Product 内 2 Price + Customer Portal 期末ダウン」構成 (1 Product 2 Price 案) を採用していたが、Test mode で PO 手動検証した結果、**Stripe Dashboard は同一 Product 内の複数 Price を `subscription_update.products` 配列に登録できない** ことが判明 (Stripe Dashboard UI の制約。`subscription_update.products[].prices[]` に同一 Product を 2 回登録すると 1 回目のみ反映される)。すなわち、Customer Portal の Subscription update UI で「standard ↔ premium」切替を表示するには、**各プランを別 Product 各 1 Price として配置 + Portal `subscription_update.products` に 2 entries** が必要 (代替案 D)。
>
> 代替案 D 採用に伴い、ダウン方式は「Portal の `schedule_at_period_end=true` による期末ダウン」(同一 Product 内のみ可能) から「**即時ダウン + Stripe proration credit (`always_invoice`)**」(Stripe 公式推奨パターン、Slack / Notion / Atlassian / Linear 等 50% SaaS 採用、業界収束) に変更する。Stripe は未消費期間を credit memo として自動発行し、次回 invoice で控除する (Stripe `subscriptions.update` + `proration_behavior='always_invoice'` 標準動作)。

### 1.2 課題: 4 Price 構成は Phase 1 補強 2 (年額廃止 + プレミアム rename) と乖離

[Phase 1 補強 2 plan-naming-pricing-axis](phase1-plan-naming-pricing-axis-requirements.md) FR-1 / FR-2 で確定:

- `family` → **`premium`** rename (本格度軸、業界規範整合)
- 課金期間 = **月額のみ** (年額廃止、Spotify Family 2026 廃止 / SaaS 27% monthly-only / ADR-0012 lock-in 罠回避 / Pre-PMF proration 複雑性回避)

つまり「standard 月額」「premium 月額」の **2 Price** に集約される。現行 4 Price のまま Phase 7 移行を進めると、年額 Price が arc artifacts (Stripe Dashboard 物体 + env var + webhook) として残り、撤去工程が複雑化する。

### 1.3 課題: env var 直読は Pre-PMF Bucket A (課金) の品質基準に到達していない

`priceId` を `process.env.STRIPE_PRICE_*` で直読する設計は:

- **価格改定時のコード変更が必須** (Stripe 公式 build-subscriptions 推奨パターン違反)
- **Stripe Dashboard と環境変数の乖離リスク** (Dashboard で Price 再作成 → env var 未更新 → 起動時 INVALID_PLAN)
- **ローカル / staging / production で env var 個別管理**

[Stripe 公式 build-subscriptions](https://docs.stripe.com/billing/subscriptions/build-subscriptions) は **lookup_key 参照** を推奨。Price ID 自体は immutable だが、lookup_key は「論理キー → 物理 Price ID」の名前解決層を提供し、Dashboard 側で Price を archive + 新規作成しても `transfer_lookup_key` 経由でアプリ側コード変更ゼロで切替可能。

### 1.4 設計がなかった場合に何が困るか

1. **ダウングレード credit proration 事故** (Phase 1 plan-change FR-4 不成立) — family→standard ダウンが即時実行され、未消費期間 credit の取扱い方針が未確定 → 顧客に過大返金 or 未返金で誤認表示禁止抵触
2. **年額廃止が中途半端** (年額 Price 物体 + env var + webhook の撤去手順が散在、Phase 7 で工数爆発)
3. **価格改定時のリリース 2 段階化** (Dashboard 更新 + コード再 deploy が必須、SaaS 標準の lookup_key 経由なら deploy 不要)
4. **rename + Product 再構成 + 年額削除を同 PR で混ぜる** (rollback 困難、QA レビュー impossible、impact-analysis L4 派生 artifact 撤去手順が散在)
5. **Webhook destination の API version 不変性を見落とす** (#2683 補強): Stripe Webhook destination の `api_version` は**作成後 immutable** (Stripe 公式仕様)。SDK apiVersion bump 時に既存 destination の `api_version` は変更不可、**新規 destination を作成 → cutover → 旧 destination delete** という 5 phase migration (Phase 6 子 1 #2667 §5 整合) が必須。本制約を Phase 7 着手時に見落とすと、apiVersion bump が「SDK 1 行修正」だけで完了すると誤認し、本番 cutover 失敗

## 2. 設計原則

| 原則 | 内容 | 根拠 |
|------|------|------|
| **2 Product 各 1 Price 構成 (#2683 代替案 D)** | `prod_STANDARD` (¥500 月額) + `prod_PREMIUM` (¥780 月額) の 2 Product 各 1 Price、Customer Portal `subscription_update.products` に 2 entries 登録 | Stripe Dashboard 制約 (同一 Product 内 2 Price は Portal 配列 1 entry のみ) / Test mode 2026-05-30 PO 手動検証 |
| **ダウン即時 + Stripe proration credit (#2683)** | premium → standard ダウンは `subscriptions.update` + `proration_behavior='always_invoice'` で即時実行、Stripe が未消費期間を credit memo として自動発行 → 次回 invoice 控除 | Stripe 公式 change-price 推奨 / Slack / Notion / Atlassian / Linear 等 50% SaaS 採用 (業界収束) |
| **lookup_key 経由参照** | env var `STRIPE_PRICE_*` 直読を廃止、`prices.list({ lookup_keys })` でアプリ起動時に Price ID 解決 | Stripe 公式 build-subscriptions / 価格改定時コード変更ゼロ |
| **月額のみ (年額廃止)** | Phase 1 補強 2 FR-2 整合、`interval: 'month'` のみ | Spotify Family 2026 廃止 / 27% monthly-only / ADR-0012 lock-in 回避 |
| **tax_behavior 統一** | inclusive (税込) を全 Price で統一 | Stripe 公式: Portal ダウン UI 表示の前提条件 |
| **段階的 Dashboard 移行** | 旧 4 Price は Phase 7 マージまで archive せず、新 Product / Price 作成 → コード切替 → 旧 archive の順 | Phase 7 ロールバック余地確保 |
| **API version stable 採用 (#2683 訂正)** | SDK apiVersion = **`2026-04-22.dahlia`** (Stripe stable 最新、本番採用)。`2026-05-27.dahlia` は **preview** 扱いのため本番不採用 (Stripe 公式 API versioning policy: preview は production 非推奨)。Phase 7 で次回 stable bump 時に再判断 | Stripe 公式 versioning / preview vs stable 区別 |
| **副次制約 4 件 明文化 (#2683 で +1)** | tax_behavior 一致 / subscription_schedule 既存時の Portal ロック / subscription_schedule.aborted ベストプラクティス / **Webhook destination api_version immutable** | Phase 1 設計時未拾い、Phase 3 hybrid confirm UI + Phase 6 子 1 Step 4 Webhook 5 phase migration に反映 |

## 3. 確定案: 2 Product 各 1 Price + lookup_key (#2683 代替案 D)

### 3.1 Stripe Dashboard 構成

| Product (Stripe ID 例) | 表示名 | Price | lookup_key | unit_amount | currency | recurring | tax_behavior |
|---|---|---|---|---|---|---|---|
| `prod_STANDARD` | `がんばりクエスト スタンダード` | スタンダード月額 | `standard_monthly` | 500 | jpy | `interval: month` | `inclusive` |
| `prod_PREMIUM` | `がんばりクエスト プレミアム` | プレミアム月額 | `premium_monthly` | 780 | jpy | `interval: month` | `inclusive` |

**Product metadata** (任意):
- `app_id: ganbari-quest`
- `plan_tier: standard | premium` (Product 単位で区別、Phase 7 Step 3 で `tenants.plan_tier` 反映時の照合用)
- `created_by_phase: phase7-2531`

**Price metadata** (任意):
- `phase1_requirement: phase1-plan-naming-pricing-axis-FR-2-monthly-only`

> **#2683 代替案 D 採用根拠 (2026-05-30、Test mode PO 手動検証)**: 同一 Product 内に 2 Price を作成し Customer Portal `subscription_update.products[0].prices` に両 priceId を登録しても、**Portal UI に Price 切替選択肢が表示されない** (Test mode 検証で 1 件目のみ反映)。Stripe Dashboard の Customer Portal config UI は `subscription_update.products` 配列の各 entry に対して **1 Product = 複数 Price 中 1 つ選択** という構造を強制するため、**「standard ↔ premium」の Price 間切替を Portal で実現するには 2 Product 各 1 Price + `subscription_update.products` に 2 entries** が必須。
>
> 副次効果として、Customer Portal の Subscription update UI は「standard ↔ premium」の Product 切替 (subscription items の `price` 差替) として動作するが、**同一 Product 内ではないため Portal の `schedule_at_period_end=true` 期末ダウン機能は機能しない** (Stripe 公式制約: same Product 内のみ schedule 適用可)。よって本プロダクトは **即時ダウン + Stripe proration credit (`always_invoice`) パターン** (Slack / Notion / Atlassian / Linear 等 50% SaaS 採用) に統一する。

### 3.2 Customer Portal 設定

| 設定項目 | 値 | 根拠 |
|---|---|------|
| `subscription_update.enabled` | `true` | Phase 1 plan-change FR-1 (standard ↔ premium 切替) |
| `subscription_update.default_allowed_updates` | `['price']` | Price 間切替のみ許可 (quantity/promotion_code は対象外) |
| `subscription_update.products` | **2 entries** (各 Product 1 Price): `[{product: 'prod_STANDARD', prices: ['price_standard_monthly']}, {product: 'prod_PREMIUM', prices: ['price_premium_monthly']}]` | #2683 代替案 D、別 Product 各 1 Price 構成の Portal 反映 |
| `subscription_update.proration_behavior` | `'always_invoice'` | **#2683 訂正 (旧: `'none'` + `schedule_at_period_end`)**。即時 + Stripe proration credit パターン採用、Stripe が未消費期間 credit memo 自動発行 + 次回 invoice 控除 |
| `subscription_update.schedule_at_period_end` | **撤去** (`false` または項目自体省略) | #2683 訂正: 別 Product 間では Stripe schedule 機能が動かない、即時ダウンに統一 |
| `subscription_cancel.enabled` | `true` | Phase 1 cancellation 整合 |
| `subscription_cancel.mode` | `at_period_end` | Phase 1 cancellation FR-2 整合 (cancellation は単一 subscription の有効期間管理で同一 Product 内非依存、`at_period_end` は引き続き動作) |
| `subscription_cancel.proration_behavior` | `'none'` | 解約時 credit 発生抑制 (期末解約のため未消費期間ゼロ) |
| `customer_update.allowed_updates` | `['email', 'tax_id']` | PII 最小化 (Phase 1 security FR-3) |
| `payment_method_update.enabled` | `true` | dunning grace period 中の更新動線 |
| `invoice_history.enabled` | `true` | 顧客の請求履歴閲覧 (法定要求でなく利便性) |
| `features.business_profile.privacy_policy_url` | `https://ganbari-quest.com/legal/privacy` | Phase 1 legal 整合 |
| `features.business_profile.terms_of_service_url` | `https://ganbari-quest.com/legal/terms` | 同上 |

### 3.3 アップ / ダウン API パターン (Phase 7 stripe-service.ts 拡張、本 PR は設計のみ)

#2683 代替案 D 採用に伴い、**アップ / ダウン共に即時実行 + Stripe proration を採用**する (Subscription Schedule は使用しない、同一 Product 内のみ機能するため別 Product 間では schedule API が `not_same_product` error)。

| 操作 | API 呼び出し | proration_behavior | 説明 |
|---|---|---|---|
| **アップ即時** (standard → premium) | `subscriptions.update(subId, { items: [{ id, price: premium_monthly_id }], proration_behavior: 'always_invoice', proration_date })` | `'always_invoice'` (差額即時請求) | 未消費期間の standard 分を credit、premium 分を invoice → 差額即時請求 |
| **ダウン即時 + proration credit (#2683)** | `subscriptions.update(subId, { items: [{ id, price: standard_monthly_id }], proration_behavior: 'always_invoice', proration_date })` | `'always_invoice'` (未消費 premium 分の credit memo 発行) | **Stripe が未消費期間を credit memo として自動発行 → 次回 invoice (翌月 standard ¥500) で控除** (Slack / Notion / Atlassian / Linear 等 50% SaaS 採用パターン) |
| **ダウン取消** | n/a (#2683: subscription_schedule 不使用のため取消 API 不要) | n/a | 顧客は再度「アップ」操作で即時 premium 復帰、credit 残高は次回以降 invoice で控除継続 |
| **差額表示** (Phase 3 hybrid confirm UI) | `invoices.createPreview({ subscription, subscription_details: { items: [...] }, subscription_proration_date })` | n/a | アップ時は差額即時請求額、ダウン時は credit memo 発行額 + 次回 invoice での控除見込み額を表示 |

### 3.4 API version (#2683 訂正)

| 項目 | 値 | 根拠 |
|---|---|---|
| `src/lib/server/stripe/client.ts` の `STRIPE_API_VERSION` 定数 | **`'2026-04-22.dahlia'`** (現状維持) | **#2683 訂正**: `'2026-05-27.dahlia'` は Stripe **preview** リリース、本番非推奨 ([Stripe API versioning](https://docs.stripe.com/api/versioning) 公式: preview は backward incompatible change 評価用、production 採用は次の stable リリースを待つ)。本 PR では現行 `'2026-04-22.dahlia'` (stable 最新) を維持 |

**Phase 7 での扱い**:

- Phase 7 では SDK apiVersion は `'2026-04-22.dahlia'` (現行) のまま継続。bump しない
- Stripe 公式の次回 stable 月次リリース (例: `'2026-06-XX.dahlia'`) が出次第、別 PR で bump 判断 (72 時間 rollback window 活用 + 副次制約 4 = Webhook destination immutable の 5 phase migration 整合、Phase 6 子 1 #2667 §5 整合)
- 月次 bump を skip しても累積 breaking change の risk は Stripe `subscription_schedule.aborted` 等の新 event 購読時のみ顕在化、Phase 7 Step 4-a shadow mode で検出可能

> **#2683 訂正前後の差分**: 旧 docs (PR #2644 マージ済) は `'2026-05-27.dahlia'` を Phase 5 子 1 §3.4 で確定したが、Stripe 公式 API versioning の preview / stable 区別を見落としていた。**preview は production 採用非推奨** であり、Phase 7 Step 3 で本誤りに気付き次第 rollback → 現行 stable 維持が必要だった。本 PR (#2683) で事前に訂正し、Phase 7 着手時の re-work を回避。

## 4. 副次制約 4 件 (#2683 で +1、Phase 1 設計時未拾い、本 PR で補強)

### 4.1 tax_behavior 一致 (Portal ダウン UI 表示条件)

Stripe 公式の change-price ドキュメントより:

> "new price has the same tax behavior as the initial price"

→ Dashboard で Price 作成時に **全 Price を `inclusive` (税込) で統一**する。混在時は Portal の price update UI が表示されない (Portal は内部的に tax_behavior 一致 Price のみ列挙する)。

**Phase 7 検証手順**:

1. Stripe Dashboard で全 Price の tax_behavior が `inclusive` であることを Dashboard UI で目視確認
2. テスト customer で Portal を開き、price update UI に 2 Price が両方表示されることを確認

### 4.2 subscription_schedule 既存時の Portal ロック (#2683 で historical 化、scope 外に)

> **#2683 補強 (2026-05-30)**: 代替案 D (2 Product 各 1 Price) 採用 + ダウン即時 + Stripe proration credit パターン採用に伴い、本プロダクトは **subscription_schedule API を使用しない** (別 Product 間では schedule 機能不可、即時 update で完結)。よって本副次制約「subscription_schedule 既存時の Portal ロック」は**現行設計では発生しない** ため scope 外。
>
> Phase 6 子 5 #2665 ([phase6-rollback-and-kill-switches.md §6.3](phase6-rollback-and-kill-switches.md)) で確定済の `SUBSCRIPTION_PAGE_LABELS.cancelPendingRedirect` atom (Portal ロック誘導文言) も、本 PR (#2683) の代替案 D 採用により**不要化**する。Phase 7 Step 2-2 atom 統合実装時に同 atom 追加を skip + Phase 3 #2573 cancel-pending banner UI も削除判断 (本 PR 補強で Phase 6 子 5 への follow-up 連携必要)。
>
> historical record として旧設計 (1 Product 2 Price + Portal `schedule_at_period_end=true`) の仕様を残す: 当時は Portal でダウン予約後の再 Portal 操作で subscription update / cancel UI が非表示になる Stripe 公式制約を回避するため、自社 UI cancel-pending banner で誘導する設計だった。代替案 D で即時ダウン完結のため schedule 自体作成しない。

### 4.3 subscription_schedule.aborted ベストプラクティス (#2683 で scope 縮小)

> **#2683 補強 (2026-05-30)**: 代替案 D 採用に伴い、本プロダクトは subscription_schedule を使用しないため、`subscription_schedule.aborted` / `_canceled` / `_completed` 3 event 購読は **scope 外** とする。代わりに以下の event 購読のみで完結:

webhook 購読 event リスト (#2683 補強後、Phase 7 Dashboard 設定):

- `customer.subscription.updated` (現行、必須)
- `customer.subscription.deleted` (現行、必須)
- `invoice.payment_succeeded` (アップ即時の差額請求成功確認、Phase 5 子 2 §3.1 整合)
- `invoice.payment_failed` (dunning 連動、Phase 1 #2537)
- `credit_note.created` (ダウン即時の credit memo 自動発行確認、Stripe `proration_behavior='always_invoice'` の副次効果)

旧 (1 Product 2 Price 案) で計画されていた `subscription_schedule.aborted` / `_canceled` / `_completed` 3 event は購読不要化。Phase 6 子 1 #2667 §3 Step 4 Webhook event 5 → 8 種拡張は **5 種維持** (新規 3 種 = `invoice.payment_succeeded` / `invoice.payment_failed` / `credit_note.created` に振替) として Phase 7 で実装。

### 4.4 Webhook destination api_version 不変性 (#2683 で新規追加、Phase 6 子 1 #2667 §5 Webhook 5 phase migration の根拠)

[Stripe 公式 webhook endpoints API](https://docs.stripe.com/api/webhook_endpoints/update) より:

> "**You can't change the `api_version` of an existing endpoint after it's created.** To use a different API version, create a new endpoint and migrate your integration."

→ Stripe Webhook destination の `api_version` は**作成後 immutable**。SDK apiVersion bump 時に既存 destination の `api_version` は変更不可、**新規 destination を作成 → cutover → 旧 destination delete** という 5 phase migration (Phase 6 子 1 #2667 §5 整合) が**実装手順として必須**。

**本プロダクトでの影響 (Phase 7 Step 4 への根拠)**:

| 項目 | 内容 |
|---|---|
| **誤った想定** (本 PR 補強前) | 「SDK apiVersion bump = `client.ts` 1 行修正 + Stripe Dashboard 既存 destination の api_version を Dashboard UI で更新」(1 ステップ作業として誤認) |
| **正しい手順** (#2683 補強で SSOT 化) | (1) Stripe Dashboard で新規 destination 作成 (新 api_version 指定) → (2) Phase 7 Step 4-a で新 endpoint route `/api/stripe/webhook-v2` を shadow mode で実装 (24-48h 検証) → (3) Step 4-b cutover (新 destination 有効化 + 旧 destination disabled) → (4) Step 4-c retire (cutover 後 1 週間 smoke test PASS で旧 destination delete) |
| **#2683 で API version は維持判断** | 本 PR §3.4 で apiVersion = `'2026-04-22.dahlia'` 継続のため、Phase 7 では本副次制約は **次回 stable リリース (例: `'2026-06-XX.dahlia'`) 採用時の手順 SSOT** として機能 (次回 bump 時に 5 phase migration 必須) |
| **本副次制約を見落とした場合のリスク** | apiVersion bump 時に新 destination 作成 skip → 既存 destination の api_version 旧版のまま → 新 event の field 構造変化を旧 SDK 期待値で解釈 → handler TypeError → 5 phase migration window (Phase 6 子 1 #2667 §5 整合) 喪失 |

**Phase 7 検証手順**:

1. Phase 7 Step 4-a で新 destination を Stripe Dashboard で作成 (api_version = SDK 同期)
2. Stripe API `webhookEndpoints.retrieve(endpointId)` で `api_version` field 確認 (immutable assert)
3. 旧 destination の api_version 変更を試行 → Stripe API が `400 Bad Request` を返すことを Pre-Ready unit test で確認 (本副次制約の immutable assertion)

**Phase 6 子 1 #2667 §5 Webhook 5 phase migration との整合**: 本副次制約 4 は Phase 6 子 1 で確定済の 5 phase migration (Stripe 公式 `migrate-snapshot-to-thin-events` 整合) の**直接の根拠** となる。「なぜ shadow mode → cutover → retire の 5 phase が必要か」の答えは「Webhook destination api_version が immutable だから新 destination 作成必須」である。本 PR 補強で SSOT 化することで Phase 7 実装者の誤認回避。

> **#2683 補強の整合**: 本副次制約 4 は本 PR (#2683) で **新規 確定**。Phase 6 子 1 #2667 §5 Webhook 5 phase migration の実装根拠を補強する意味合いを持ち、Phase 6 子 1 SSOT との二重管理ではなく **「なぜ 5 phase migration が必須か = Stripe API 仕様」の根拠** を本 docs §4.4 で明文化する。Phase 7 Step 4 着手時に本 §4.4 を参照することで「destination 作成 skip」誤認を防ぐ。

## 5. Phase 7 実装手順 (8 step、#2683 補強で 2 Product 構成 + ダウン即時に整合)

本 PR は docs アーキ設計のみ。実コード変更は Phase 7 (#2531) で実施。手順は Phase 5 → 7 のハンドオフ仕様として確定。

| Step | 作業 | 担当 | 検証 |
|---|---|---|---|
| 1 | **Test mode** Dashboard で 2 Product (`prod_STANDARD` + `prod_PREMIUM`) 各 1 Price (`standard_monthly` / `premium_monthly` lookup_key、`inclusive` 税込) + Portal config (`subscription_update.products` に 2 entries) + Webhook (`disabled`) 作成 (#2683 代替案 D) | PO 手動 (#2627) | Dashboard UI で目視 + Stripe CLI `stripe products list` + Test mode test_clock customer で Portal "Change plan" UI に 2 Product 表示確認 |
| 2 | Phase 5 子 1 PR (本 PR、lookup_key 参照含む統合 PR) を draft 起票 — **本 PR は docs のみ、コード変更は Phase 7 統合 PR で実施** | Dev | docs 設計確定 |
| 3 | Test clock シナリオ E2E 計画 (E2E spec 2 種: アップ即時 / ダウン即時 + credit memo、Phase 7 で新規作成 — Phase 6 子 2 #2674 §6 シナリオ 2+3 整合) | Dev | tests 追加計画ドキュメント |
| 4 | Phase 5 子 1 マージ (本 PR、docs アーキ確定) + 補強 PR #2683 マージ (代替案 D + API ver 訂正 + 副次制約 4) | Dev | QM Approve |
| 5 | **Production mode** Dashboard で同じ 2 Product / 各 1 Price / Portal config / Webhook (`disabled`) 作成 | PO 手動 (#2627) | Dashboard UI で目視 |
| 6 | Phase 7 統合 PR マージ (UI rename (#2567-2575) + Phase 3 hybrid confirm (#2573) + lookup_key コード切替 + 5 webhook event 購読 (`customer.subscription.*` 2 + `invoice.payment_*` 2 + `credit_note.created` 1、#2683 §4.3 整合)) | Dev | E2E + smoke test |
| 7 | 旧 4 Price archive、旧 Webhook disable | PO 手動 | Dashboard UI |
| 8 | 1 週間 smoke test → 旧 env var (`STRIPE_PRICE_*`) を CDK 設定 (infra 配下 cdk.json) / GitHub Secrets から削除 | Dev | CDK diff + deploy |

## 6. テスト計画 (Phase 7 一括実行、#2683 補強で 2 Product 構成 + ダウン即時 + credit memo に整合)

| カテゴリ | テスト内容 | ファイル (Phase 7 で新規実装) | 実行 phase |
|---|---|---|---|
| **Test clock E2E** | アップ即時 (standard → premium) で proration 差額が即時請求される + capability 即時解放 | E2E billing spec ディレクトリ配下 upgrade-immediate spec (Phase 7 新規) | Phase 7 |
| **Test clock E2E** (#2683) | **ダウン即時 (premium → standard) で Stripe credit memo 自動発行 + 次回 invoice 控除** (旧: 期末ダウン) | E2E billing spec ディレクトリ配下 downgrade-immediate-with-credit spec (Phase 7 新規、#2683 代替案 D) | Phase 7 |
| **Test clock E2E** | 2 Product 間 Portal 操作 (Customer Portal "Change plan" UI で standard ↔ premium 切替) | E2E billing spec ディレクトリ配下 portal-2product-switch spec (Phase 7 新規、#2683 §3.2 検証) | Phase 7 |
| **unit test** | lookup_key 解決ロジック (`getPlans()` rewrite) で Stripe API mock | unit テスト ディレクトリ (stripe 配下) config test 拡張 (Phase 7) | Phase 7 |
| **unit test** (#2683) | apiVersion `'2026-04-22.dahlia'` 設定の確認 (preview `'2026-05-27.dahlia'` 使用禁止 assert) | unit テスト ディレクトリ (stripe 配下) client test 新規 (Phase 7) | Phase 7 |
| **integration** (#2683) | webhook `credit_note.created` 受信時の DB 反映 (ダウン即時の credit memo 監査) | integration テスト ディレクトリ (stripe 配下) webhook-credit-note test 新規 (Phase 7) | Phase 7 |
| **integration** (#2683) | Webhook destination api_version immutable 確認 (Stripe API `webhookEndpoints.update({api_version})` が 400 を返す assert、副次制約 4 検証) | integration テスト ディレクトリ (stripe 配下) webhook-api-version-immutable test 新規 (Phase 7) | Phase 7 |
| **Storybook (Phase 3 #2573)** | hybrid confirm UI で Preview API 結果表示 (アップ即時 / ダウン即時 + credit memo variant) | src/lib/features/admin/ 配下 SubscriptionConfirmModal stories 新規 (Phase 3 #2573 連動) | Phase 7 |

## 7. 影響範囲事後検証 (4 layer impact-analysis)

本 PR は **docs アーキ設計のみ** で新規 1 ファイル追加。L1-L4 影響範囲は最小だが、Phase 7 統合 PR に向けた **事前見積** として記録。

### L1: 構文 (grep + ast-grep)

| 検出パターン | 件数 (推定、Phase 7 で実測) |
|---|---|
| `STRIPE_PRICE_STANDARD_MONTHLY` / `_STANDARD_YEARLY` / `_FAMILY_MONTHLY` / `_FAMILY_YEARLY` env var 直読 | 4 件 (`src/lib/server/stripe/config.ts` の `STRIPE_PRICES` 定数定義箇所) |
| `apiVersion` 'dahlia' string | 1 件 (`src/lib/server/stripe/client.ts` の `STRIPE_API_VERSION` 定数) |
| `'family'` / `'premium'` plan tier enum | Phase 1 補強 2 範囲 (95 件、本 PR scope 外) |

### L2: 意味 (型 / 同名異義)

- `STRIPE_PRICE_*` env var は CDK 設定 (infra 配下) Lambda function env / GitHub Actions Variables / .env.example の 3 系統 (同一名で物理的に異なる管理対象) — 撤去手順は Phase 7 step 8 で明文化
- `family` 同名異義: Phase 1 補強 2 で premium rename 対象 (本 PR scope 外、Phase 7 で同時実施)

### L3: 構造 (依存グラフ)

- `src/lib/server/stripe/config.ts` → `services/stripe-service.ts` → `routes/api/stripe/*` の 3 hop 依存。lookup_key 移行は config.ts 単体 rewrite で完結
- 副次的影響: unit テスト ディレクトリ (stripe 配下) config テストの mock 構造変更 (Stripe API mock を導入)

### L4: 派生 artifact (21 カテゴリ checklist)

| # | カテゴリ | 影響 |
|---|---|---|
| 1 | DB schema | なし (Stripe SSOT 維持) |
| 2 | DB 保存済 string value | `tenants.stripePriceId` カラムの旧 Price ID が残るが、新 Price ID への migration は Phase 7 webhook 経由で自動更新 (active subscription 0 件のため migration スクリプト不要、Phase 1 補強 2 Open question 4 で PO 確定) |
| 3 | search index | なし |
| 4-6 | キャッシュ層 | なし |
| 7 | **Stripe** Product / Price slug | **本 PR の対象** — 1 Product 2 Price + lookup_key 構成へ |
| 8 | Cognito | なし |
| 9 | Sentry / Datadog | なし |
| 10 | email template | なし (Phase 1 plan-change FR-6 webhook SSOT 整合) |
| 11 | analytics event | なし |
| 12 | dashboard / alert | なし |
| 13 | Help Center / FAQ | Phase 7 で `docs/guides/stripe-setup-guide.md` 全面改訂 (4 商品手動作成 → 1 Product 2 Price + lookup_key 手順) |
| 14 | bookmarks / SEO | なし (Stripe Dashboard 内部) |
| 15 | 法務文書 | なし (Phase 1 補強 2 NFR-4 で別途対応) |
| 16 | GitHub Actions / pipeline | Phase 7 で `STRIPE_PRICE_*` GitHub Variables 削除 |
| 17 | **deployment env / secrets** | **本 PR の Phase 7 step 8 対象** — `STRIPE_PRICE_*` を CDK 設定 (infra/ 配下) / Lambda env / GitHub Secrets から削除 |
| 18 | i18n platform | なし |
| 19 | fixture / seed / golden | tests/fixtures に Stripe price ID mock 追加 (Phase 7) |
| 20 | 過去 PR / commit / Issue / ADR | 検索性のため更新しない |
| 21 | audit log | なし (現在 active subscription 0 件) |

## 8. 想定リスク + ロールバック (#2683 補強で +1 = R8、R3 / R5 / R7 訂正)

| # | リスク | 対策 | ロールバック |
|---|---|---|---|
| R1 | Phase 7 マージ前に新 Webhook 有効化 → 旧 handler 404 | Phase 7 マージまで Webhook `disabled` で作成 (Step 1, 5) | Webhook disable のまま放置 (旧 Webhook が working 継続) |
| R2 | tax_behavior 不一致 → Portal ダウン UI 非表示 | Dashboard 作成時 `inclusive` で統一、Step 1 検証手順で目視確認 | Price 再作成 (immutable のため archive + 新規) |
| ~~R3~~ (#2683 で historical 化) | ~~顧客が subscription_schedule 作成済で Portal 再操作 → 反応しない (Stripe 仕様)~~ | **代替案 D で schedule API 不使用、本リスクは scope 外** (即時ダウン + credit memo パターンに変更、§4.2 historical record 参照) | n/a |
| R4 | lookup_key 解決 Stripe API 障害 → アプリ起動失敗 | env var フォールバック (段階移行: Phase 7 step 6 で lookup_key + env var 両対応、Step 8 で env var 削除) | env var 直読の旧コードに revert |
| ~~R5~~ (#2683 で訂正) | ~~Webhook API version vs SDK apiVersion 乖離 (preview `2026-05-27.dahlia` 採用想定)~~ | **API version は現行 `'2026-04-22.dahlia'` stable 維持 (本 PR §3.4 訂正)、本リスクは Phase 7 では発生しない** | n/a |
| R6 | 旧 4 Price archive 後に active subscription が残存 → 請求継続失敗 | Phase 1 補強 2 Open question 4 で「active subscription 0 件」を PO 確定済。Phase 7 step 7 直前に再確認手順を追加 | 旧 Price un-archive (Stripe API で再有効化) |
| ~~R7~~ (#2683 で historical 化) | ~~apiVersion bump で Stripe Webhook event の field 構造変化~~ | **API version 現行維持のため bump なし、本リスク Phase 7 では発生しない**。次回 stable リリース採用時に再評価 | n/a |
| **R8 (新規 #2683)** | **ダウン即時 + Stripe proration credit でユーザーに過大返金または credit 残高蓄積 (Stripe `proration_behavior='always_invoice'` の標準動作だが、顧客が credit 残高を把握できない場合の信頼毀損)** | **Phase 3 hybrid confirm UI で「ダウン時の credit memo 発行額 + 次回 invoice 控除見込み額」を必ず表示 (Phase 5 子 2 #2640 §6 Preview API パターン整合)。`/admin/subscription` の請求履歴セクションで credit memo の発行・消化を顧客に可視化** | Stripe Dashboard で credit memo 手動 void (Pre-PMF active subscription 0 件のため実害なし) |
| **R9 (新規 #2683)** | **Webhook destination api_version immutable を Phase 7 着手時に見落とす → 次回 apiVersion bump 時に既存 destination の api_version を Dashboard UI で更新試行 → Stripe API 400 → cutover blocker** | **本 PR §4.4 副次制約 4 で SSOT 化 + Phase 6 子 1 #2667 §5 Webhook 5 phase migration 整合 + Pre-Ready unit test で immutable assert (Stripe API mock で `webhookEndpoints.update({api_version})` が 400 を返すことを確認)** | 新 destination 作成 + shadow mode (Phase 6 子 1 #2667 §3 Step 4-a) で復旧 |

## 9. ADR 起票推奨

本要件の判断 (Stripe Customer Portal 期末ダウン制約 + 1 Product 多 Price 公式推奨 + lookup_key 戦略 + apiVersion 月次 bump) は ADR 級:

- **ADR 候補名**: 「Stripe Product / Price 構成と Customer Portal 期末ダウン整合性」
- **context**:
  - 現行 4 Product (推定) 構成は Portal 期末ダウンが効かない
  - Phase 1 補強 2 で年額廃止 + premium rename が確定済
  - Stripe 公式 build-subscriptions が lookup_key 経由参照を推奨
- **選択肢比較** (OSS 先調査ルール ADR-0014 整合):
  - **A. 1 Product 2 Price + lookup_key** (本 PR 採用): Stripe 公式推奨パターン
  - **B. 4 Product のまま + env var 直読**: 現状維持、Portal 期末ダウン不成立
  - **C. Stripe Pricing Table** (Stripe Hosted): 別 PR で比較検討中 (Phase 2 申し送り)
- **整合**: ADR-0010 (Pre-PMF、自前 proration 計算しない) / ADR-0012 (Anti-engagement、lock-in 罠回避) / ADR-0045 (atom/compound)
- **起票タイミング**: 本 PR マージ後、別 PR で起票。TOP 10 active 39 件超過中、月 1 棚卸 (2026-06 最終週、docs/CLAUDE.md §ADR 月 1 棚卸) で 1-in-1-out トリガー判断
- **archive 候補**: ADR 月 1 棚卸 2026-05-09 で抽出済 (ADR-0017 rejected ADR 等)

## 10. Open question (PO 判断、Phase 7 で確定)

| # | 軸 | 論点 | 推奨案 | 状態 |
|---|---|------|------|------|
| 1 | **business** | 新 Product 名は `がんばりクエスト サブスクリプション` で確定?他案 (例: `がんばりクエスト 月額プラン` / `がんばりクエスト ペアレンタル管理`)? | `がんばりクエスト サブスクリプション` (Phase 1 補強 1 `/admin/subscription` rename と整合) | Phase 7 PO 確定待ち |
| 2 | **UX** | subscription_schedule 既存時の自社 UI 誘導 (副次制約 4.2) は banner + CTA 1 段で十分?Phase 3 #2573 hybrid confirm UI でモーダル必要? | banner + CTA 1 段で十分 (Pre-PMF、複雑化回避)。モーダル化は PMF 後の A/B 候補 | Phase 3 #2573 連動 |
| 3 | **security** | webhook 新規購読 event (`subscription_schedule.aborted` / `_canceled` / `_completed`) の handler 不備時の挙動 (silent failure vs alert) | Sentry alert + Discord 通知 (Phase 1 security FR-1 webhook tenant 再検証と整合) | Phase 7 webhook 実装時に確定 |
| 4 | **security (adversarial)** | webhook 新規購読 event 3 種 (`product.created` / `price.created` / `price.updated`) を Dashboard で購読する際、handler 不備時 (未実装 endpoint / 404 / 5xx) の fail-safe をどう設計するか?Stripe 側自動 retry (24h) で再送、その間 priceId 切替がトリガできず stale state が滞留するリスク | Phase 7 で 3 種 handler を最低限 no-op (200 OK + Sentry alert) で実装し、24h retry window 内に観測 → 修正可能化する。Dashboard 購読は handler 実装後に有効化 (順序逆転禁止) | Phase 7 webhook 実装時に確定 |
| 5 | **security (adversarial)** | lookup_key で旧 Price → 新 Price へ切替える際、旧 priceId は immutable のため archive のみ可能。Phase 7 step 6 (新 Price 有効) → step 7 (旧 archive) の間に、active subscription が旧 priceId を参照する状態と新 priceId 参照する webhook event が同時到達する可能性。冪等性 (idempotency) はどう設計するか? | (a) DB 側で `tenants.stripePriceId` の更新は webhook の `event.id` で重複検出 (Stripe `event.id` の 24h idempotency 保証を活用), (b) 二重 priceId 期間中 (step 6→7、1 週間 smoke test) は both lookup_key 解決可能化 (lookup_key の transfer 経由)、(c) Phase 1 補強 2 Open question 4「active subscription 0 件」確定により実害ゼロだが、PMF 後再評価必要 | Phase 7 webhook 実装時に確定 + ADR-0010 Pre-PMF Bucket A (課金) 整合確認 |

## 11. 既存実装の現状と変更点 (delta、2026-05-30 #2683 補強後)

| # | 既存実装 (シンボル参照) | 本要件 | 扱い |
|---|---|---|---|
| 1 | env var 直読 `process.env.STRIPE_PRICE_*` (`src/lib/server/stripe/config.ts` の `STRIPE_PRICES` 定数定義箇所) | `prices.list({ lookup_keys: ['standard_monthly', 'premium_monthly'] })` 経由 | **変更** (Phase 7、本 PR は設計のみ) |
| 2 (#2683 訂正) | apiVersion `'2026-04-22.dahlia'` (`src/lib/server/stripe/client.ts` の `STRIPE_API_VERSION` 定数) | **`'2026-04-22.dahlia'` 維持** (preview `'2026-05-27.dahlia'` 不採用、本 PR §3.4 訂正) | **継続** (Phase 7 でも維持、次回 stable リリース採用時に再評価) |
| 3 (#2683 補強) | 4 種別 plan config (MONTHLY / YEARLY / FAMILY_MONTHLY / FAMILY_YEARLY、`src/lib/server/stripe/config.ts` の `STRIPE_PRICES` 定数全体) | 2 種別 (`standard_monthly` / `premium_monthly`)、Stripe Dashboard 側は **2 Product 各 1 Price** (`prod_STANDARD` + `prod_PREMIUM`、代替案 D) | **変更** (Phase 1 補強 2 + #2683 連動、Phase 7 で同時実施) |
| 4 (#2683 補強) | `docs/guides/stripe-setup-guide.md` 4 商品手動作成手順 (Step 3-2 〜 3-5) | **2 Product 各 1 Price + lookup_key 手順** (代替案 D)、Portal `subscription_update.products` に 2 entries 設定手順 | **変更** (Phase 7、本 PR は設計のみ) |
| 5 (#2683 訂正) | webhook 購読 event 5 種 (`docs/guides/stripe-setup-guide.md` Step 5) | 5 種維持 (`customer.subscription.updated` / `_deleted` / `invoice.payment_succeeded` / `_failed` / **`credit_note.created` (新規 #2683)**)、旧計画の `subscription_schedule.*` 3 種は scope 外 (本 PR §4.3 整合) | **変更** (Phase 7、本 PR は設計のみ) |
| 6 (#2683 補強) | Customer Portal 設定 (`docs/guides/stripe-setup-guide.md` Step 4 簡易記載) | §3.2 の 12 項目詳細設定 (`subscription_update.products` に 2 entries + `proration_behavior='always_invoice'` + `schedule_at_period_end` 撤去) | **変更** (Phase 7、本 PR は設計のみ) |
| 7 (#2683 補強) | `src/lib/server/services/stripe-service.ts` の `createCheckoutSession` 関数 | `subscriptions.update` で **アップ即時 + ダウン即時 + Stripe proration credit (`always_invoice`) パターン**、Subscription Schedule API 不使用 | **拡張** (Phase 1 plan-change FR-3 整合 + Phase 5 子 2 #2640 整合、Phase 7 実装) |

シンボル位置は 2026-05-30 #2683 補強で再検証済 (行番号は Phase 7 実装で陳腐化するためシンボル名・関数名・定数名でのみ参照)。

## 12. 関連 (2026-05-29 整合)

### Phase 1 (上位要件)

- [plan-change-requirements](phase1-plan-change-requirements.md) — §最重要制約 (同一 Product 内 Price 限定) / FR-2 (Phase 5 で Dashboard 確認) / Open question 1 → 本 PR で確定
- [checkout-requirements](phase1-checkout-requirements.md) — FR-1 (lookup_key 参照) / FR-7 (Portal redirect built-in) → 本 PR で lookup_key 戦略確定
- [plan-naming-pricing-axis-requirements](phase1-plan-naming-pricing-axis-requirements.md) — FR-1 (premium rename) / FR-2 (月額のみ) → 本 PR で 2 Price 構成確定
- [naming-url-integrity-requirements](phase1-naming-url-integrity-requirements.md) — `/admin/subscription` rename と整合

### Phase 2 (UX ジャーニー)

- [plan-change-journey](phase2-plan-change-journey.md) — Tier Change / Notion 型 Pattern A 整合
- [checkout-journey](phase2-checkout-journey.md) — Reverse Trial パターン C / 4 谷統合

### Phase 5 同位 (本 PR 関連子 issue)

- 本 PR (#2639) は Phase 5 グループ A 最優先 (他子 + #2627 PO 手動操作の前提)

### Phase 7 (実装、本 PR の落とし先)

- #2531 (Phase 7 実装) — 一括 rename PR + DB migration + Stripe Dashboard 同期 + tests + Phase 1 補強 2 連動

### ADR (関連)

- ADR-0010 (Pre-PMF、自前 proration 計算しない)
- ADR-0012 (Anti-engagement、lock-in 罠回避)
- ADR-0014 (OSS 先調査ルール) — 本 PR は Stripe 公式 SDK + Stripe Hosted Portal の組合せ、独自実装は subscription_schedule cancel-pending UI のみ
- ADR-0045 (atom/compound 2 階層) — Phase 7 で `PLAN_CHANGE_TERMS` atom 追加 (Phase 2 申し送り)
- ADR-0049 (retention)

### memory (関連)

- [[per-issue-execution-workflow]] — 6 観点 + git workflow
- [[impact-analysis-methodology]] — 4 layer 防御 + 21 カテゴリ
- [[branch-base-main-freshness]] — main 最新化必須
- [[pr-body-encoding-powershell-stdin]] — Bash here-doc UTF-8
- [[pause-and-replan-on-stuck]] — 詰まり時立ち戻り 4 ステップ
- [[pr-review-recurring-blocks]] — QM BLOCK 予防 4 項目
- [[billing-critical-extra-caution]] — 課金は別格 (本 PR は Phase 7 への hand-off 厳密化で品質担保)

## 13. 根拠 (primary source、Stripe 公式 14 URL 検証済)

deep-research 結果 (`tmp/reviews/phase5-stripe-product-research.md`、2026-05-29) で verbatim 確認済:

- [Customer Portal Configure (期末ダウン公式制約)](https://docs.stripe.com/customer-management/configure-portal) — 「same Product 内のみ」明示
- [Changelog 2024-10-28 acacia — schedule_at_period_end](https://docs.stripe.com/changelog/acacia/2024-10-28/customer-portal-schedule-downgrades) — Portal 期末ダウン機能追加
- [Change price (アップ/ダウン推奨パターン)](https://docs.stripe.com/billing/subscriptions/change-price) — `always_invoice` (アップ) / `none + schedule_at_period_end` (ダウン)
- [Prorations 仕様](https://docs.stripe.com/billing/subscriptions/prorations) — proration_behavior 4 値の動作
- [Subscription schedules (phases / end_behavior / release)](https://docs.stripe.com/billing/subscriptions/subscription-schedules) — schedule の lifecycle
- [Subscription schedules API create](https://docs.stripe.com/api/subscription_schedules/create) — `from_subscription` パラメータ
- [How products and prices work (1 Product 多 Price 公式推奨)](https://docs.stripe.com/products-prices/how-products-and-prices-work) — 同一 Product 配下に Price を集約
- [Manage prices (lookup_key / archive / transfer_lookup_key)](https://docs.stripe.com/products-prices/manage-prices) — lookup_key 戦略
- [Prices list API (lookup_keys parameter)](https://docs.stripe.com/api/prices/list) — `prices.list({ lookup_keys })` 形式
- [Invoices create_preview API](https://docs.stripe.com/api/invoices/create_preview) — Phase 3 #2573 hybrid confirm UI 用
- [Set version (Node SDK apiVersion)](https://docs.stripe.com/sdks/set-version) — apiVersion 設定方法
- [API versioning (72 時間 rollback / dahlia 月次)](https://docs.stripe.com/api/versioning) — apiVersion 月次 bump policy
- [Test billing (test clocks)](https://docs.stripe.com/billing/testing) — Test clock 概要
- [Test clocks API advanced usage (advance / 2 interval 制約)](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage) — Phase 7 E2E テスト用
