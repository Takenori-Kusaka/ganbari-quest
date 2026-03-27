# #0111 SQLite → DynamoDB 移行

## Status: Done
## 優先度: 高
## 種別: アーキテクチャ移行

---

## 概要

現在のSQLite（ローカルファイルDB）をAWS DynamoDBに移行する。Lambda環境では/tmp上のSQLiteは一時的なワークアラウンドに過ぎず、コールドスタートごとにデータが消失する。SaaS展開に必須の永続化基盤を構築する。

## 背景

- #0064 でLambda + CloudFront + Route53のサーバレスインフラは構築済み
- 現在はLambda冷起動時に/tmp上にSQLiteを自動初期化する一時対応（create-tables.ts）
- /tmpは512MB制限かつ揮発性 → データ永続化は不可能
- NUCサーバー（Docker）ではSQLiteが正常動作しているため、移行期間中は両方のバックエンドをサポートする必要がある

## 要件

### リポジトリパターンによる抽象化

環境変数 `DATA_SOURCE` で実行時にバックエンドを切り替える:

```
DATA_SOURCE=sqlite  → 現行のSQLite（NUCサーバー / ローカル開発）
DATA_SOURCE=dynamodb → DynamoDB（AWS Lambda）
```

### 実装方針

#### Phase 1: リポジトリインターフェース抽出

現在の `$lib/server/db/*-repo.ts` を以下の構造にリファクタ:

```
$lib/server/db/
  repositories/
    interfaces/        # 共通インターフェース（TypeScript型定義）
      activity-repo.ts
      child-repo.ts
      status-repo.ts
      ...
    sqlite/            # 現行SQLite実装
      activity-repo.ts
      child-repo.ts
      ...
    dynamodb/          # 新規DynamoDB実装
      activity-repo.ts
      child-repo.ts
      ...
  factory.ts           # DATA_SOURCE に基づくリポジトリ生成
```

#### Phase 2: DynamoDBテーブル設計

シングルテーブルデザインを採用し、GSIで多様なアクセスパターンに対応:

| PK | SK | 用途 |
|----|-----|------|
| CHILD#<id> | PROFILE | 子供プロフィール |
| CHILD#<id> | STATUS#<categoryId> | ステータス値 |
| CHILD#<id> | ACTIVITY_LOG#<date>#<activityId> | 活動記録 |
| CHILD#<id> | ACHIEVEMENT#<code> | 実績 |
| CHILD#<id> | TITLE#<titleId> | 称号 |
| SETTINGS | <key> | 設定値（PIN等） |
| CATEGORY#<id> | PROFILE | カテゴリマスタ |
| ACTIVITY#<id> | PROFILE | 活動マスタ |

※ 詳細設計はPhase 2開始時に全アクセスパターンを洗い出して決定

#### Phase 3: DynamoDBリポジトリ実装

- AWS SDK v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`)
- トランザクション: `TransactWriteItems` でポイント付与+ステータス更新の原子性保証
- 既存ユニットテストをリポジトリインターフェース経由で実行し、SQLite/DynamoDB両方で通過を確認

#### Phase 4: CDK + マイグレーション

- DynamoDBテーブル定義をCDK（infra/）に追加（既に `storage-stack.ts` に基本テーブルあり）
- データ移行スクリプト: SQLite → DynamoDB の一括エクスポート/インポート
- NUCサーバーの既存データをDynamoDBに移行

### 対象リポジトリファイル（移行が必要）

- `activity-repo.ts` — 活動マスタCRUD
- `achievement-repo.ts` — 実績解除・一覧
- `avatar-repo.ts` — アバター画像パス
- `career-repo.ts` — キャリアプラン
- `checklist-repo.ts` — チェックリスト
- `evaluation-repo.ts` — 週次評価
- `login-bonus-repo.ts` — ログインボーナス
- `point-repo.ts` — ポイント残高・台帳
- `status-repo.ts` — ステータス値・レベル
- `title-repo.ts` — 称号

### 対象外（本チケットのスコープ外）

- Cognito統合（#0066 OAuth認証で対応）
- S3画像ストレージ（既にCDKで構築済み、別途対応）

## 依存チケット

- #0064 AWSサーバレスインフラ構築（前提: Lambda + DynamoDBテーブル構築済み）

## 完了条件

- [x] リポジトリインターフェース抽出完了
- [x] `DATA_SOURCE=sqlite` で全既存テスト（vitest + E2E）通過
- [x] DynamoDBシングルテーブル設計ドキュメント作成
- [x] DynamoDBリポジトリ実装完了
- [x] `DATA_SOURCE=dynamodb` でユニットテスト通過（DynamoDB Local使用）
- [x] CDKにDynamoDBテーブル定義追加
- [x] データ移行スクリプト作成・実行
- [x] Lambda環境で正常動作確認
- [x] #0064 の「SQLite → DynamoDB 移行」ゴールをDoneに更新

## 成果・結果

- SQLite→DynamoDBマルチバックエンド移行 Phase 1-6完了
- コミット: 4717145, 1374c6b, ea7e5da, 2d34180, 7ae928a, cad177c

## 見積もり

- 規模: 大（リポジトリ10ファイル + DynamoDB実装 + テスト + マイグレーション）
- 推奨: Phase 1〜4 に分割して段階的に実施
