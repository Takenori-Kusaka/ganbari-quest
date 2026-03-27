# 0131 決済連携（Stripe Checkout + Billing）

### ステータス

`Done`

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 2: 開発 |
| 難易度 | 高 |
| 優先度 | 中 |
| 親チケット | #0123 |
| 依存チケット | なし（設計先行） |

---

### 概要

Stripe Japan を使用して、ライセンスキーの購入（一括/サブスク）と自動更新を実装する。日本ユーザー向けにコンビニ決済・PayPay にも対応する。

### 選定理由

- Stripe Japan（日本法人あり）
- コンビニ決済・PayPay・銀行振込に対応
- 個人事業主でも利用可能
- 手数料 3.6%（月額固定費なし）
- Checkout + Billing でサブスク管理が容易

### 料金プラン設計

| プラン | 価格（税込） | 更新 | ライセンス |
|--------|-------------|------|-----------|
| 月額プラン | ¥500/月 | 自動更新 | 月次発行 |
| 年額プラン | ¥5,000/年 | 自動更新 | 年次発行 |
| 買い切り | ¥15,000 | なし | 永久 |

※ 価格は仮。正式決定は別途。

### 購入フロー

```
1. ユーザーが料金プランページ（/pricing）で「購入」ボタン
2. SvelteKit API → Stripe Checkout Session 作成
3. Stripe ホスティング決済ページにリダイレクト
4. ユーザーが決済（クレカ / コンビニ / PayPay）
5. Stripe Webhook: checkout.session.completed
6. Lambda:
   - ライセンスキー生成（GQ-XXXX-XXXX-XXXX）
   - DynamoDB に保存（LICENSE#キー / META）
   - SES でメール送信（ライセンスキー通知）
7. ユーザーがライセンスキーを使ってサインアップ（#0125）
```

### サブスク更新フロー

```
1. Stripe が自動課金（月額/年額）
2. Webhook: invoice.paid
   → ライセンス有効期限延長（DynamoDB 更新）
3. 課金失敗: invoice.payment_failed
   → 猶予期間（7日）→ ライセンス停止
4. Webhook: customer.subscription.deleted
   → ライセンスステータスを expired に変更
```

### Webhook 処理

| イベント | アクション |
|----------|-----------|
| `checkout.session.completed` | ライセンスキー生成 + メール送信 |
| `invoice.paid` | ライセンス有効期限延長 |
| `invoice.payment_failed` | 支払い失敗通知 + 猶予期間開始 |
| `customer.subscription.deleted` | ライセンス停止 |
| `customer.subscription.updated` | プラン変更反映 |

### ゴール

- [x] Stripe アカウント設定（Stripe Japan）
- [x] 料金プラン（Product + Price）作成
- [x] 料金プランページ UI（/pricing）
- [x] Checkout Session 作成 API（POST /api/stripe/checkout）
- [x] Webhook エンドポイント（POST /api/stripe/webhook）
- [x] Webhook 署名検証
- [x] ライセンスキー生成ロジック
- [x] ライセンスキーメール送信（SES）
- [x] サブスク更新処理（invoice.paid）
- [x] 課金失敗処理（invoice.payment_failed）
- [x] Stripe Customer Portal 連携
- [x] コンビニ決済・PayPay の有効化設定
- [x] ユニットテスト（Webhook 処理）
- [x] Stripe CLI を使ったローカルテスト

### 技術詳細

```typescript
// Stripe Checkout Session 作成
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const session = await stripe.checkout.sessions.create({
  mode: 'subscription', // or 'payment' for 買い切り
  payment_method_types: ['card'],
  locale: 'ja',
  line_items: [{
    price: 'price_xxxxx', // Stripe Price ID
    quantity: 1,
  }],
  success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${origin}/pricing`,
  // コンビニ決済を追加する場合
  payment_method_options: {
    konbini: { expires_after_days: 3 },
  },
});
```

### 完了条件

1. Stripe Checkout で決済が完了する
2. 決済後にライセンスキーがメールで届く
3. サブスクの自動更新が動作する
4. 課金失敗時に猶予期間 → ライセンス停止が動作する
5. コンビニ決済 / PayPay で支払いできる
6. Stripe Customer Portal でプラン変更・支払い情報更新ができる

---

### 成果・結果

Stripe決済統合 -- Checkout Session・Webhook・Customer Portal + 料金ページ。コミット: e982b64, d9779b8
