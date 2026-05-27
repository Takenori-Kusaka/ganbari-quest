# NUC activities → child_activities Data Recovery Runbook

> **対象**: 運用担当 (PO)
> **関連 Issue**: [#2510](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2510)
> **関連 PR**: #2487 (原因 — activity-repo facade rewrite)、#2491 (#2458-A2 demo/dynamodb 同期)、PR #2509 (lazy-startup-migrations.ts 枠組作成)
> **関連 ADR**: ADR-0002 (Critical 5 要件)、ADR-0031 (SQLite ADD COLUMN only)、ADR-0010 (Pre-PMF Bucket A)

---

## 1. 目的

PR #2487 (2026-05-26) で `src/lib/server/db/sqlite/activity-repo.ts` を per-child SSOT (`child_activities` table) に書き換えた際、**既存 production data の copy migration が完全不在**。NUC user の活動履歴 + 登録 activity 一覧が全て表示されない状態 (data 喪失ではないが全件 orphan で UI から見えない) になった。

本 runbook は **再発時 / 別 backend (DynamoDB 等) で同型問題が起きた際** に同じ復旧手順を再現するための SSOT。

### 1.1 達成すべき状態

- `child_activities` table に各 child の activity が copy 済 (referenced + age 適合の union)
- 4 table の `activity_id` FK が `child_activities(id)` を正しく参照 (orphan = 0):
  - `activity_logs`
  - `daily_missions`
  - `activity_mastery`
  - `child_activity_preferences`
- UI 上で活動履歴 + 一覧が正常表示される

---

## 2. 前提条件

| 前提 | 確認方法 |
|------|---------|
| NUC docker container 起動済 | `ssh kusaka-server@192.168.68.79 docker ps` |
| `activities` table に旧 data 残存 | `SELECT COUNT(*) FROM activities` > 0 |
| `child_activities` table が空 (or 部分復旧) | `SELECT COUNT(*) FROM child_activities` |
| `lazy-startup-migrations.ts` `migrateActivityFkSwitchover` が FK swap 済 | `PRAGMA foreign_key_list(activity_logs)` の table = `child_activities` |
| backup を取れる空き容量 | `df -h /app/data` (Linux) or NUC 設定で確認 |

---

## 3. 緊急復旧手順 (実証済 2026-05-27)

### 3.1 状況把握

```bash
# row count 確認
ssh kusaka-server@192.168.68.79 'docker exec ganbari-quest-app-1 sqlite3 /app/data/ganbari-quest.db \
  "SELECT '\''activities'\'' AS t, COUNT(*) AS c FROM activities \
   UNION ALL SELECT '\''child_activities'\'', COUNT(*) FROM child_activities \
   UNION ALL SELECT '\''activity_logs'\'', COUNT(*) FROM activity_logs \
   UNION ALL SELECT '\''children'\'', COUNT(*) FROM children;"'

# orphan 数確認 (4 table)
ssh kusaka-server@192.168.68.79 'docker exec ganbari-quest-app-1 sqlite3 /app/data/ganbari-quest.db \
  "SELECT '\''orphan_logs'\'' AS check_name, COUNT(*) AS c FROM activity_logs al \
   WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = al.activity_id) \
   UNION ALL SELECT '\''orphan_missions'\'', COUNT(*) FROM daily_missions dm \
   WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = dm.activity_id) \
   UNION ALL SELECT '\''orphan_mastery'\'', COUNT(*) FROM activity_mastery am \
   WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = am.activity_id) \
   UNION ALL SELECT '\''orphan_prefs'\'', COUNT(*) FROM child_activity_preferences cp \
   WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = cp.activity_id);"'
```

### 3.2 backup (rollback 用 — **必須**)

```bash
# DB を sqlite3 .backup で安全に hot backup
ssh kusaka-server@192.168.68.79 \
  'docker exec ganbari-quest-app-1 sqlite3 /app/data/ganbari-quest.db \
   ".backup '\''/app/data/ganbari-quest.db.backup-pre-recovery-$(date +%Y%m%d)'\''"'

# 確認
ssh kusaka-server@192.168.68.79 'docker exec ganbari-quest-app-1 ls -la /app/data/'
```

### 3.3 recovery script を NUC に転送

```bash
# Windows host 経由で container に配置 (NUC 環境特有)
scp scripts/recover-activities-data.mjs \
    "kusaka-server@192.168.68.79:C:/Users/kusaka-server/recover-activities-data.mjs"
ssh kusaka-server@192.168.68.79 \
  "docker cp C:/Users/kusaka-server/recover-activities-data.mjs ganbari-quest-app-1:/app/recover-activities-data.mjs"
```

> **重要**: container の `/tmp` には `node_modules` resolver が及ばないため、必ず `/app/` 配下に配置する。

### 3.4 dry-run (必ず最初に実行)

```bash
ssh kusaka-server@192.168.68.79 \
  "docker exec -e DRY_RUN=1 ganbari-quest-app-1 node /app/recover-activities-data.mjs"
```

期待出力:

```
[recover-activities-data] DB: /app/data/ganbari-quest.db (DRY_RUN)
[recover] children: 2
  - id=1 nickname=ゆうきちゃん age=4
  - id=6 nickname=たくみくん age=0
[recover] BEFORE: orphan_logs=355 orphan_missions=177 orphan_mastery=40 orphan_prefs=0
[recover] DRY_RUN — exiting without changes
```

### 3.5 本実行

```bash
ssh kusaka-server@192.168.68.79 \
  "docker exec ganbari-quest-app-1 node /app/recover-activities-data.mjs"
```

期待出力 (NUC 2026-05-27 実績):

```
[recover] child id=1 (ゆうきちゃん, age 4): referenced=54 age_fit=55 union=55
[recover] child id=6 (たくみくん, age 0): referenced=12 age_fit=21 union=21
[recover] inserted 76 child_activities rows (mapping size: 76)
[recover] activity_logs remapped: 355 / 355
[recover] daily_missions remapped: 177 / 177
[recover] activity_mastery remapped: 40 / 40
[recover] child_activity_preferences remapped: 0 / 0
[recover] AFTER: orphan_logs=0 orphan_missions=0 orphan_mastery=0 orphan_prefs=0
[recover] SUCCESS — transaction committed, orphan = 0 across 4 tables
[recover] FINAL child_activities: 76 total
  - child_id=1: 55 activities
  - child_id=6: 21 activities
```

### 3.6 UI 復旧確認

```bash
# health check
ssh kusaka-server@192.168.68.79 "curl -sf -o NUL -w '%{http_code}' http://localhost:3000/"
# 期待: 302 (login redirect)
```

ブラウザで `/admin/activities` (活動一覧) と `/admin/status/<childId>` (履歴) を開いて表示確認。

> **注**: better-sqlite3 は同一 file を即時 read するため、container restart は不要。

---

## 4. rollback 手順

万一データが不整合化した場合:

```bash
# container 停止
ssh kusaka-server@192.168.68.79 "docker stop ganbari-quest-app-1"

# backup から戻す (例: 2026-05-27 の backup)
ssh kusaka-server@192.168.68.79 \
  "docker exec ganbari-quest-app-1 cp /app/data/ganbari-quest.db.backup-pre-recovery-20260527 /app/data/ganbari-quest.db"

# WAL / SHM を削除 (古い backup 復元時に必須)
ssh kusaka-server@192.168.68.79 \
  "docker exec ganbari-quest-app-1 rm -f /app/data/ganbari-quest.db-wal /app/data/ganbari-quest.db-shm"

# 再起動
ssh kusaka-server@192.168.68.79 "docker start ganbari-quest-app-1"
```

---

## 5. recovery script の安全性 (script 内部設計)

`scripts/recover-activities-data.mjs` は以下の安全策を持つ:

1. **idempotency**: `child_activities` が空でない場合は無条件 skip (既復旧済の二重実行を防止)
2. **dry-run**: `DRY_RUN=1` env で書き込み skip
3. **transaction**: 全 INSERT / UPDATE を 1 つの `db.transaction(() => {...})` でラップ
4. **post-condition assert**: 完了時に 4 table の orphan count を再確認、1 件でも残れば `throw` → 自動 ROLLBACK
5. **PRAGMA foreign_keys = OFF**: shadow operation 中の FK trip を回避、終了時に必ず `= ON` に戻す
6. **copy 範囲の最小性**: 各 child について「referenced (history 保全) ∪ age 適合 (UI 表示用) ∪ is_archived = 0」のみ copy。冗長な data 増殖を回避

---

## 6. 恒久 fix (実装済 — PR #2513)

本 runbook は **緊急対応** のみを扱う。再発防止のための **恒久 fix** は **PR #2513 で実装完遂済**:

- ✅ `src/lib/server/db/migration/lazy-startup-migrations.ts` に `migrateActivitiesLegacyDataCopy()` 関数を実装
- ✅ 同 file の `applyLazyStartupMigrations()` 呼出順を `migrateActivityFkSwitchover` の **直後** に挿入 (FK target 切替後でないと remap が整合しないため順序固定)
- ✅ guards (冪等): `activities`/`child_activities`/`children` 不在 OR `child_activities` 非空 OR 4 table orphan ゼロ で skip
- ✅ source/target 双方に存在する column のみ copy (古い schema の column 欠落に耐える) + age 列無し旧 schema では referenced のみ copy
- ✅ orphan = 0 post-condition を transaction 内 assert (残れば throw → ROLLBACK)
- ✅ 新規 NUC environment / dev / CI でも startup 時に自動適用される
- ✅ 回帰テスト: `tests/unit/db/lazy-startup-migrations.test.ts` (data copy 5 ケース: referenced ∪ age 適合 / 5 年齢モード分岐 / 冪等 / orphan ゼロ skip / age 列無し) + `tests/integration/db/startup-upgrade-path.test.ts` (startup full path で UI 一覧 + 履歴 JOIN 成立)

**通常運用では本 runbook の手動実行は不要** (startup migration が自動修復)。本 runbook はリカバリ参照手順として残存 (DynamoDB 等別 backend で同型問題が起きた際 / NUC で明示再実行したい際に利用)。`scripts/recover-activities-data.mjs` は同 logic の NUC container 単発実行版として維持 (runtime 都合で `.ts` helper を import 共有できないため SQL logic を 2 箇所同期、#2513)。

---

## 7. 教訓 (4 dimension SSOT — schema migration の責務分離)

schema 破壊変更 PR では以下 **4 file** を必ず同期更新する:

1. `src/lib/server/db/schema.ts` — drizzle table 定義 (TypeScript 型 SSOT)
2. `src/lib/server/db/create-tables.ts` — `CREATE TABLE/INDEX IF NOT EXISTS` 群 (新規 DB / dev / CI 用)
3. `src/lib/server/db/migration/lazy-startup-migrations.ts` — **structural** migration (shadow-table recreation / DROP COLUMN / FK target 切替)
4. `src/lib/server/db/migration/lazy-startup-migrations.ts` — **data copy** migration (cross-table semantic flip 時の row 移動)

(3) と (4) は同 file 内に並んで実装されるが、責務が異なる:

- (3) = schema 形状の変更 (column / FK target / NOT NULL 等)
- (4) = データの cross-table semantic flip (例: per-table → per-child、family master → tenant scope 等)

PR #2487 (activities → child_activities flip) は (3) のみ実装され (4) を漏らした典型例。
PR #2480 (checklist_templates flip) は **PR #2509 で per-child → assignments 1 row 移行** (data copy 込) として既に完遂済 ((3)+(4) を 1 PR で完遂した好例)。

---

## 8. 関連リソース

- 緊急復旧 script: `scripts/recover-activities-data.mjs`
- 恒久 fix 実装: `src/lib/server/db/migration/lazy-startup-migrations.ts` `migrateActivitiesLegacyDataCopy()` (PR #2513)
- 関連 Issue: [#2510](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2510) (umbrella) / [#2513](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2513) (恒久 fix)
- 関連 PR: [#2509](https://github.com/Takenori-Kusaka/ganbari-quest/pull/2509) (lazy-startup-migrations.ts 枠組) / [#2512](https://github.com/Takenori-Kusaka/ganbari-quest/pull/2512) (緊急 recovery script + runbook)
- 原因 PR: [#2487](https://github.com/Takenori-Kusaka/ganbari-quest/pull/2487) (activity-repo facade rewrite)
- 同型対応 ref PR: [#2509](https://github.com/Takenori-Kusaka/ganbari-quest/pull/2509) (checklist_templates flip data copy)
- ADR: [ADR-0002](../decisions/0002-critical-fix-quality-gate.md) (Critical 5 要件)、[ADR-0031](../decisions/archive/0031-schema-change-compat-testing.md) (SQLite ADD COLUMN only)、[ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md) (Bucket A)
- 教訓 memory: `feedback_schema_ssot_create_tables_sync.md` (4 dimension SSOT)
