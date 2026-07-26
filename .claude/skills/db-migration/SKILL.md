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
- [ ] `src/lib/server/db/dsql/schema.ts` — cloud (DSQL) / NUC (PGlite) 共用 pg schema
- [ ] `docs/design/08-データベース設計書.md` — 設計書
- [ ] マイグレーションファイル — `npx drizzle-kit generate`

### 2. ADR-0031: 既存データ互換性（必須）

- [ ] NULL 混在行テスト — 既存データに NULL が存在する可能性を考慮
- [ ] backfill UPDATE — 新カラム追加時は既存行のデフォルト値更新を同梱
- [ ] NOT NULL 制約追加時は先に backfill してから制約追加

### 3. fresh-DB 互換 + cross-backend 3 経路検証（#3925 / #3928、第17回リリース 4 連続 blocker の教訓）

ADR-0031 (既存データ互換) と**対**で必須。migration は「既存 state を持つ本番」だけでなく
「**空 DB からの全 migration 貫通**」(fresh staging provision / 新規 NUC / DR 再構築) でも成立させる:

- [ ] **fresh-DB 貫通**: 空 DB に全 migration を journal 順で通して成功するか。既存 table / 行の
      存在を仮定する文 (`SELECT FROM <旧表>` 等) は IF (NOT) EXISTS guard で fresh-safe 化する
      (`tests/unit/db/dsql-migration-provision.test.ts` [PV6] が機械検出)
- [ ] **cross-backend 3 経路**: 同一 migration SQL でも実行 semantics が backend で異なる —
      ① PGlite/NUC = raw SQL 記載順 ② sqlite = lazy-startup (`tableExists` guard) ③ DSQL =
      `transform.ts` plan 経由 (runner が source 順 statements を per-statement autocommit 適用、#3928)。
      **片側 (PGlite) の verify だけで Done としない**。順序依存 migration (DDL→DML→DDL 型の
      fold 等) は transform+runner pipeline test ([PV7]/[PV8]) でも確認する
- [ ] **不変条件**: 「同一 migration は全 executor で同一終端 schema に到達する」— 逸脱は
      staging (release gate) でなく unit 層で検出する (ADR-0061 push-down-pyramid)

### 4. startup migration の fail-fast 落とし穴（#3286 infra-1）

`applyLazyStartupMigrations` は **try/catch + rollback + 再 throw（fail-fast）** の意図的設計。冪等 / skip 可能な migration は安全だが、**確定的に throw する migration（例: 前提行不在で例外）を仕込むと cold-start でプロセスが brick する**（起動のたびに同じ例外で落ち続ける）。

- [ ] startup migration は **冪等**（再実行・部分適用済でも成功）かつ **前提不在時は skip**（throw でなく no-op）にする
- [ ] 不可逆 / 失敗時に手当てが要る migration は startup ではなく **明示的な運用手順（runbook）** に置く
- [ ] migration が throw しうる場合、cold-start brick の影響範囲（全リクエスト 5xx）を許容できるか事前評価する

### 5. journal `when` を手で書き換えない（#3946 本番 500 / #3948 class-lock）

`drizzle/pglite/meta/_journal.json` の `when` は **drizzle-kit が入れた `Date.now()` をそのまま使う**。手で書き換えてはならない。

drizzle-orm の migrator（pg-core dialect）は `適用済み最大 created_at < folderMillis` の migration だけを適用する。つまり **実時刻より未来の `when` を一度でも本番 DB へ適用すると、以降 drizzle-kit が生成する全 migration（`when` は実時刻）が既存 DB で永久に skip される**。#3946 はこれで NUC 本番の `/preschool/home` が 500 になった（0002 の手書き丸め値 1784500000000 が未来 → 0003/0004 が永久 skip → `login_streaks` 未作成）。

- [ ] `when` は `npx drizzle-kit generate` の出力のまま（丸め値・連番・未来値にしない）
- [ ] 既存 migration の `when` を後から編集しない（既に本番 `__drizzle_migrations.created_at` に記録済のため、編集は「適用済みだが journal 上は未適用」の不整合になる）
- [ ] 機械 gate: `scripts/lib/db/drizzle-journal-gate.mjs`（`tests/unit/db/pglite-journal-when-range-3948.test.ts` が CI で hard-fail）

**grandfather 例外**: `1784500000000` / `1784500000001` / `1784500000002`（0002 / 0003 / 0004）は値そのものを修正せず gate の例外として固定している。実生成時刻へ書き戻すと、**#3947 以前の backup から restore した DB（適用済み最大 `created_at` = 1784500000000）で 0003/0004 が永久 skip され #3946 が再発する**ため（`[WR7]` が実 migrator で固定）。**新規にこの例外を増やさないこと**（根拠と一覧の SSOT は `scripts/lib/db/drizzle-journal-gate.mjs` 冒頭コメント）。

`when` を参照するのは PGlite（NUC）経路のみ。DSQL（cloud）の `provision.ts` は `idx` 順 + tag 単位冪等で `when` を見ない（`[WR4]` で固定）。

## 出力フォーマット

```markdown
### スキーマ変更影響分析

| 変更内容 | 影響ファイル | 対応状況 |
|---------|------------|---------|
| [テーブル/カラム] | [ファイルパス] | [ ] |
```
