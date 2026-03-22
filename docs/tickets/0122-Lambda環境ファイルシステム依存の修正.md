# #0122 Lambda環境ファイルシステム依存の修正

## ステータス: Done
## 優先度: 高（本番障害）
## 種別: バグ修正

---

## 概要

#0111 DynamoDB移行後、Lambda本番環境（ganbari-quest.com）で複数のエンドポイントが500エラーを返す。
原因はLambda環境の読み取り専用ファイルシステムに対して`writeFileSync`/`mkdirSync`を実行しているため。

## 影響範囲

| エンドポイント | エラー | 原因 |
|---------------|--------|------|
| `POST /api/v1/children/[id]/avatar` | 500 | `writeFileSync`でアバター保存失敗 |
| `POST /api/v1/images` (avatar/favicon) | 500 | `writeFileSync`で生成画像保存失敗 |
| `GET /uploads/avatars/[filename]` | 404 | ローカルFSにファイルなし |
| 全エンドポイント（ログ） | サイレント失敗 | `appendFileSync`でログ書き込み失敗 |

## 修正方針

S3バケット（`ASSETS_BUCKET` 環境変数）はCDKで構築済み、Lambda IAM権限も付与済み。
`DATA_SOURCE` 環境変数で分岐し、Lambda環境ではS3を使用する。

### 1. S3ストレージユーティリティ新規作成
- `src/lib/server/storage.ts` — `DATA_SOURCE`に基づいてローカルFS/S3を切り替え

### 2. アバターアップロード修正
- `src/routes/api/v1/children/[id]/avatar/+server.ts` — S3対応

### 3. アバター配信修正
- `src/routes/uploads/avatars/[filename]/+server.ts` — S3 GetObject対応

### 4. 画像生成サービス修正
- `src/lib/server/services/image-service.ts` — S3対応

### 5. ロガー修正
- `src/lib/server/logger.ts` — Lambda環境ではファイル書き込みをスキップ（CloudWatch Logsで代替）

### 6. 本番E2Eテスト
- ganbari-quest.com に対するE2Eテストで全不具合ゼロを確認

## 完了条件

- [x] Lambda環境でアバターアップロードが成功する
- [x] Lambda環境でアバター画像が正しく配信される
- [x] Lambda環境でログ書き込みエラーが発生しない
- [x] 本番E2Eテストで500/404エラーがゼロ（21テスト全通過）
- [x] NUC環境の既存動作に影響なし（ローカルE2E 142テスト全通過）

## 依存チケット

- #0111 SQLite → DynamoDB移行（完了）
- #0064 AWSサーバレスインフラ構築（完了）
