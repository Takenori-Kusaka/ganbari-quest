---
name: DB Migration
description: Use when changing database schema (adding/modifying tables, columns, or indexes). Checks parallel implementations, test data, and ADR-0031 compatibility requirements.
---

# スキーマ変更の並行実装チェック

## 変更前チェックリスト

### 1. 並行実装の同期（8 箇所）

スキーマを変更する場合、以下の全てを同期:

- [ ] `src/lib/server/db/schema.ts` — 本体のスキーマ定義
- [ ] `tests/e2e/global-setup.ts` — E2E テスト用のシードデータ
- [ ] `tests/unit/helpers/test-db.ts` — ユニットテスト用のヘルパー
- [ ] `src/lib/server/demo/demo-data.ts` — デモモード用のサンプルデータ
- [ ] `src/lib/server/db/types.ts` — 型定義（DynamoDB の場合）
- [ ] `docs/design/08-データベース設計書.md` — 設計書
- [ ] マイグレーションファイル — `npx drizzle-kit generate`

### 2. ADR-0031: 既存データ互換性（必須）

- [ ] NULL 混在行テスト — 既存データに NULL が存在する可能性を考慮
- [ ] backfill UPDATE — 新カラム追加時は既存行のデフォルト値更新を同梱
- [ ] NOT NULL 制約追加時は先に backfill してから制約追加

### 3. DynamoDB 固有チェック

- [ ] PK/SK の設計は `src/lib/server/db/dynamodb/keys.ts` に準拠
- [ ] GSI の追加は最小限（既存 GSI で対応できないか先に検討）
- [ ] 新エンティティの ID 採番は `counter.ts` の `nextId()` を使用

## 出力フォーマット

```markdown
### スキーマ変更影響分析

| 変更内容 | 影響ファイル | 対応状況 |
|---------|------------|---------|
| [テーブル/カラム] | [ファイルパス] | [ ] |
```
