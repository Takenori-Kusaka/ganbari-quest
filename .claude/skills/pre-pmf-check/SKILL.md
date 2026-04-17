---
name: Pre-PMF Check
description: Use when evaluating whether a feature or task is appropriate for the pre-PMF stage. Checks against ADR-0023 bias prevention guidelines and ADR-0034 security minimization.
---

# Pre-PMF バイアスチェック

## ADR-0023: エンジニアバイアス防止

### 優先度判断マトリクス

| 優先度 | 条件 |
|--------|------|
| **Critical** | 本番障害・データ損失・セキュリティ脆弱性 |
| **High** | 顧客価値 + 事業推進の両方が Yes |
| **Medium** | どちらか一方が Yes |
| **Low** | 技術負債のみ Yes、または全て No |

### エンジニアバイアスの典型パターン

以下に該当する場合は優先度を下げることを検討:

- 「将来必要になるから今やっておく」→ YAGNI
- 「アーキテクチャ的に正しいから」→ ユーザー価値は？
- 「技術的に面白いから」→ 事業貢献は？
- 「他プロジェクトではこうしている」→ Pre-PMF の制約は？

## ADR-0034: セキュリティ最小化方針

Pre-PMF で**採用しない**もの:
- 汎用監査ログ DynamoDB テーブル
- S3 + Athena による分析基盤
- AWS WAF
- IP 単位ブルートフォース検知

Pre-PMF で**十分な**もの:
- HMAC 鍵強度
- API Gateway スロットリング
- AWS Budgets アラート
- 既存 state カラム

## チェックリスト

- [ ] この機能は今月のサインアップ目標に貢献するか？
- [ ] この機能がなくてもユーザーはアプリを使えるか？
- [ ] 3ヶ月後に振り返って「やってよかった」と言えるか？
- [ ] ADR-0034 の禁止リストに抵触していないか？
