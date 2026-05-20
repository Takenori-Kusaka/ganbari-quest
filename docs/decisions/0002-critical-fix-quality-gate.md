# 0002. Critical 修正の品質ゲート

- **Status**: Accepted
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265
- **統合元**: 旧 ADR-0005（本 PR で削除、詳細は git 履歴）

## コンテキスト

> 旧 ADR-0005 を renumber した新採番。ADR 10 枠再構成（#1262）の一環。

#543 のダイアログフリーズ修正が #539 のルートリネームで消失し、#611 として再発した。原因:

- 修正が旧ファイル名に適用され、新ファイル名には反映されなかった
- Issue で提案された「ダイアログキュー」は未実装のまま closes された
- E2E テストなし、セルフレビュー + Copilot のみでマージ

## 決定

`priority:critical` のバグ修正は以下を全て満たすこと:

1. **回帰テスト（E2E）を同一 PR 内で追加**
2. **Issue の Acceptance Criteria を全項目完了**（部分実装で closes 禁止）
3. **Issue で提案された対策を全て実装**（部分実装は対症療法であり根本解決ではない）
4. **全 4 年齢コアモード（preschool/elementary/junior/senior）で実機検証 + スクリーンショット**（baby 準備モードは成長待機画面の目視確認）
5. **直近 30 日に同じファイルを変更した PR がないかチェック**（リネーム/リファクタリングとの依存関係確認）

## 結果

- Critical 修正の品質が担保される
- リネーム等との依存関係チェックが必須になる
- 部分実装で closes することが禁止される

## 適用ログ

### 2026-05-20: stripe-checkout EPIC #2345 子#2346 critical (景品表示法対応)

| 要件 | 充足内容 |
|---|---|
| 1. E2E 回帰 | `tests/e2e/integration/stripe-checkout-labels.spec.ts` (CHECKOUT_LABELS / CHECKOUT_TERMS atom + compound 整合 + 旧文言「すべての機能」regression guard) |
| 2. AC 全完了 | #2346 AC 5 件全 [x] |
| 3. 提案全実装 | PO 確定文言「お選びのプランの機能」を `stripe-service.ts` の `custom_text.submit` + `custom_text.after_submit` 2 箇所全反映 |
| 4. 5 年齢モード検証 | **N/A**: admin 親画面 (`/admin/license`)、uiMode 非依存。Stripe Checkout 画面は外部ホスト (`checkout.stripe.com`) で年齢モード概念外 |
| 5. 直近 30 日重複変更チェック | `git log --since='30 days ago' src/lib/server/services/stripe-service.ts src/lib/server/stripe/config.ts` を実施。直近の改修は本 PR 関連のみ、重複 PR 競合なし |

法的根拠: 景品表示法 5 条 1 号 (優良誤認表示) + 特商法 2022-06 改正最終確認画面ガイドライン
二重抵触可能性 (消費者庁「動画見放題プラン」措置命令 相同類型)。

## 関連

- ADR-0003（Issue 起票・クローズ品質）— AC 全項目完了の一般規則
- ADR-0004（レビュー & AC 検証品質）— AC 検証エビデンス
- ADR-0014 / ADR-0045 (labels.ts SSOT) — stripe-service.ts 直書きの構造的解消
