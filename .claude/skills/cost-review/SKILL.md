---
name: Cost Review
description: Use when analyzing AWS costs, evaluating pricing impact, or making budget decisions. Prohibits direct Cost Explorer API calls ($0.01/request).
---

# コスト分析スキル

## AWS コスト確認方法

### 使ってよいもの
- `.github/workflows/cost-audit.yml` の月次レポート出力
- AWS Budgets のアラート設定
- `docs/design/12-事業計画書.md` の原価予測表

### 禁止
- `aws ce get-cost-and-usage` — $0.01/回課金
- `aws ce get-cost-forecast` — 同上
- Cost Explorer コンソールの API 呼び出し

## コスト評価フレームワーク

### Year 1 原価枠（12-事業計画書より）

| 項目 | 月額上限 |
|------|---------|
| AWS Lambda | ~¥500 |
| DynamoDB | ~¥300 |
| Cognito | 無料枠内 |
| S3/CloudFront | ~¥200 |
| その他 | ~¥500 |
| **合計** | **~¥1,500/月** |

### 新機能のコスト影響チェック

1. 新しい AWS サービスを追加するか？ → 無料枠の確認
2. Lambda 実行回数が増えるか？ → 月間想定呼び出し数
3. DynamoDB の RCU/WCU が増えるか？ → オンデマンドキャパシティ内か
4. 外部 API（Stripe, SES 等）のコストは？

## 出力フォーマット

```markdown
### コスト影響分析

| 項目 | 現状 | 変更後 | 差分 |
|------|------|--------|------|
| [サービス名] | ¥X/月 | ¥Y/月 | +¥Z/月 |

**Year 1 原価枠との比較**: 枠内 / 超過（要 PO 判断）
```
