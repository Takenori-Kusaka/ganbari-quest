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

### 4. startup migration の fail-fast 落とし穴（#3286 infra-1）

`applyLazyStartupMigrations` は **try/catch + rollback + 再 throw（fail-fast）** の意図的設計。冪等 / skip 可能な migration は安全だが、**確定的に throw する migration（例: 前提行不在で例外）を仕込むと cold-start でプロセスが brick する**（起動のたびに同じ例外で落ち続ける）。

- [ ] startup migration は **冪等**（再実行・部分適用済でも成功）かつ **前提不在時は skip**（throw でなく no-op）にする
- [ ] 不可逆 / 失敗時に手当てが要る migration は startup ではなく **明示的な運用手順（runbook）** に置く
- [ ] migration が throw しうる場合、cold-start brick の影響範囲（全リクエスト 5xx）を許容できるか事前評価する

## 出力フォーマット

```markdown
### スキーマ変更影響分析

| 変更内容 | 影響ファイル | 対応状況 |
|---------|------------|---------|
| [テーブル/カラム] | [ファイルパス] | [ ] |
```
