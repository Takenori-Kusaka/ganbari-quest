# Stripe アカウント設定ガイド — がんばりクエスト

## 概要

このガイドに従って Stripe ダッシュボードの設定を行ってください。
コード側の実装は並行して進めますので、以下の設定値が揃い次第、AWS SSM パラメータに登録します。

---

## Step 1: Stripe アカウント作成

1. https://dashboard.stripe.com/register にアクセス
2. メールアドレス、氏名、パスワードを入力してアカウント作成
3. メール認証を完了

## Step 2: ビジネス情報の設定

1. ダッシュボード → **設定** → **ビジネスの詳細**
2. 以下を入力:
   - **ビジネスタイプ**: 個人事業主
   - **業種**: ソフトウェア / SaaS
   - **ウェブサイト**: `https://ganbari-quest.com`
   - **サービスの説明**: 「子供の日常活動をゲーミフィケーションで動機づけする家庭内Webアプリ」
3. **銀行口座情報**を入力（売上金の入金先）
4. **本人確認書類**をアップロード（免許証 or マイナンバーカード）

> **注意**: 本番決済を有効にするには本人確認の完了が必要です。テストモードは即座に使えます。

## Step 3: 商品・価格の作成

### 3-1: テストモードで作成

ダッシュボード右上が **「テストモード」** になっていることを確認してから作成してください。

1. ダッシュボード → **商品カタログ** → **商品を追加**

### 3-2: スタンダードプラン（月額）

| 項目 | 値 |
|---|---|
| 商品名 | がんばりクエスト スタンダードプラン（月額） |
| 説明 | 子供3人まで。全機能利用可能。毎月自動更新。 |
| 価格 | ¥500 |
| 請求期間 | 月次 |
| 通貨 | JPY |

作成後、**Price ID**（`price_xxxxxxxxxxxxx` 形式）をメモしてください。

### 3-3: スタンダードプラン（年額）

| 項目 | 値 |
|---|---|
| 商品名 | がんばりクエスト スタンダードプラン（年額） |
| 説明 | 子供3人まで。全機能利用可能。2ヶ月分お得。毎年自動更新。 |
| 価格 | ¥5,000 |
| 請求期間 | 年次 |
| 通貨 | JPY |

作成後、**Price ID** をメモしてください。

### 3-4: ファミリープラン（月額）

| 項目 | 値 |
|---|---|
| 商品名 | がんばりクエスト ファミリープラン（月額） |
| 説明 | 子供5人まで。全機能＋データエクスポート＋優先サポート。毎月自動更新。 |
| 価格 | ¥780 |
| 請求期間 | 月次 |
| 通貨 | JPY |

作成後、**Price ID** をメモしてください。

### 3-5: ファミリープラン（年額）

| 項目 | 値 |
|---|---|
| 商品名 | がんばりクエスト ファミリープラン（年額） |
| 説明 | 子供5人まで。全機能＋データエクスポート＋優先サポート。2ヶ月分お得。毎年自動更新。 |
| 価格 | ¥7,800 |
| 請求期間 | 年次 |
| 通貨 | JPY |

作成後、**Price ID** をメモしてください。

## Step 4: Customer Portal の設定

1. ダッシュボード → **設定** → **Billing** → **カスタマーポータル**
2. 以下を有効化:
   - **サブスクリプションのキャンセル**: 有効（即時キャンセル or 期間終了時キャンセルを選択 → **期間終了時**を推奨）
   - **プラン変更**: 有効（月額↔年額の切替を許可）
   - **支払い方法の更新**: 有効
   - **請求書の表示**: 有効
3. **ビジネス情報**:
   - ビジネス名: がんばりクエスト
   - プライバシーポリシーURL: `https://ganbari-quest.com/legal/privacy`
   - 利用規約URL: `https://ganbari-quest.com/legal/terms`
4. 保存

## Step 5: Webhook エンドポイント設定

1. ダッシュボード → **開発者** → **Webhook**
2. **エンドポイントを追加**:
   - URL: `https://ganbari-quest.com/api/stripe/webhook`
   - 説明: がんばりクエスト本番Webhook
   - 受信するイベント（以下の5つを選択）:
     - `checkout.session.completed`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
     - `customer.subscription.updated`
3. 作成後、**Webhook 署名シークレット**（`whsec_xxxxxxxxxxxxx` 形式）をメモ

> **テスト環境用も同様に作成**:
> テストモードの Webhook は別途必要です（テストモードで同じ手順を繰り返す）。
> テスト用 URL は `https://ganbari-quest.com/api/stripe/webhook` のまま（テスト/本番は Stripe 側で分離されます）。

## Step 6: 無料トライアルの設定

Stripe の Subscription にはビルトインのトライアル機能があります。
コード側で `trial_period_days: 7` を設定するため、ダッシュボードでの追加設定は不要です。

## Step 7: API キーの取得

1. ダッシュボード → **開発者** → **API キー**
2. 以下をメモ:
   - **テスト用シークレットキー**: `sk_test_xxxxxxxxxxxxx`
   - **本番用シークレットキー**: `sk_live_xxxxxxxxxxxxx`（本人確認完了後に利用可能）

> **公開キー（pk_）は不要です。** Checkout Session 方式では、サーバーサイドのみでシークレットキーを使用します。

---

## 取得した値のまとめ

以下の値が全て揃ったら連携してください。AWS SSM パラメータに登録します。

```
# テストモード用（開発・検証）
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
STRIPE_PRICE_STANDARD_MONTHLY=price_xxxxxxxxxxxxx  （スタンダード月額¥500 のテスト Price ID）
STRIPE_PRICE_STANDARD_YEARLY=price_xxxxxxxxxxxxx   （スタンダード年額¥5,000 のテスト Price ID）
STRIPE_PRICE_FAMILY_MONTHLY=price_xxxxxxxxxxxxx    （ファミリー月額¥780 のテスト Price ID）
STRIPE_PRICE_FAMILY_YEARLY=price_xxxxxxxxxxxxx     （ファミリー年額¥7,800 のテスト Price ID）

# 本番用（本人確認完了後）
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
STRIPE_PRICE_STANDARD_MONTHLY=price_xxxxxxxxxxxxx  （スタンダード月額¥500 の本番 Price ID）
STRIPE_PRICE_STANDARD_YEARLY=price_xxxxxxxxxxxxx   （スタンダード年額¥5,000 の本番 Price ID）
STRIPE_PRICE_FAMILY_MONTHLY=price_xxxxxxxxxxxxx    （ファミリー月額¥780 の本番 Price ID）
STRIPE_PRICE_FAMILY_YEARLY=price_xxxxxxxxxxxxx     （ファミリー年額¥7,800 の本番 Price ID）
```

---

## GitHub リポジトリ変数の設定（デプロイに必要）

Price ID は GitHub Actions 経由で CDK → Lambda 環境変数に渡されます。
GitHub リポジトリの **Settings > Secrets and variables > Actions > Variables** で以下を登録してください。

| Variable 名 | 値の例 | 説明 |
|---|---|---|
| `STRIPE_PRICE_MONTHLY` | `price_xxxxxxxxxxxxx` | スタンダード月額の Price ID |
| `STRIPE_PRICE_YEARLY` | `price_xxxxxxxxxxxxx` | スタンダード年額の Price ID |
| `STRIPE_PRICE_FAMILY_MONTHLY` | `price_xxxxxxxxxxxxx` | ファミリー月額の Price ID |
| `STRIPE_PRICE_FAMILY_YEARLY` | `price_xxxxxxxxxxxxx` | ファミリー年額の Price ID |

> **注意**: Secrets ではなく **Variables**（平文）に登録します。Price ID は機密情報ではないためです。
> Secret Key や Webhook Secret は引き続き **Secrets** に登録してください。

---

## ローカル開発でのテスト（任意）

Stripe CLI を使うとローカル環境で Webhook テストができます。

```bash
# Stripe CLI インストール（Windows）
scoop install stripe

# ログイン
stripe login

# Webhook をローカルに転送
stripe listen --forward-to localhost:5173/api/stripe/webhook

# テスト用 Checkout イベントを発火
stripe trigger checkout.session.completed
```

---

## チェックリスト

- [ ] Stripe アカウント作成・メール認証
- [ ] ビジネス情報入力
- [ ] スタンダードプラン（月額）商品・価格作成 → Price ID メモ
- [ ] スタンダードプラン（年額）商品・価格作成 → Price ID メモ
- [ ] ファミリープラン（月額）商品・価格作成 → Price ID メモ
- [ ] ファミリープラン（年額）商品・価格作成 → Price ID メモ
- [ ] Customer Portal 設定
- [ ] Webhook エンドポイント追加 → 署名シークレット メモ
- [ ] テスト用 API シークレットキー メモ
- [ ] 上記の値を連携（SSM パラメータ登録用）
