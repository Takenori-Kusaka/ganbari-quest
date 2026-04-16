# plan-change-flow.md — プラン変更フロー仕様 (#747)

> アップグレード（free→standard→family）とダウングレード（family→standard→free）、月額↔年額切替、および解約時の挙動を 1 か所にまとめた SSOT。実装は `/admin/license` ページと `/api/stripe/{checkout,portal,webhook}` に集約されている。

---

## 1. 全体像

| フロー | エントリ | 経路 | 終端 |
|--------|---------|------|------|
| **アップグレード (新規購入)** | `/admin/license` プラン選択カード | `POST /api/stripe/checkout` → Stripe Checkout (外部) → `checkout.session.completed` Webhook | success URL = `/admin/license?session_id=...` → PremiumWelcome 表示 |
| **アップグレード (プラン昇格)** | `/admin/license` 「プラン変更・支払い管理」 | PIN 確認 → `POST /api/stripe/portal` → Stripe Customer Portal → `customer.subscription.updated` Webhook | Portal の return URL = `/admin/license` → 新プラン反映 |
| **ダウングレード** | 同上（Customer Portal） | 同上 → Portal で下位プランに変更 → `customer.subscription.updated` Webhook | 同上 → 新プラン反映＋PlanStatusCard で超過リソースを警告 |
| **月額↔年額切替** | 同上（Customer Portal） | 同上（Stripe 標準 UI） | 同上 |
| **解約 (cancel)** | 同上（Customer Portal） | 同上 → Portal で「解約」 → `customer.subscription.deleted` Webhook | DB: `plan=undefined, status=suspended`（テナントは残る） |
| **支払い失敗** | Stripe (自動) | `invoice.payment_failed` Webhook | DB: `status=grace_period, planExpiresAt=now+7d` → 猶予期間中は機能維持 |
| **ライセンスキー適用** | `/admin/license` フォーム | `applyLicenseKey` action → `consumeLicenseKey` (Stripe を経由しない) | テナント plan を直接昇格、Stripe 課金は発生しない |

> **重要**: プラン昇降格と月年額切替は **Stripe Customer Portal に委譲** している (#771)。ただし解約については `/admin/settings` から `POST /api/v1/admin/tenant/cancel` を呼ぶアプリ内フローも存在する（#784: Stripe 即時キャンセル → `status=grace_period` + `planExpiresAt` 更新、30日間のデータ保持）。本ドキュメント §3 のスコープは `/admin/license` 経由の Customer Portal 操作に限定し、`/admin/settings` 経由の解約フローは [`account-deletion-flow.md`](account-deletion-flow.md) に記載する。

---

## 2. アップグレード — 新規購入（free → standard / family）

### 2.1 画面遷移

```
[/admin/license]
  ├─ 月額/年額タブ（billingInterval state）
  ├─ プランカード × 2（standard / family、ファミリーが「おすすめ」バッジ）
  └─ 「{プラン名}プランで始める」ボタン
        │
        ▼
  POST /api/stripe/checkout
   body: { planId: 'monthly' | 'yearly' | 'family-monthly' | 'family-yearly' }
        │
        ├─ 認可: role ∈ {owner, parent}（child は 403）
        ├─ tenantId: locals.context.tenantId（改ざん不可、サーバー署名付き）
        ├─ planId バリデーション: validPlanIds に含まれるか
        ▼
  createCheckoutSession()
        │
        ├─ Stripe Price ID を planId からマッピング (planId → price)
        ├─ success_url = ${origin}/admin/license?session_id={CHECKOUT_SESSION_ID}
        ├─ cancel_url  = ${origin}/pricing
        ▼
  { url: 'https://checkout.stripe.com/c/pay/...' }
        │
        ▼
  window.location.href = url   ← ブラウザを Stripe にリダイレクト
        │
        ▼
[Stripe Checkout（外部画面）]
        │
        ├─ 支払い方法入力 → 完了
        │   └─ 成功 → success_url にリダイレクト
        │       └─ 同時に Webhook: checkout.session.completed
        │
        └─ キャンセル → cancel_url (/pricing) にリダイレクト
            └─ Webhook 発火なし、DB は free のまま
```

### 2.2 Webhook 処理 — `checkout.session.completed`

`stripe-service.ts:handleCheckoutCompleted()`

1. `session.metadata.tenantId` を取得（Checkout 作成時に埋め込み済み）
2. `session.metadata.planId` を取得し `Tenant['plan']` にキャスト
3. `repos.auth.updateTenantStripe()` で以下を更新:
   - `stripeCustomerId`
   - `stripeSubscriptionId`
   - `plan` = 新プラン
   - `status` = `'active'`
   - `trialUsedAt` = now（トライアル消化済みフラグ）
4. **ライセンスキー発行 (#0247 / #801)**:
   - `issueLicenseKey({ kind: 'purchase', tenantId, plan, stripeSessionId, issuedBy })`
   - 発行されたキーをテナントに紐付け
   - Stripe Customer のメールアドレスへ `sendLicenseKeyEmail` で送信
   - キー発行失敗時も決済自体は成功扱い（手動補完可）
5. Discord 通知: `notifyBillingEvent(tenantId, 'checkout_completed', 'plan=...')`

### 2.3 PremiumWelcome モーダル表示

- success URL `/admin/license?session_id=...` への帰還時、admin の `+page.server.ts` (#743 §10.5) で次回ロード時に判定:
  - `isPaidTier(tier) && setting('premium_welcome_shown') !== 'true'` → モーダル表示
  - dismiss 時に setting を `'true'` に更新（テナントスコープ）

---

## 3. プラン変更 / ダウングレード / 解約 — Customer Portal 経由

### 3.1 PIN 確認ゲート (#771)

子供が親端末で誤操作するのを防ぐため、Portal 遷移前に二段階確認を必須化。

```
[/admin/license]
  └─ 「プラン変更・支払い管理」ボタン
        │
        ▼
  Dialog: showPortalConfirm = true
        │
        ├─ pinConfigured === true   → 親 PIN コード（4〜6桁数字）入力
        └─ pinConfigured === false  → 確認フレーズ「プランを変更します」入力
        │
        ▼
  「Stripe の管理画面を開く」確認ボタン
        │
        ▼
  POST /api/stripe/portal
   body: { pin: '1234' } または { confirmPhrase: 'プランを変更します' }
        │
        ├─ 認可: role ∈ {owner, parent}
        ├─ pinConfigured 分岐:
        │    pin あり → verifyPin()
        │      ├─ INVALID_PIN  → 401 INVALID_PIN
        │      ├─ LOCKED_OUT   → 423 LOCKED_OUT:{lockedUntil}
        │      └─ ok           → 続行
        │    pin なし → confirmPhrase === 'プランを変更します' でなければ 401
        ▼
  createPortalSession(tenantId, return_url=`${origin}/admin/license`)
        │
        ▼
  { url: 'https://billing.stripe.com/p/session/...' }
        │
        ▼
  window.location.href = url
```

### 3.2 Stripe Customer Portal で行える操作

| 操作 | Webhook | DB 反映 |
|------|---------|---------|
| プラン変更（standard ↔ family、月 ↔ 年） | `customer.subscription.updated` | `plan` を `planIdFromPriceId(item.price.id)` で更新、`status='active'` |
| サブスク解約（即時 or 期末） | `customer.subscription.deleted` | `stripeSubscriptionId=undefined, plan=undefined, status='suspended'` |
| 支払い方法更新 | （Stripe 側のみ） | DB 変更なし |
| 請求書履歴閲覧 | （Stripe 側のみ） | DB 変更なし |

### 3.3 Webhook 処理 — `customer.subscription.updated`

`stripe-service.ts:handleSubscriptionUpdated()`

1. `subscription.metadata.tenantId` か `findTenantBySubscription(subscription.id)` でテナント特定
2. `subscription.items[0].price.id` から `planIdFromPriceId()` で `Tenant['plan']` を解決
3. `subscription.status` を DB 用に正規化:
   | Stripe status | DB status |
   |---------------|-----------|
   | `active` / `trialing` | `'active'` |
   | `past_due` | `'grace_period'` |
   | その他 (`canceled` / `unpaid` / `incomplete_expired`) | `'suspended'` |
4. `repos.auth.updateTenantStripe()` で `plan, status` を保存
5. Discord 通知: `notifyBillingEvent(tenantId, 'subscription_updated', 'status=..., plan=...')`

### 3.4 Webhook 処理 — `customer.subscription.deleted`

`stripe-service.ts:handleSubscriptionDeleted()`

1. テナント特定（同上）
2. `repos.auth.updateTenantStripe()` で:
   - `stripeSubscriptionId` = undefined
   - `plan` = undefined
   - `status` = `'suspended'`
3. **重要**: テナント・子供データ・活動履歴は削除しない（解約と削除は別概念。アカウント削除は `/admin/settings` 経由 → `account-deletion-flow.md` 参照）
4. Discord 通知: `notifyBillingEvent(tenantId, 'subscription_deleted')`

---

## 4. 支払い失敗フロー（猶予期間）

### 4.1 Webhook 処理 — `invoice.payment_failed`

`stripe-service.ts:handlePaymentFailed()`

1. テナント特定
2. **猶予期間設定**: `GRACE_PERIOD_DAYS = 7` (`src/lib/server/stripe/config.ts`)
   ```ts
   const graceExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
   ```
3. `repos.auth.updateTenantStripe()` で:
   - `status` = `'grace_period'`
   - `planExpiresAt` = `graceExpires`
4. Discord 通知: `notifyBillingEvent(tenantId, 'payment_failed', '猶予期間: ...')`

### 4.2 ユーザー視点の挙動

- `/admin/license` の現在プラン表示で「⚠️ 猶予期間中」セクションが表示される
- プラン機能は維持される（=猶予期間中は引き続き standard/family の制限が適用）
- 7 日以内に支払い方法を更新 → Stripe が自動リトライ → `invoice.paid` Webhook で `status='active'` に復帰
- 7 日経過しても未払い → Stripe 側で `subscription.status='past_due' → 'unpaid'` 等に遷移 → `customer.subscription.updated` で `status='suspended'` に遷移
- `suspended` 状態では `/admin/license` に「⏸️ サービス停止中」セクションが表示される

### 4.3 リトライ・復帰

- Stripe Smart Retries に委譲（Stripe Dashboard 設定）
- 復帰経路: 支払い更新 → `invoice.paid` Webhook → `handleInvoicePaid()` で `status='active', plan=請求書から再解決` に戻す

---

## 5. ダウングレード時の超過リソース処理（#738 連動）

### 5.1 実装状況

**#738 で実装済み**。`/admin/license` の「プラン変更・支払い管理」ボタン押下時に、ダウングレード先プランの上限を���えるリソースがある場合は、Portal 遷移前にリソース選���ダイアログを表示する。

### 5.2 挙動

ダウングレード前確認ダイアログ（`DowngradeResourceSelector`）で:

| 項目 | 仕様 |
|------|------|
| 現在リソース表示 | 子供 N 人 / 活動 M 個 / 履歴保持 X 日 |
| ダウングレード先制限 | 子供 2 人 / 活動 3 個 / 履歴 90 日 (free) |
| 超過分 | 「N - 2 人分」「M - 3 個分」を明示 |
| 残すリソース選択 | チェックボックスで「残す」「アーカイブ」を選択 |
| アーカイブ動作 | `is_archived = true, archived_reason = 'downgrade_user_selected'`。物理削除しない |
| アップグレード時の復元 | `is_archived = false` に戻すだけで完全復元可能（既存の `restoreArchivedResources` が `trial_expired` を復元するのと同じ機構） |
| 履歴保持の警告 | 現在の保持日数 > 新プランの保持日数なら「古い履歴は閲覧不可になります」警告 |
| 超���なしの場合 | プレビューで超過なしなら選択画面をスキップし��直接 PIN 確認ダイアログへ進む |

### 5.3 ダウングレード経路のフロー

```
[/admin/license]
  └─ 「プラン変更・支払い管理」ボタン
        │
        ▼
  GET /api/v1/admin/downgrade-preview?targetTier=free
        │
        ├─ hasExcess === true
        │    └─ DowngradeResourceSelector ダイアログ表示
        │         │
        │         ├─ ユーザーがアーカイブするリソースを選択
        │         ├─ 「アーカイブしてプラン変更へ��む」ボタン
        │         ▼
        │    POST /api/v1/admin/downgrade-archive
        │      body: { targetTier, childIds, activityIds, checklistTemplateIds }
        │         │
        │         ├─ サーバーで is_archived を更新
        │         ├─ 残数が上限以内か検証��失敗→エラー返却）
        │         ▼
        │    成功 → PIN 確認ダイアログ (#771) へ進む
        │
        ├─ hasExcess === false
        │    └─ PIN 確認ダイアログへ直接進む
        ▼
  PIN 確認 → POST /api/stripe/portal → Customer Portal
```

### 5.4 API エンドポイント

| メソッド | パス | 認可 | 説明 |
|---------|------|------|------|
| GET | `/api/v1/admin/downgrade-preview?targetTier={free\|standard\|family}` | owner, parent | 超過リソースのプレビュー取得 |
| POST | `/api/v1/admin/downgrade-archive` | owner, parent | 選択したリソースのアーカイブ実行 |

### 5.5 実装ファイル

| ファイル | 役割 |
|---------|------|
| `src/lib/domain/downgrade-types.ts` | クライアント/サーバー共有型定義 |
| `src/lib/server/services/downgrade-service.ts` | プレビュー計算・アーカイブ実行 |
| `src/routes/api/v1/admin/downgrade-preview/+server.ts` | プレビュー API |
| `src/routes/api/v1/admin/downgrade-archive/+server.ts` | アーカイブ API |
| `src/lib/features/admin/components/DowngradeResourceSelector.svelte` | リソース選択 UI |
| `src/routes/(parent)/admin/license/+page.svelte` | フロー統合 |
| `tests/unit/services/downgrade-service.test.ts` | ユニットテスト |

---

## 6. 月額 ↔ 年額切替

### 6.1 新規購入時

`/admin/license` のプランカード上部にあるトグル (`billingInterval` state) で `monthly` ↔ `yearly` を切り替えてから購入ボタンを押す。`planId` は以下にマッピング:

| プラン × 期間 | planId | Stripe Price ID 取得元 |
|--------------|--------|----------------------|
| standard × monthly | `monthly` | `STRIPE_PRICE_STANDARD_MONTHLY` |
| standard × yearly | `yearly` | `STRIPE_PRICE_STANDARD_YEARLY` |
| family × monthly | `family-monthly` | `STRIPE_PRICE_FAMILY_MONTHLY` |
| family × yearly | `family-yearly` | `STRIPE_PRICE_FAMILY_YEARLY` |

年額は約 17% OFF（`¥500/月 → ¥5,000/年`、`¥780/月 → ¥7,800/年`）。

### 6.2 既存ユーザーの切替

Customer Portal 経由のみ。Portal 内の「プラン変更」UI から切り替える。Stripe が proration（日割り計算）を自動で実施する。

> **注意 (#786 連動)**: 「月額↔年額切替がどの画面から可能か不明」「proration の扱い未定義」と #786 で指摘されている。本ドキュメントの本セクションで「Customer Portal で実施・proration は Stripe 自動」を仕様として確定させた。UI 側の導線案内も #786 で改善予定。

---

## 7. ライセンスキー適用フロー（Stripe を経由しない昇格）

### 7.1 経路

`/admin/license` の「ライセンスキー適用」フォーム → `?/applyLicenseKey` action → `consumeLicenseKey` サービス。

```
[/admin/license]
  └─ 「ライセンスキーを適用」入力欄
        │
        ▼
  確認ダイアログ
        │
        ▼
  POST ?/applyLicenseKey  (form action)
        │
        ├─ 認可: requireRole(['owner'])  ← parent/child は 403
        ├─ validateLicenseKey(rawKey)
        │    └─ 形式・存在・状態（unused / not expired / not revoked）
        ▼
  consumeLicenseKey(rawKey, tenantId)
        │
        ├─ ライセンスを consumed にマーク
        ├─ tenant.plan を昇格
        ├─ tenant.planExpiresAt を設定（あれば）
        ▼
  { apply: { success: true, plan, planExpiresAt } }
        │
        ▼
  data リロード → PlanStatusCard / 現在のプラン表示が更新
```

### 7.2 Stripe との関係

- ライセンスキーは **Stripe を経由せず** プランを昇格させる
- 用途: キャンペーン配布 / サポート対応 / 法人顧客の請求書払い等
- consumed 後は同じキーを再利用不可（buyer_tenant にロック / #801）
- Stripe Subscription は発生しないため、`stripeSubscriptionId = undefined` のまま
- このため Customer Portal は使用不可（「サブスクリプション無し → プラン選択 UI」が表示される）
- 期限切れ時は `/api/cron/license-key-revoke` 等で自動失効（#821 で実装予定）

---

## 8. 状態マシン（簡略版）

```
                   ┌──────────────┐
                   │     free     │
                   └──────┬───────┘
                          │ checkout (購入)
                          │ or applyLicenseKey
                          ▼
                   ┌──────────────┐
        ┌─────────►│   standard   │◄─────────┐
        │          └──────┬───────┘          │
        │                 │ Portal でアップ  │
        │                 │ (webhook updated)│
        │                 ▼                  │
        │          ┌──────────────┐          │
        │          │    family    │          │
        │          └──────┬───────┘          │
        │                 │ Portal でダウン  │
        │                 │ (webhook updated)│
        │                 └──────────────────┘
        │
        │ 解約 (subscription.deleted)
        │ → status=suspended, plan=undefined
        ▼
   ┌──────────────┐
   │  suspended   │  ※ free 機能に縮退
   └──────────────┘

[並行] payment_failed → status=grace_period, planExpiresAt=now+7d
        │
        ├─ invoice.paid 受信 → status=active に戻る
        └─ 7d 経過＆未払い → suspended に遷移
```

詳細な画面遷移は [`diagrams/plan-change-flow.drawio`](diagrams/plan-change-flow.drawio) を参照。

---

## 9. 確認 UX サマリ

| アクション | 確認 UX | 理由 |
|-----------|---------|------|
| 新規購入 | プラン選択 → 「{プラン}プランで始める」→ Stripe Checkout でカード入力 | Stripe Checkout 自体が確認画面 |
| プラン変更（昇格・降格） | PIN 入力 or 確認フレーズ → Customer Portal に遷移 | #771: 子供誤操作防止 |
| 解約 | 同上 → Customer Portal で「Cancel Plan」 | Stripe Portal の標準 UI |
| 支払い方法更新 | 同上 → Customer Portal で更新 | 同上 |
| 月額 ↔ 年額切替 | 同上 → Customer Portal で変更 | 同上 |
| ライセンスキー適用 | キー入力 → 確認ダイアログ → 適用 | owner ロールのみ実行可 |

---

## 10. 途中離脱時の状態管理

### 10.1 Checkout 中断

- ユーザーが Stripe Checkout を完了せず戻った場合: cancel_url (`/pricing`) にリダイレクト
- Webhook は発火しないため DB は free のまま
- 副作用なし（Stripe 側で incomplete な session が残るのみ、24h で自動失効）

### 10.2 Customer Portal 中断

- ユーザーが Portal を完了せず閉じた場合: 何も起こらない
- Portal で実際に変更操作を完了しない限り Webhook は発火しない
- DB は変更前の状態を維持

### 10.3 Webhook 受信失敗

- Stripe は自動でリトライ（最大 3 日、指数バックオフ）
- アプリ側で 500 を返した場合 → Stripe が再送
- 200 を返した場合 → 完了扱い
- リコンサイル: Stripe Dashboard の Webhook ログで失敗イベントを目視確認可能。将来的に #821 で自動リトライ・調整 cron を予定

### 10.4 ロールバック

現状、明示的なロールバックは未実装。Webhook が成功した時点で DB は新状態に更新される。

**将来検討 (#823)**: Stripe 側を正として DB を eventually consistent に保つため、定期的に `stripe.subscriptions.list` で全 active subscription をスキャンし、DB と乖離があれば修正する reconcile job を追加する想定。

---

## 11. テスト戦略

### 11.1 ユニットテスト（vitest）

- `handleCheckoutCompleted` / `handleSubscriptionUpdated` / `handleSubscriptionDeleted` / `handlePaymentFailed` のモックイベントテスト（既存）
- `planIdFromPriceId` のマッピングテスト
- `createCheckoutSession` の planId バリデーション（INVALID_PLAN 系）
- Portal セッション作成の認可テスト（child=403、owner/parent=200）

### 11.2 E2E（Playwright）

- 既存: `tests/e2e/portal-pin-gate.spec.ts`（PIN 確認ダイアログ表示）
- **未整備**: アップグレード/ダウングレードの実際の Stripe 統合は test mode key が必要なため CI で動かない
- ローカル認証モードでは Stripe API 呼び出しはスタブ化されており、Webhook イベントを直接モック注入してハンドラをテストする想定

---

## 12. 関連

- 設計
  - [06-UI設計書.md §10](06-UI設計書.md) — プラン UI パターン全体（#743）
  - [account-deletion-flow.md](account-deletion-flow.md) — 削除フロー（#746、PR #908 でマージ予定）
  - #738 — ダウングレード前警告フロー（超過リソース処理）
  - #786 — 月額↔年額切替の UI 導線改善 / proration 仕様
  - #823 — Tenant plan 状態マシン統一 EPIC
- ADR
  - [ADR-0022](../decisions/0022-billing-data-lifecycle-consistency.md) — 課金サイクルとデータライフサイクルの整合性
- 実装
  - `src/routes/(parent)/admin/license/+page.svelte`
  - `src/routes/(parent)/admin/license/+page.server.ts`
  - `src/routes/api/stripe/checkout/+server.ts`
  - `src/routes/api/stripe/portal/+server.ts`
  - `src/routes/api/stripe/webhook/+server.ts`
  - `src/lib/server/services/stripe-service.ts`
  - `src/lib/server/stripe/config.ts`

---

## 更新履歴

| 日付 | 版数 | 内容 |
|------|------|------|
| 2026-04-11 | 1.0 | #747 初版作成（実装状態を反映） |
