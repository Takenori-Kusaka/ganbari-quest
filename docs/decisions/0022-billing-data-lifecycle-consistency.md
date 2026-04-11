# 0022. 課金サイクルとデータライフサイクルの整合性

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-11 |
| 起票者 | Claude Code |
| 関連 Issue | #741 |
| 関連 ADR | ADR-0005（Critical修正の品質ゲート） |

## コンテキスト

`account-deletion-service` は DB 側のテナントデータを削除するが、**Stripe 側の subscription キャンセル API を呼び出していなかった**。SaaS 化（#314 以降の trial/plan 実装）以前の設計のまま、Stripe 統合との整合性が取れていない状態だった。

### 影響（Critical）

- アカウントを削除したユーザーに**翌月以降も課金が続く**
- ユーザーからのクレーム → チャージバック → Stripe アカウントのリスク
- 信頼失墜・炎上の温床

### 根本原因

データライフサイクル（DB/ファイル削除）と課金サイクル（Stripe Subscription）を別物として扱い、削除フローが片方しかカバーしていなかった。片方だけを削除した状態は「DB 上は存在しないが Stripe 上は課金継続中」という**不可逆の整合性違反**を生む。

## 決定

### 原則

**ユーザー起因の「削除」は、常にデータと課金の両方に同期して適用する。**

1. **Stripe キャンセルが DB 削除より先**
   - DB を先に消してから Stripe を呼ぶと、Stripe 失敗時に「DB なし／課金継続」状態になる。これは発見困難で復旧も難しい
   - Stripe を先に消せば、Stripe 失敗時でも DB は無傷 → リトライ可能
2. **Stripe 失敗時は DB 削除を中断**
   - 例外を投げて呼び出し元（API ルート）で 500 応答
   - ユーザーは削除に失敗したことを認識し、サポートに問い合わせできる
3. **冪等性を保つ**
   - Stripe が `resource_missing` を返す場合（すでに削除済み）は成功扱い
   - 削除 API のリトライで過剰エラーにならないようにする
4. **移譲パターンは例外**
   - Pattern 2a `transferOwnershipAndLeave`（権限移譲して離脱）では、新オーナーが subscription を継承するため Stripe キャンセルしない
   - 削除されるのは旧オーナーの User レコードのみで、テナントは存続する

### 実装

- `src/lib/server/services/stripe-service.ts` に `cancelSubscription(tenantId)` を追加
  - `isStripeEnabled()` false の場合は `{status: 'stripe_disabled'}` で早期リターン
  - `stripeSubscriptionId` なしの場合は `{status: 'not_subscribed'}` で早期リターン
  - `resource_missing` エラーは `{status: 'already_cancelled'}` で成功扱い
  - その他のエラーは throw
- `src/lib/server/services/account-deletion-service.ts` の以下 2 箇所で呼び出す:
  - `fullTenantDeletion()` 先頭（Pattern 1: owner-only で使用）
  - `deleteOwnerFullDelete()` 先頭（Pattern 2b: owner-full-delete）
- `transferOwnershipAndLeave()`（Pattern 2a）では**呼ばない**
- `deleteChildAccount()`, `deleteMemberAccount()`（Pattern 3/4）はテナントを消さないので Stripe アクション不要

### リコンサイル（手動スクリプト）

整合性違反を検知するため、`scripts/reconcile-stripe-subscriptions.ts` を追加。

- Stripe 側で active な subscription をリストし、対応するテナントが DB に存在するか確認
- 存在しない場合は警告ログ（cron 化は将来の #742 で扱う）

## 結果

### 期待する効果

- アカウント削除後の課金継続クレームがゼロ
- Stripe 失敗時にユーザーが状態を認識できる（500 応答）
- チャージバックリスクの低減

### 新たに生まれる制約

- Stripe がダウンしている間は削除 API が 500 を返す
  - これは意図した挙動。「DB だけ消えて課金続く」よりは「削除できない」方が遥かにマシ
- 削除フロー のユニットテストは Stripe サービスをモックする必要がある

## 代替案と不採用理由

### A. DB 削除後に Stripe キャンセル

- **不採用:** Stripe 失敗時に「DB なし／課金継続」状態が発生し、手動リカバリが困難
- 「DB は消えたが Stripe は生きてる」不整合が運用上最悪のシナリオ

### B. `cancel_at_period_end: true` で期末キャンセル

- **不採用:** 「削除したはずのアカウントの請求書が月末に届いた」というクレームを招く
- ユーザーが削除を選んだ時点で課金関係も終わらせたい

### C. キャンセル失敗を warning にして DB 削除継続

- **不採用:** 監視されない warning は「存在しない」のと同じ。Critical 事故の予備軍

## テスト要件

- `deleteOwnerOnlyAccount`: Stripe キャンセルが DB 削除より先に呼ばれる
- `deleteOwnerOnlyAccount`: Stripe 失敗時に DB 削除が行われない
- `deleteOwnerFullDelete`: Stripe 失敗時に DB 削除が行われない
- `transferOwnershipAndLeave`: Stripe キャンセルが呼ばれない

全て `tests/unit/services/account-deletion-service.test.ts` に追加済み。
