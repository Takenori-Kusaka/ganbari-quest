# 0012. DynamoDB シングルテーブル設計

> **archived (2026-04-20)**: no longer active-primary, kept for historical reference (#1262 sub-B)


| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-02-20 |
| 起票者 | 日下武紀 |

## コンテキスト

SaaS 展開に向けて、AWS 上のデータベースを選定する必要がある。ローカル開発は SQLite (WAL mode) で行っており、本番用 DB が必要。個人開発のためコスト最小化が必須。

## 検討した選択肢

### 選択肢 A: RDS (Aurora Serverless v2)
- メリット: SQL そのまま、Drizzle ORM と親和性高い
- デメリット: 最低月額 $10-20、コールドスタート遅い

### 選択肢 B: DynamoDB (シングルテーブル)
- メリット: 無料枠が大きい（25GB, 25WCU/25RCU）、ゼロスケール可能、レイテンシ安定
- デメリット: スキーマ設計が複雑、SQL 使えない

### 選択肢 C: PlanetScale / Supabase
- メリット: MySQL/PostgreSQL、マネージド
- デメリット: 外部サービス依存、無料枠制限

## 決定

DynamoDB シングルテーブル設計を採用。PK/SK パターンでテナント単位のデータ分離を実現。

- PK: `TENANT#t1`, `TENANT#t1#CHILD#c1` 等
- SK: `PROFILE`, `ACT#2026-03-06#a1`, `STATUS` 等
- GSI1 (SK → PK): 逆引きクエリ用

## 結果

- Repository パターンで SQLite/DynamoDB を切替可能にする（ADR-0015）
- 月額コスト $0（無料枠内）を実現
- クエリパターンは PK/SK ベースに限定（柔軟な検索は GSI で対応）
