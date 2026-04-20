# ADR-0025: License ↔ Stripe Subscription 因果関係の決定

> **Archived (2026-04-20)**: ライセンス・購読因果関係。Stripe webhook 連携実装完了

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-11 |
| 起票者 | Takenori-Kusaka |
| 関連 Issue | #824, #820, #821, #741, #784 |
| 関連 ADR | ADR-0003（設計書 SSOT）, ADR-0024（プラン解決責務分離） |
| 参照設計書 | `docs/design/license-subscription-causality.md` |

## コンテキスト

License Key と Stripe Subscription のライフサイクルに関して、以下の問題が発生していた:

### 過去の failure

| Issue | 問題 | 根本原因 |
|-------|------|--------|
| #741 | アカウント削除時に Stripe Subscription がキャンセルされず請求継続 | Stripe ↔ 自アプリ DB の整合性保証ロジックがない |
| #784 | `admin/tenant/cancel` で DB を `grace_period` にするが Stripe をキャンセルしない | 状態変更の責務が Stripe と自アプリ DB に二重化している |
| #725 | `trialTier` 引数の渡し忘れで plan 解決に失敗 | 状態をどこから引くべきかが明文化されていない |
| #728 | `admin/rewards` でプラン制限エラー形式が不統一 | エラー形式の統一規約がない |

### 根本原因

1. **真の状態管理主体が曖昧** — Stripe と自アプリ DB のどちらが真か決まっていない
2. **Webhook ハンドラの責務が曖昧** — `handlePaymentFailed` が grace_period を設定しているが Stripe も同様に dunning を管理しており二重管理
3. **状態遷移図が存在しない** — どの Stripe イベントが tenant state をどう変えるか決まっていない
4. **idempotency 保証の設計がない** — Stripe webhook の at-least-once 配信に対する対策が実装されていない
5. **retention / archive フェーズが未定義** — 解約後のデータ保持期間が曖昧

これらは個別修正では解決せず、**全体の因果関係を canonical に定義する必要がある**。

## 検討した選択肢

### 選択肢 A: 自アプリ DB = source of truth

- メリット: 自アプリ内でクローズド、Stripe 障害時に独立動作可能
- デメリット: 決済状態と DB 状態の同期ロジックが必要、Stripe の高度な機能（smart retries, dunning）を再実装する必要

### 選択肢 B: Stripe = source of truth（採用）

- メリット: Stripe の機能（smart retries, dunning, invoicing）を最大限活用、自アプリはキャッシュとして単純化
- デメリット: Stripe 障害時は自アプリも影響を受ける（ただし Stripe の SLA は 99.999%）

### 選択肢 C: ハイブリッド（状態によって分担）

- メリット: 柔軟性
- デメリット: どの状態を Stripe で管理しどれを自アプリで管理するかが曖昧になり、必ずバグる

## 決定

### 1. Stripe = Source of Truth を採用（B-3）

すべての plan 状態は Stripe webhook を起点として決定される。
自アプリ DB は「Stripe の状態をキャッシュしているもの」と位置付ける。

### 2. 契約期間は `current_period_end` に連動（C-1）

- Stripe subscription の `current_period_end` = license key の `expiresAt`
- `invoice.paid` webhook で自動延長

### 3. Dunning は Stripe に完全一任（C-2）

- `invoice.payment_failed` 受信時は **何もしない**
- Stripe の smart retries に任せる
- `customer.subscription.deleted` で初めて反応

### 4. Gift / Campaign は 100% OFF クーポンで統一（C-3）

- 通常購入と同じ webhook 経路を通す
- license の `kind` フィールドで区別（`purchase` / `campaign` / `gift`）

### 5. Tenant Plan State Machine を明文化

`free` / `trialing` / `active` / `canceled_active` / `expired_retention` / `expired_free` / `archived` の 7 状態と遷移条件を `docs/design/license-subscription-causality.md` §4 に定義。

### 6. Idempotency を `stripe_webhook_events` テーブルで保証

Stripe webhook の at-least-once 配信に対し、event ID ベースの重複排除を実装する。

### 7. 因果関係マップを SSOT 化

`docs/design/license-subscription-causality.md` を License ↔ Stripe の Single Source of Truth とする。
以下の実装はこの文書を根拠に行う:

- `src/lib/server/services/stripe-service.ts`
- `src/lib/server/services/license-service.ts`
- Phase 2 自動化基盤（#820 / #821）

## 結果

### 期待される効果

- Stripe と自アプリ DB の状態矛盾を構造的に防止
- 新規 webhook 追加時に「どう実装すべきか」で迷わない
- 運営の手動介入時に必ず監査ログを残す規律
- Phase 2 自動化基盤の実装が因果関係マップを根拠にスムーズに進む

### トレードオフ

- 現行実装（`handlePaymentFailed` の grace_period 設定等）との差分があり、段階的な修正が必要
- Stripe 障害時の運用手順は別途整備（`16-運用設計書.md`）
- `stripe_webhook_events` テーブル追加により DynamoDB コストがわずかに増加（event ID のみの軽量テーブル、TTL 90 日）

### 既存実装との差分

`docs/design/license-subscription-causality.md` §8「現行実装との差分（TODO）」を参照。
Phase 2 自動化基盤（#820 / #821）で解消する。緊急度の高い差分（#3, #4）は #741 / #784 で先行対応。

## 教訓

- **決済ドメインは専門 SaaS に任せる** — Stripe の高度な機能（smart retries, dunning）を自アプリで再実装しようとすると必ず劣化する
- **因果関係図は設計の段階で描く** — 実装が始まってから描くと、既存実装のバグを「それっぽく」正当化する図になる
- **至極当然なことを SSOT として明文化する** — 「Stripe が正」という暗黙の共通理解でも、文書化しない限り実装が必ず逸脱する（#725 / #728 / #741 の教訓）
- **idempotency は受信直後の重複排除テーブルで保証する** — ハンドラロジック内の条件分岐では漏れる
