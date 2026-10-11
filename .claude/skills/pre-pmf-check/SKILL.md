---
name: Pre-PMF Check
description: Use when evaluating whether a feature or task is appropriate for the pre-PMF stage. Checks against ADR-0010 (Pre-PMF scope judgment — bias prevention + security minimization + priority guidelines).
---

# Pre-PMF バイアスチェック (ADR-0010)

## エンジニアバイアス防止

### 優先度判断マトリクス

| 優先度 | 条件 |
|--------|------|
| **Critical** | 本番障害・データ損失・セキュリティ脆弱性 |
| **High** | 顧客価値 + 事業推進の両方が Yes |
| **Medium** | どちらか一方が Yes |
| **Low** | 技術負債のみ Yes、または全て No |

- `priority:high` 以上を付ける基準は ADR-0010 §3（この機能がなくてもサインアップ目標に到達できるか）が SSOT。本マトリクスは補助の目安
- **適用範囲は新規機能の追加・過剰防衛設計・新規 OSS/基盤の導入だけ**（ADR-0010 §0）。既存実装の品質向上・refactoring・移管の完遂・bug fix・データ整合・security 是正を「Pre-PMF だから」で Low に落とさない

### エンジニアバイアスの典型パターン

以下に該当する場合は優先度を下げることを検討:

- 「将来必要になるから今やっておく」→ YAGNI
- 「アーキテクチャ的に正しいから」→ ユーザー価値は？
- 「技術的に面白いから」→ 事業貢献は？
- 「他プロジェクトではこうしている」→ Pre-PMF の制約は？

## セキュリティ最小化方針

Pre-PMF で**採用しない**もの（SSOT: ADR-0010 §2 / §4）:
- 汎用監査ログの専用テーブル / 基盤（ADR-0010 本文の「DynamoDB」は DSQL 移管前の表記。DB は Aurora DSQL / NUC は PGlite で、DB を問わず不採用）
- S3 + Athena による分析基盤
- AWS WAF
- IP 単位ブルートフォース検知（ADR-0010 §2 の「IP カウンタ / Discord アラート」。ただしアプリ層の IP 単位レート制限 `src/lib/server/security/rate-limiter.ts` とアカウント単位ロックアウト `account-lockout.ts` は実装済・稼働中なので、「不採用だから存在しない」前提で判定しない）

Pre-PMF で**十分な**もの:
- HMAC 鍵強度
- レート制限（ADR-0010 §2 は「API Gateway 標準スロットリング」と書くが、現構成 = CloudFront + Lambda Function URL に API Gateway は無い。実体はアプリ層のインメモリ rate limiter `src/lib/server/security/rate-limiter.ts`）
- AWS Budgets アラート
- 既存 state カラム

## チェックリスト

- [ ] この機能は今月のサインアップ目標に貢献するか？
- [ ] この機能がなくてもユーザーはアプリを使えるか？
- [ ] 3ヶ月後に振り返って「やってよかった」と言えるか？
- [ ] ADR-0010 の禁止リストに抵触していないか？
