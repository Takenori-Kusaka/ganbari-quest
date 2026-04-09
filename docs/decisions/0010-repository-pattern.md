# 0010. Repository パターンによる DB 抽象化

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-02-15 |
| 起票者 | 日下武紀 |

## コンテキスト

LAN 版（SQLite）と SaaS 版（DynamoDB）の2つのデータベースバックエンドをサポートする必要がある。サービス層が DB 実装の詳細に依存すると、デュアルバックエンドの維持が困難になる。

## 決定

Repository パターン + Factory パターンで DB アクセスを抽象化:

```
src/lib/server/db/
  interfaces/        ← リポジトリインタフェース定義
  sqlite/            ← SQLite (Drizzle ORM) 実装
  dynamodb/          ← DynamoDB (AWS SDK v3) 実装
  factory.ts         ← AUTH_MODE で実装を切替
  {name}-repo.ts     ← ファサード（factory 経由で透過的に提供）
```

- `AUTH_MODE=cognito` → DynamoDB 実装
- `AUTH_MODE=local` → SQLite 実装
- デモモード → インメモリデータ (demo-data.ts)

## 結果

- サービス層は DB 実装の詳細を知らない
- 新しいテーブル追加時は interface → sqlite → dynamodb(stub) → facade → factory の順で追加
- ローカル開発は SQLite で高速に動作、本番は DynamoDB でスケーラブル
