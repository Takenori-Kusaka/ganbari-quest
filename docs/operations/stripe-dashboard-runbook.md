# Stripe Dashboard 立ち上げランブック (#2101)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 最終更新 | 2026-05-18 |
| 対象環境 | Stripe Test mode / Live mode |
| 想定実行者 | PO（1 名） |
| 想定所要時間 | Phase 1: 1-2 時間（1 回限り） / Phase 2: 月 0-1 回 / Phase 3: ad-hoc |
| 関連 ADR | ADR-0006（assertion 弱体化禁止 / 配布証跡）/ ADR-0010（Pre-PMF スコープ判断）/ ADR-0013（LP truth）/ ADR-0026 archive（ライセンスキーアーキテクチャ）|
| 関連 Issue | #2098（親 EPIC）/ #2100（D 集約: 8 項目 #4 #5 #6 #8 設計書反映）/ #2101（本書）|
| 関連設計書 | [`license-key-requirements.md`](../design/license-key-requirements.md) / [`plan-change-flow.md`](../design/plan-change-flow.md) / [`license-subscription-causality.md`](../design/license-subscription-causality.md) / [`license-key-secrets.md`](license-key-secrets.md) / [`runbook.md`](runbook.md) |

---

## 0. 本書の位置づけ

Phase 1 立ち上げで PO が Stripe Dashboard を 1-2 時間で初期セットアップできるよう、Products / Prices 作成 / Customer Portal 設定 / Webhook endpoint 登録 / Tax 設定 / signing secret 配備の 7 ステップをチェックリスト化したランブック。LP 直接購入 CTA（F-1）実装後の動作確認の前提条件となる。

Phase 2 月次運用 / Phase 3 incident は頻度低 / ad-hoc のため最小限のリファレンス記載のみ。

### 関連ドキュメント

> **注 (Epic #2525 license key 全廃)**: 本書中の License Key 関連手順 (因果関係 / 要件 / HMAC シークレット / キャンペーンキー発行) はすべて deprecated。entitlement は Stripe Subscription webhook が唯一の付与経路。campaign 配布は Stripe Coupon / Promotion Code で代替。現行の課金・entitlement SSOT は `docs/design/billing-redesign/`。以下 License Key 系リンク先 (`license-subscription-causality.md` / `license-key-requirements.md` / `license-key-secrets.md`) はいずれも歴史記録。

- 価格・プラン体系: [`docs/design/19-プライシング戦略書.md`](../design/19-プライシング戦略書.md)
- 課金・entitlement 仕様 (現行): [`docs/design/billing-redesign/`](../design/billing-redesign/)
- License Key ↔ Stripe 因果関係 (deprecated): [`docs/design/license-subscription-causality.md`](../design/license-subscription-causality.md)
- License Key 要件 (deprecated): [`docs/design/license-key-requirements.md`](../design/license-key-requirements.md)
- HMAC シークレット運用 (deprecated): [`docs/operations/license-key-secrets.md`](license-key-secrets.md)

---

## Phase 1: 立ち上げチェックリスト（PO 1 回、1-2 時間）

> 補佐 Phase F Deep Research 軸 D-4（2026-05-14）の Phase 1 立ち上げ 7 ステップを SSOT として転記。Stripe 公式 doc を 1 次ソースとして参照すること。

### 所要時間サマリー

| ステップ | 所要時間目安 | 累積 |
|---|---|---|
| ステップ 1: Test/Live mode 切替確認 | 5-10 分 | 10 分 |
| ステップ 2: Products 作成 (Standard / Family) | 10-15 分 | 25 分 |
| ステップ 3: Prices 作成 (月/年 × 2 = 4 件) | 10-15 分 | 40 分 |
| ステップ 4: Customer Portal 設定 | 15-20 分 | 60 分 |
| ステップ 5: Webhook 登録 + signing secret 配備 3 箇所 | 15-20 分 | 80 分 |
| ステップ 6: Tax 自動計算 ON | 5-10 分 | 90 分 |
| ステップ 7: Test mode で Checkout 通し動作確認 | 10-20 分 | 110 分 |
| **合計** | **70-110 分（1-2 時間）** | |

全体所要時間: **約 1 時間 10 分 〜 1 時間 50 分**（Pre-PMF PO 1 名運用、ADR-0010 整合）。Live mode への切替に Stripe 本人確認 (Identity verification) の事業者情報入力で追加 15-30 分要する場合あり。

### ステップ 1: Stripe Dashboard で Test mode → Live mode 切替確認

操作対象画面: `https://dashboard.stripe.com/` 右上の **「Test mode」トグル**

1. Stripe アカウント作成済を前提（[Stripe Sign up](https://dashboard.stripe.com/register)）
2. 左下の「Test mode」トグルを ON にして Test mode で本ランブックの全手順を 1 回通すこと
3. 全手順完了後、改めて Test mode → Live mode に切り替えて本番用 Product / Price / Webhook を再登録する（Test mode と Live mode は完全に独立、データ共有なし）
4. 本人確認（Identity verification）が Live mode 切替時に要求される。事業者情報（個人事業主の場合は屋号 + 開業届）を準備しておく

参考: [Stripe: Test mode and live mode](https://docs.stripe.com/test-mode)

### ステップ 2: Products > Add product で Standard / Family を 2 件作成

操作対象画面: 左メニュー **Catalog > Products** → 右上 **「+ Add product」** ボタン

1. **Standard プラン作成**:
   - Name: `Standard プラン`（日本語 OK、ダッシュボード表示のみ）
   - Description: 「お子さま 2 人まで、活動 10 個までの有料プラン」
   - Image: `static/assets/marketing/stripe-product-standard.png`（既存）
   - Statement descriptor: `GANBARI STANDARD`（カード明細表示用、22 文字以内）
   - 「Save product」で保存
2. **Family プラン作成**:
   - Name: `Family プラン`
   - Description: 「お子さま 5 人まで、活動無制限の有料プラン」
   - Image: `static/assets/marketing/stripe-product-family.png`（既存）
   - Statement descriptor: `GANBARI FAMILY`
   - 「Save product」で保存

参考: [Stripe: Create a product](https://docs.stripe.com/products-prices/manage-prices)

### ステップ 3: 各 Product に月額 / 年額 Price を作成（計 4 Price）

操作対象画面: 各 Product 詳細ページ → **「Pricing」セクション** → **「+ Add another price」**

| プラン | 期間 | 金額（税抜き） | Stripe Price 設定 |
|---|---|---|---|
| Standard | 月額 | ¥500 | Recurring / Monthly / ¥500 / JPY |
| Standard | 年額 | ¥5,000 | Recurring / Yearly / ¥5,000 / JPY |
| Family | 月額 | ¥780 | Recurring / Monthly / ¥780 / JPY |
| Family | 年額 | ¥7,800 | Recurring / Yearly / ¥7,800 / JPY |

**重要**:
- **税抜き価格で登録** すること。Stripe Tax の Automatic tax calculation（ステップ 6）で消費税が自動付与される（¥500 → 表示 ¥550、課税対象 = 内 ¥50）
- 各 Price 作成後、画面右側に表示される **Price ID（`price_xxx`）をメモ** すること。後で環境変数として配備が必要（ステップ 5 参照）
- Trial period（無料体験期間）は **Stripe 側で設定しない**。アプリ側で 7 日間トライアルを管理する（理由: ADR-0010 / `TRIAL_TERMS.duration` 7 日間が SSOT）

参考: [Stripe: Products and Prices](https://docs.stripe.com/products-prices/overview)

### ステップ 4: Customer Portal 設定（Settings > Billing > Customer portal）

操作対象画面: 左メニュー **Settings > Billing > Customer portal**

1. **Functionality** セクションで以下を ON:
   - [x] Allow customers to **cancel subscriptions**（解約許可）
   - [x] Allow customers to **switch plans**（プラン変更許可、standard ↔ family）
   - [x] Allow customers to **update payment methods**（支払い方法更新）
   - [x] Allow customers to **view invoice history**（請求書履歴閲覧）
2. **Cancellation** サブセクション:
   - Cancellation mode: **「End of billing period」**（期末解約、即時解約は ¥1,000 程度の Phase 1 では過剰）
   - Reason collection: **OFF**（アプリ側 `/admin/billing/cancel` で詳細収集するため、Portal 側は不要）
3. **Subscription updates** サブセクション:
   - Allowed products: Standard / Family の両方をチェック
   - Allowed price intervals: Monthly / Yearly の両方をチェック
   - Proration: **「Automatic proration」**（日割り課金、Stripe 自動）
4. **Branding** セクション:
   - Logo: `site/logo-compact.png`（320×130 PNG、19.2 KB）をアップロード
   - Brand color: `#5BA3E6`（がんばりクエスト青、`--color-brand-500`）
   - Accent color: `#FFE44D`（がんばりクエスト金、`--color-gold-400`）
5. **Default redirect link** に `https://ganbari-quest.com/admin/license` を設定（Portal 退出後の戻り先）
6. 「Save」で保存

参考: [Stripe: Configure the customer portal](https://docs.stripe.com/customer-management/configure-portal)

### ステップ 5: Developers > Webhooks > Add endpoint で Webhook 登録

操作対象画面: 左メニュー **Developers > Webhooks** → 右上 **「+ Add endpoint」**

1. Endpoint URL に以下を入力:
   - Live mode: `https://ganbari-quest.com/api/stripe/webhook`
   - Test mode: `https://your-ngrok-or-staging-url/api/stripe/webhook`（ローカル検証時）
2. Description: `がんばりクエスト Webhook（本番）`
3. **Events to send** で以下 4 種を選択:
   - `checkout.session.completed`（新規購入完了 → license 発行 + tenant plan 更新）
   - `invoice.payment_succeeded`（継続課金成功 → license.expiresAt 延長）
   - `customer.subscription.deleted`（解約 → 期限切れ予告 → 無料プラン移行、`license-key-requirements.md` §2.9）
   - `customer.subscription.updated`（プラン変更 / status 遷移 → tenant plan 反映）
4. 「Add endpoint」で保存
5. 発行された **Signing secret（`whsec_xxx` で始まる文字列）をメモ**
6. **Signing secret の配布証跡（ADR-0006 整合）**を以下 3 箇所に配備:

#### 5-1. SSM Parameter Store（Lambda 本番環境用）

```bash
aws ssm put-parameter \
  --name "/ganbari-quest/prod/STRIPE_WEBHOOK_SECRET" \
  --type SecureString \
  --value "whsec_xxx..." \
  --overwrite

# 配備確認
aws ssm get-parameter \
  --name "/ganbari-quest/prod/STRIPE_WEBHOOK_SECRET" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text | head -c 10  # 先頭 10 文字のみ確認
```

#### 5-2. NUC `.env`（dogfood NUC 本番環境用）

```bash
ssh nuc
sudo vim /opt/ganbari-quest/.env
# 末尾に追加:
# STRIPE_WEBHOOK_SECRET=whsec_xxx...
sudo systemctl restart ganbari-quest
```

#### 5-3. GitHub Actions Secrets（CI / Test mode 用）

```bash
gh secret set STRIPE_WEBHOOK_SECRET_TEST --body "whsec_test_xxx..." --repo Takenori-Kusaka/ganbari-quest

# 配備確認
gh secret list --repo Takenori-Kusaka/ganbari-quest | grep STRIPE_WEBHOOK_SECRET
```

参考: [Stripe: Webhooks signature verification](https://docs.stripe.com/webhooks/signature)

### ステップ 6: Settings > Tax で消費税自動計算を ON

操作対象画面: 左メニュー **Settings > Tax**

1. 「Automatic tax calculation」を ON
2. **Tax registrations** で Japan tax registration を登録:
   - Country: Japan
   - Tax ID type: 日本の消費税課税事業者番号（13 桁、`Txxxxxxxxxxxxx`）
   - 課税事業者でない場合は登録不要だが、Pre-PMF でも 1,000 万円超の売上見込みが立った時点で速やかに登録
3. **Tax behavior** で全 Price に対し `Exclusive`（外税表示）を設定（ステップ 3 で税抜き登録した整合）
4. 「Save」で保存

参考: [Stripe Tax for Japan](https://docs.stripe.com/tax)

### ステップ 7: Test mode で Checkout フロー 1 回通し、Webhook 受信を確認

1. アプリの `/admin/license` から Family プランの「プランで始める」ボタンを押す
2. Stripe Checkout に遷移、Test card `4242 4242 4242 4242` / 任意 future expiry / 任意 CVC で決済完了
3. リダイレクト先 `/admin/license?session_id=xxx` でアプリ画面に戻ることを確認
4. Stripe Dashboard > Developers > Webhooks > 該当 endpoint > **「Recent attempts」** で `checkout.session.completed` イベントが **HTTP 200** で受信されたことを確認
5. アプリ側で以下を確認:
   - `tenants` テーブルの `plan='family-monthly'`, `status='active'`, `stripeCustomerId` / `stripeSubscriptionId` 紐付け
   - `license_keys` テーブルに新規 license 発行（`kind='purchase'`, `status='active'`）
   - 登録 email に License Key 配布メールが届く（SES 設定済の場合、#815 で実装予定）

完了判定基準:
- Stripe Dashboard > Developers > Webhooks > 「Recent attempts」で `checkout.session.completed` が **HTTP 200** を 1 件以上記録
- アプリ DB の `tenants` テーブル該当行で `plan='family-monthly'` / `stripeSubscriptionId` 紐付け確認
- `license_keys` テーブルに新規行（`kind='purchase'`, `status='active'`）追加

詳細トラブルシューティングは下記「トラブルシューティング」セクション参照。

---

## トラブルシューティング

Phase 1 立ち上げで頻出する 5 系統の問題と切り分け手順。各項目は具体的な確認コマンド / 設定値を含む。

### Webhook 受信失敗（HTTP 400 / 401 / 403 / 500）

| エラー | 原因 | 対処 |
|---|---|---|
| HTTP 400 | signing secret 配備ミス | ステップ 5-1 / 5-2 / 5-3 で配備した `whsec_xxx` 値が Stripe Dashboard 表示値と一致するか確認。コピー時に末尾改行混入していないか `head -c 100` で先頭 100 文字検査 |
| HTTP 401 / 403 | `verifyStripeWebhook()` 署名検証失敗 | アプリ側 `src/lib/server/stripe/webhook.ts` の `STRIPE_WEBHOOK_SECRET` 環境変数読込確認。改行混入 / 文字化け / 別環境（test / live）の secret 取り違えチェック |
| HTTP 500 | アプリ側で例外発生 | CloudWatch Logs `/aws/lambda/ganbari-quest-app` で stacktrace 確認。DB 接続障害 / 並列 license 発行衝突等を切り分け |
| HTTP 502 / 504 | Lambda timeout / cold start | Provisioned Concurrency 設定確認、Lambda timeout を 30s 程度に拡張 |

### Price ID 取り違え（Test mode / Live mode 間）

- 環境変数 `STRIPE_PRICE_STANDARD_MONTHLY` 等が test (`price_test_xxx`) と live (`price_live_xxx`) のどちらを指しているか確認
- 確認コマンド: `aws ssm get-parameters-by-path --path /ganbari-quest/prod --recursive --with-decryption | grep STRIPE_PRICE`
- 取り違え時の症状: Stripe Checkout 遷移時に「Price not found」エラー

### Customer Portal リンクが 404 / 401 を返す

- ステップ 4 の Customer Portal が **Save** 押下されたか確認（未保存の場合は「activate」ボタンが残っている）
- アプリ側 `createCustomerPortalSession()` で `return_url` が `https://ganbari-quest.com/admin/license` と一致するか確認
- Stripe Dashboard > Settings > Billing > Customer portal で「Activate test link」/「Activate live link」を再生成

### Tax 自動計算が反映されない

- ステップ 6 の Tax registrations 登録漏れ確認（Japan tax registration が未登録だと自動計算スキップ）
- 各 Price の Tax behavior が `Exclusive`（外税）か確認。`Inclusive`（内税）になっていると意図と乖離
- Pre-PMF で課税事業者番号未取得の場合は Tax 自動計算 OFF のままで問題なし（1,000 万円超売上見込み時点で再対応）

### 配布証跡欠落 / 配備ミス（ADR-0006）

- `npm run check:new-required-env` で新規 env 配備証跡欠落 PR を block
- 3 箇所配備の確認:
  - SSM: `aws ssm get-parameter --name "/ganbari-quest/prod/STRIPE_WEBHOOK_SECRET" --with-decryption`
  - NUC: `ssh nuc 'grep STRIPE_WEBHOOK_SECRET /opt/ganbari-quest/.env'`
  - GitHub Secrets: `gh secret list --repo Takenori-Kusaka/ganbari-quest | grep STRIPE_WEBHOOK_SECRET`
- 1 箇所でも欠けていると CI / NUC dogfood / Lambda 本番のいずれかで Webhook 検証失敗

---

## Phase 2: 月次運用（PO 月 0-1 回）

### 価格改定

1. 旧 Price を **archive**（既存サブスクは継続、新規購入時のみ非表示）:
   - Stripe Dashboard > Products > 該当 Price > 右上「⋯」> Archive
2. 新 Price を作成（ステップ 3 と同じ手順）
3. アプリ側 `.env` / SSM の Price ID を新 ID に切替:
   - `STRIPE_PRICE_FAMILY_MONTHLY=price_xxx`（新 ID）
4. LP / pricing.html / `pricing-tier-config.ts` の表示金額を新価格に同期（ADR-0013 LP truth）

### Coupon / Promotion Code

操作対象画面: 左メニュー **Products > Coupons** → 「+ New」

1. Coupon 作成: Type `Percentage discount` / `100%` / Duration `Once`（1 回限り）
2. Promotion code 作成: 該当 coupon → 「+ Promotion code」 → 任意の英数字コード（例: `LAUNCH2026`）
3. Expiration date を設定（必須、配布から 30 日以内推奨）
4. Max redemptions を設定（配布数より +10% 程度）
5. 配布: SES（#815、未実装）または LP / SNS 経由

参考: [Stripe Coupons](https://docs.stripe.com/billing/subscriptions/coupons)

---

## Phase 3: incident 対応（PO ad-hoc）

### Refund（返金）

操作対象画面: **Payments > 該当 Charge > 「Refund payment」**

> **PO 提示 8 項目 #7 方針**: 原則として返金は実行しない（Pre-PMF / ADR-0010）。法的義務発生時（消費者契約法第10条等）のみ実施。

1. 該当 Charge を検索（Customer email or Subscription ID で）
2. Refund payment ボタン押下、理由を選択（`Requested by customer` 等）
3. 全額 / 一部金額を指定
4. tenant plan は `customer.subscription.deleted` / `customer.subscription.updated` webhook で自動同期される（`/ops/tenants` で確認可。`/ops/license` は Epic #2525 で削除済）。`license-subscription-causality.md` §2.6 は deprecated (歴史記録)

### Chargeback（チャージバック）

操作対象画面: **Disputes > 該当 Dispute > 「Submit evidence」**

1. Stripe からメール通知が届く（Dispute 発生時）
2. 証拠を 5 営業日以内に提出:
   - 利用履歴: アプリ側 `/ops/tenants/<tenantId>` で活動履歴・ログイン履歴を CSV エクスポート
   - 規約同意記録: `tenants.terms_accepted_at` / `tenants.privacy_accepted_at`
   - Webhook ログ: Stripe Dashboard > Developers > Webhooks > 該当 endpoint > 「Recent attempts」をスクリーンショット
3. Submit Evidence ボタンで提出
4. Stripe / カード会社が裁定（通常 30-75 日）
5. 敗訴時: 自動的に refund 処理される、license / tenant plan は手動 revoke 検討

### Customer 検索

操作対象画面: **Customers タブ**

- 検索条件: email / Customer ID / metadata（`tenantId` 等）
- 1 customer = 1 tenant（家族グループ）の 1 対 1 対応（`license-key-requirements.md` §2.3）
- Subscription / Payment 履歴 / Invoice をワンビューで確認可能

---

## 自動化判断基準（Pre-PMF 1 名運用整合）

補佐 Phase F Deep Research 軸 D-5（2026-05-14）の判断基準を SSOT として転記:

| 操作頻度 + 障害影響 | 判断 |
|---|---|
| 月 1 回未満 + 障害影響小 | 手動でよい（Pre-PMF 1 名運用に整合、ADR-0010） |
| 月 1 回以上 + ヒューマンエラーリスク中 | 自動化検討（#802 Ops endpoint で半自動化） |
| 月 10 回以上 + 障害影響大 | 自動化必須（PMF 後フェーズで再評価） |

---

## ライセンスキー方式でのプラン変更との整合（#2100 #5）

Standard → Family アップグレードは Phase 1 α 採用（Family 780 円フル新規購入）で実現する。詳細は [`plan-change-flow.md`](../design/plan-change-flow.md) §11 参照。Phase 1 では本ランブック ステップ 3 の 4 Price 体系で十分対応可能。

将来 Phase 2 β（差額 ¥280/月キーのみ追加発行）に移行する場合は、本ランブックに `STRIPE_PRICE_STANDARD_TO_FAMILY_DIFF_MONTHLY` 等の差額 Price ID 作成手順を追記する。

---

## LP 記載準拠の期限切れ予告通知フローとの整合（#2100 #6）

Stripe Webhook 受信後の期限切れ予告 7 日前 / 3 日前 / 1 日前 / 期限当日の通知フローは [`license-key-requirements.md`](../design/license-key-requirements.md) §2.9 / [`license-subscription-causality.md`](../design/license-subscription-causality.md) §2.4.1 を参照。本ランブック ステップ 5 で `customer.subscription.deleted` Webhook を購読しておけば、アプリ側で自動発火される。
