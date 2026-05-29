# Stripe Product / Price 構成設計 (1 Product 2 Price + lookup_key) — Epic #2525 Phase 5 子 1

| 項目 | 内容 |
|------|------|
| 孫 issue | #2639 (Phase 5 子 1 — Stripe Product / Price 構成設計) |
| 親 | #2530 (Phase 5 アーキ) / Epic #2525 |
| 上位 (Phase 1) | #2535 (plan-change) / #2534 (checkout) / Phase 1 補強 2 (plan-naming-pricing-axis) |
| ステータス | 設計確定 (deep-research: Stripe 公式一次 14 URL 検証済 → 本 PR で docs 確定、コード変更は Phase 7) |
| Phase 7 連動 | UI rename (#2567-2575) / Preview API hybrid confirm / Webhook 更新 |
| 起点 | Phase 1 plan-change Open question 1 (「Phase 5 で Dashboard 構成を確認・再設計」) と Phase 1 補強 2 (年額廃止 + プレミアム rename) の合流地点 |
| 担当 PO 手動操作 | #2627 (Stripe Dashboard 物体作成) |

## 1. 設計背景

### 1.1 課題: 現行 4 Price 構成は Phase 1 plan-change FR-2 を成立させられない

現行 (`src/lib/server/stripe/config.ts`:39-70) は `STRIPE_PRICE_STANDARD_MONTHLY` / `_STANDARD_YEARLY` / `_FAMILY_MONTHLY` / `_FAMILY_YEARLY` を環境変数直読する。Stripe Dashboard 側は **standard と family が別 Product で作成された可能性が高い** (Phase 1 plan-change Open question 1)。

[Phase 1 plan-change](phase1-plan-change-requirements.md) §最重要制約 で確定したとおり:

> **Customer Portal の「ダウングレード管理 (期末適用)」は同一 Product 内の Price 間のみ機能する。** family と standard が別 Stripe Product だと Portal 期末ダウングレードが効かず、ダウングレードが即時化して credit proration 事故を招く。

別 Product のまま放置すると、family→standard ダウングレードが即時実行され、未消費期間の credit が発生し、Phase 1 plan-change FR-4 (「ダウングレードは期末適用」) が成立しない。

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

1. **ダウングレード credit proration 事故** (Phase 1 plan-change FR-4 不成立) — family→standard ダウンが即時実行され、未消費期間 credit が発生
2. **年額廃止が中途半端** (年額 Price 物体 + env var + webhook の撤去手順が散在、Phase 7 で工数爆発)
3. **価格改定時のリリース 2 段階化** (Dashboard 更新 + コード再 deploy が必須、SaaS 標準の lookup_key 経由なら deploy 不要)
4. **rename + Product 再構成 + 年額削除を同 PR で混ぜる** (rollback 困難、QA レビュー impossible、impact-analysis L4 派生 artifact 撤去手順が散在)

## 2. 設計原則

| 原則 | 内容 | 根拠 |
|------|------|------|
| **同一 Product 内 Price 構成** | standard / premium を同一 Stripe Product 配下の 2 Price として登録 | Stripe 公式: Portal 期末ダウングレードは同一 Product 内のみ機能 |
| **lookup_key 経由参照** | env var `STRIPE_PRICE_*` 直読を廃止、`prices.list({ lookup_keys })` でアプリ起動時に Price ID 解決 | Stripe 公式 build-subscriptions / 価格改定時コード変更ゼロ |
| **月額のみ (年額廃止)** | Phase 1 補強 2 FR-2 整合、`interval: 'month'` のみ | Spotify Family 2026 廃止 / 27% monthly-only / ADR-0012 lock-in 回避 |
| **tax_behavior 統一** | inclusive (税込) を全 Price で統一 | Stripe 公式: Portal ダウン UI 表示の前提条件 |
| **段階的 Dashboard 移行** | 旧 4 Price は Phase 7 マージまで archive せず、新 Price 作成 → コード切替 → 旧 archive の順 | Phase 7 ロールバック余地確保 |
| **API version 月次 bump** | `2026-04-22.dahlia` → `2026-05-27.dahlia` (本 PR で同梱) | Stripe 公式 versioning policy 72 時間 rollback window |
| **副次制約 3 件 明文化** | tax_behavior 一致 / subscription_schedule 既存時の Portal ロック / subscription_schedule.aborted ベストプラクティス | Phase 1 設計時未拾い、Phase 3 hybrid confirm UI に反映 |

## 3. 確定案: 1 Product 2 Price + lookup_key

### 3.1 Stripe Dashboard 構成

| Product | Prices (2 件) | lookup_key | unit_amount | currency | recurring | tax_behavior |
|---|---|---|---|---|---|---|
| `がんばりクエスト サブスクリプション` | スタンダード月額 | `standard_monthly` | 500 | jpy | `interval: month` | `inclusive` |
| 同上 | プレミアム月額 | `premium_monthly` | 780 | jpy | `interval: month` | `inclusive` |

**Product metadata** (任意):
- `app_id: ganbari-quest`
- `created_by_phase: phase7-2531`

**Price metadata** (任意):
- `plan_tier: standard | premium`
- `phase1_requirement: phase1-plan-naming-pricing-axis-FR-2-monthly-only`

### 3.2 Customer Portal 設定

| 設定項目 | 値 | 根拠 |
|---|---|------|
| `subscription_update.enabled` | `true` | Phase 1 plan-change FR-1 (4 パターン中の 2 パターン: standard↔premium) |
| `subscription_update.default_allowed_updates` | `['price']` | Price 間切替のみ許可 (quantity/promotion_code は対象外) |
| `subscription_update.proration_behavior` | `'none'` | ダウングレード時の credit 発生抑制 (期末適用と組合せ) |
| `subscription_update.schedule_at_period_end` | `true` | Portal でダウングレード操作時に自動で subscription_schedule 作成、期末適用 |
| `subscription_cancel.enabled` | `true` | Phase 1 cancellation 整合 |
| `subscription_cancel.mode` | `at_period_end` | Phase 1 cancellation FR-2 整合 |
| `subscription_cancel.proration_behavior` | `'none'` | 解約時 credit 発生抑制 |
| `customer_update.allowed_updates` | `['email', 'tax_id']` | PII 最小化 (Phase 1 security FR-3) |
| `payment_method_update.enabled` | `true` | dunning grace period 中の更新動線 |
| `invoice_history.enabled` | `true` | 顧客の請求履歴閲覧 (法定要求でなく利便性) |
| `features.business_profile.privacy_policy_url` | `https://ganbari-quest.com/legal/privacy` | Phase 1 legal 整合 |
| `features.business_profile.terms_of_service_url` | `https://ganbari-quest.com/legal/terms` | 同上 |

### 3.3 アップ / ダウン API パターン (Phase 7 stripe-service.ts 拡張、本 PR は設計のみ)

| 操作 | API 呼び出し | proration_behavior | end_behavior |
|---|---|---|---|
| **アップ即時** (standard → premium) | `subscriptions.update(subId, { items: [{ id, price: premium_monthly_id }], proration_behavior: 'always_invoice' })` | `'always_invoice'` (差額即時請求) | n/a |
| **ダウン期末** (premium → standard) | `subscriptionSchedules.create({ from_subscription: subId, phases: [...] })` の phase 2 で `price: standard_monthly_id` | `'none'` | `'release'` |
| **ダウン取消** (期末ダウン予約のキャンセル) | `subscriptionSchedules.release(scheduleId)` | n/a | n/a |
| **差額表示** (Phase 3 hybrid confirm UI) | `invoices.createPreview({ subscription, subscription_details: { items: [...] }, subscription_proration_date })` | n/a | n/a |

### 3.4 API version bump

| 項目 | 現行 | 新 |
|---|---|---|
| `src/lib/server/stripe/client.ts:8` | `'2026-04-22.dahlia'` | `'2026-05-27.dahlia'` |

[Stripe 公式 API versioning](https://docs.stripe.com/api/versioning) より、dahlia 月次 bump は 72 時間 rollback window が確保される。本 PR で同梱する理由:

- Phase 7 で Webhook を新規作成する際の `default_api_version` と SDK の `apiVersion` を一致させるため (mismatch 時に webhook event の field 構造が異なり処理エラー)
- 月次 bump は accumulate すると 6 ヶ月後の Epic 完遂時に 6 versions 分の breaking change を一度に飲む羽目になる

## 4. 副次制約 3 件 (Phase 1 設計時未拾い、本 PR で補強)

### 4.1 tax_behavior 一致 (Portal ダウン UI 表示条件)

Stripe 公式の change-price ドキュメントより:

> "new price has the same tax behavior as the initial price"

→ Dashboard で Price 作成時に **全 Price を `inclusive` (税込) で統一**する。混在時は Portal の price update UI が表示されない (Portal は内部的に tax_behavior 一致 Price のみ列挙する)。

**Phase 7 検証手順**:

1. Stripe Dashboard で全 Price の tax_behavior が `inclusive` であることを Dashboard UI で目視確認
2. テスト customer で Portal を開き、price update UI に 2 Price が両方表示されることを確認

### 4.2 subscription_schedule 既存時の Portal ロック

Stripe 公式より:

> "Customers can't update or cancel subscriptions that currently have an update scheduled"

→ 顧客が Portal で期末ダウングレード予約を作成した後、再度 Portal を開いても **subscription update / cancel の両方の UI が非表示** になる。顧客が「ダウン予約を取消したい」と思っても Portal から操作できない。

**自社 UI 誘導 (Phase 3 連動)**:

`/admin/subscription` (Phase 1 補強 1 rename 後) に、subscription_schedule 存在検出ロジックを追加:

```
if (hasActiveSchedule(subscription)) {
  banner: "○月○日にスタンダードに切替 (期末ダウン予約中)"
  CTA: "ダウン予約を取消" → POST /api/admin/subscription/cancel-pending
}
```

API 実装側 (Phase 7):

```typescript
// stripe-service.ts (Phase 7 で追加)
export async function cancelPendingDowngrade(subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.schedule) {
    await stripe.subscriptionSchedules.release(subscription.schedule as string);
  }
}
```

### 4.3 subscription_schedule.aborted ベストプラクティス

Stripe 公式より:

> "予期しないサブスクリプションの上書きを防ぐために、必ずベストプラクティスに従ってください"

主要 best practice (Phase 7 webhook 実装で反映):

1. **`subscription_schedule.aborted` event を subscribe**: schedule が予期せず終了した場合の検知
2. **subscription metadata に schedule_id を保存**: webhook event の整合性検証
3. **Phase transition 時の冪等処理**: 同一 phase 開始 event が複数回到達した場合の二重課金回避

webhook 購読 event リストに追加 (Phase 7 Dashboard 設定):

- `customer.subscription.updated` (現行)
- `customer.subscription.deleted` (現行)
- `subscription_schedule.aborted` (**新規**)
- `subscription_schedule.canceled` (**新規**)
- `subscription_schedule.completed` (**新規**)

## 5. Phase 7 実装手順 (8 step)

本 PR は docs アーキ設計のみ。実コード変更は Phase 7 (#2531) で実施。手順は Phase 5 → 7 のハンドオフ仕様として確定。

| Step | 作業 | 担当 | 検証 |
|---|---|---|---|
| 1 | **Test mode** Dashboard で新 Product + 2 Price (`standard_monthly` / `premium_monthly` lookup_key、`inclusive` 税込) + Portal config + Webhook (`disabled`) 作成 | PO 手動 (#2627) | Dashboard UI で目視 + Stripe CLI `stripe products list` |
| 2 | Phase 5 子 1 PR (本 PR、lookup_key 参照 + apiVersion bump コード変更含む統合 PR) を draft 起票 — **本 PR は docs のみ、コード変更は Phase 7 統合 PR で実施** | Dev | docs 設計確定 |
| 3 | Test clock シナリオ E2E 計画 (`tests/e2e/billing/upgrade.spec.ts` / `downgrade.spec.ts` / `cancel-pending.spec.ts`) | Dev | tests 追加計画ドキュメント |
| 4 | Phase 5 子 1 マージ (本 PR、docs アーキ確定) | Dev | QM Approve |
| 5 | **Production mode** Dashboard で同じ Product / 2 Price / Portal config / Webhook (`disabled`) 作成 | PO 手動 (#2627) | Dashboard UI で目視 |
| 6 | Phase 7 統合 PR マージ (UI rename (#2567-2575) + Phase 3 hybrid confirm (#2573) + lookup_key コード切替 + apiVersion bump + 新 webhook event 購読) | Dev | E2E + smoke test |
| 7 | 旧 4 Price archive、旧 Webhook disable | PO 手動 | Dashboard UI |
| 8 | 1 週間 smoke test → 旧 env var (`STRIPE_PRICE_*`) を `infra/cdk.json` / GitHub Secrets から削除 | Dev | CDK diff + deploy |

## 6. テスト計画 (Phase 7 一括実行)

| カテゴリ | テスト内容 | ファイル (新規) | 実行 phase |
|---|---|---|---|
| **Test clock E2E** | アップ即時 (standard → premium) で proration 差額が即時請求される | `tests/e2e/billing/upgrade-immediate.spec.ts` | Phase 7 |
| **Test clock E2E** | ダウン期末 (premium → standard) で期末まで premium capability 維持、期末に standard 適用 | `tests/e2e/billing/downgrade-at-period-end.spec.ts` | Phase 7 |
| **Test clock E2E** | ダウン予約中の Portal 操作ロック検出 + 自社 UI cancel-pending 経由解除 | `tests/e2e/billing/cancel-pending-downgrade.spec.ts` | Phase 7 |
| **unit test** | lookup_key 解決ロジック (`getPlans()` rewrite) で Stripe API mock | `tests/unit/server/stripe/config.test.ts` (拡張) | Phase 7 |
| **unit test** | apiVersion `2026-05-27.dahlia` 設定の確認 | `tests/unit/server/stripe/client.test.ts` (新規) | Phase 7 |
| **integration** | webhook `subscription_schedule.aborted` 受信時の DB 反映 | `tests/integration/stripe/webhook-schedule-aborted.test.ts` (新規) | Phase 7 |
| **Storybook (Phase 3 #2573)** | hybrid confirm UI で Preview API 結果表示 (upgrade / downgrade variant) | `src/lib/features/admin/SubscriptionConfirmModal.stories.svelte` (Phase 3 連動) | Phase 7 |

## 7. 影響範囲事後検証 (4 layer impact-analysis)

本 PR は **docs アーキ設計のみ** で新規 1 ファイル追加。L1-L4 影響範囲は最小だが、Phase 7 統合 PR に向けた **事前見積** として記録。

### L1: 構文 (grep + ast-grep)

| 検出パターン | 件数 (推定、Phase 7 で実測) |
|---|---|
| `STRIPE_PRICE_STANDARD_MONTHLY` / `_STANDARD_YEARLY` / `_FAMILY_MONTHLY` / `_FAMILY_YEARLY` env var 直読 | 4 件 (config.ts:42,49,56,63) |
| `apiVersion` 'dahlia' string | 1 件 (client.ts:8) |
| `'family'` / `'premium'` plan tier enum | Phase 1 補強 2 範囲 (95 件、本 PR scope 外) |

### L2: 意味 (型 / 同名異義)

- `STRIPE_PRICE_*` env var は infra/cdk Lambda function env / GitHub Actions Variables / .env.example の 3 系統 (同一名で物理的に異なる管理対象) — 撤去手順は Phase 7 step 8 で明文化
- `family` 同名異義: Phase 1 補強 2 で premium rename 対象 (本 PR scope 外、Phase 7 で同時実施)

### L3: 構造 (依存グラフ)

- `src/lib/server/stripe/config.ts` → `services/stripe-service.ts` → `routes/api/stripe/*` の 3 hop 依存。lookup_key 移行は config.ts 単体 rewrite で完結
- 副次的影響: `tests/unit/server/stripe/config.test.ts` の mock 構造変更 (Stripe API mock を導入)

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
| 17 | **deployment env / secrets** | **本 PR の Phase 7 step 8 対象** — `STRIPE_PRICE_*` を `infra/cdk.json` / Lambda env / GitHub Secrets から削除 |
| 18 | i18n platform | なし |
| 19 | fixture / seed / golden | tests/fixtures に Stripe price ID mock 追加 (Phase 7) |
| 20 | 過去 PR / commit / Issue / ADR | 検索性のため更新しない |
| 21 | audit log | なし (現在 active subscription 0 件) |

## 8. 想定リスク + ロールバック

| # | リスク | 対策 | ロールバック |
|---|---|---|---|
| R1 | Phase 7 マージ前に新 Webhook 有効化 → 旧 handler 404 | Phase 7 マージまで Webhook `disabled` で作成 (Step 1, 5) | Webhook disable のまま放置 (旧 Webhook が working 継続) |
| R2 | tax_behavior 不一致 → Portal ダウン UI 非表示 | Dashboard 作成時 `inclusive` で統一、Step 1 検証手順で目視確認 | Price 再作成 (immutable のため archive + 新規) |
| R3 | 顧客が subscription_schedule 作成済で Portal 再操作 → 反応しない (Stripe 仕様) | 自社 UI 誘導 (副次制約 4.2、Phase 3 #2573 連動) | 仕様、回避不能。自社 UI 誘導が唯一の解 |
| R4 | lookup_key 解決 Stripe API 障害 → アプリ起動失敗 | env var フォールバック (段階移行: Phase 7 step 6 で lookup_key + env var 両対応、Step 8 で env var 削除) | env var 直読の旧コードに revert |
| R5 | Webhook API version vs SDK apiVersion 乖離 | Dashboard Webhook 作成時 `2026-05-27.dahlia` 明示、SDK も同バージョンに bump | Dashboard Webhook の API version を SDK と一致するまで stage 戻し |
| R6 | 旧 4 Price archive 後に active subscription が残存 → 請求継続失敗 | Phase 1 補強 2 Open question 4 で「active subscription 0 件」を PO 確定済。Phase 7 step 7 直前に再確認手順を追加 | 旧 Price un-archive (Stripe API で再有効化) |
| R7 | apiVersion bump で Stripe Webhook event の field 構造変化 → 既存 handler 破壊 | Stripe Changelog `2026-04-22.dahlia` → `2026-05-27.dahlia` の差分を Phase 7 PR で精査、breaking change 該当箇所を webhook handler に反映 | apiVersion を旧版に revert (72 時間 rollback window 内) |

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

## 11. 既存実装の現状と変更点 (delta、2026-05-29 検証)

| # | 既存実装 (file:line) | 本要件 | 扱い |
|---|---|---|---|
| 1 | env var 直読 `process.env.STRIPE_PRICE_*` (`src/lib/server/stripe/config.ts`:42,49,56,63) | `prices.list({ lookup_keys: ['standard_monthly', 'premium_monthly'] })` 経由 | **変更** (Phase 7、本 PR は設計のみ) |
| 2 | apiVersion `'2026-04-22.dahlia'` (`src/lib/server/stripe/client.ts`:8) | `'2026-05-27.dahlia'` | **変更** (Phase 7、本 PR は設計のみ) |
| 3 | 4 種別 plan config (MONTHLY / YEARLY / FAMILY_MONTHLY / FAMILY_YEARLY、`config.ts`:41-69) | 2 種別 (standard_monthly / premium_monthly) | **変更** (Phase 1 補強 2 連動、Phase 7 で同時実施) |
| 4 | `docs/guides/stripe-setup-guide.md` 4 商品手動作成手順 (Step 3-2 〜 3-5) | 1 Product 2 Price + lookup_key 手順 | **変更** (Phase 7、本 PR は設計のみ) |
| 5 | webhook 購読 event 5 種 (`docs/guides/stripe-setup-guide.md` Step 5) | 8 種 (`subscription_schedule.*` 3 種追加) | **変更** (Phase 7、本 PR は設計のみ) |
| 6 | Customer Portal 設定 (`docs/guides/stripe-setup-guide.md` Step 4 簡易記載) | §3.2 の 11 項目詳細設定 | **変更** (Phase 7、本 PR は設計のみ) |
| 7 | `stripe-service.ts` createCheckoutSession (`src/lib/server/services/stripe-service.ts`:43-105) | `subscriptions.update` + `subscriptionSchedules.create/release` パターン拡張 | **拡張** (Phase 1 plan-change FR-3/FR-4 整合、Phase 7 実装) |

行位置は 2026-05-29 検証済。

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
