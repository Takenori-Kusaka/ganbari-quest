# Phase 6 子 3 — DB migration script 詳細設計 (4 backend 整合) SSOT

| 項目 | 内容 |
|------|------|
| 孫 issue | #2663 (Phase 6 グループ B、子 1 #2661 完了が前提) |
| 親 | Phase 6 親 (Phase 7 統合 PR 5 step Step 1 の SSOT) / Epic #2525 |
| 上位 (Phase 5) | 子 3 #2641 ([phase5-webhook-idempotency-architecture](phase5-webhook-idempotency-architecture.md)) / 子 4 #2642 ([phase5-archive-unified-architecture](phase5-archive-unified-architecture.md)) |
| 上位 (Phase 6 子 1) | #2661 ([phase6-phase7-execution-ssot](phase6-phase7-execution-ssot.md)) §3 Step 1 (本 docs の上位 SSOT、file 一覧の起点) |
| 並列対象 | 子 2 #2662 (Test clock 6 シナリオ) / 子 4 #2664 (文脈判断 6 件 + lookup_key 段階移行) |
| 連動 (Phase 7) | Step 1 (DB migration 実行 PR、推定 200 行) |
| ステータス | 設計確定 (本 PR で docs SSOT、コード変更は Phase 7 Step 1) |
| 起点 | Phase 5 子 3+4 で確定した DB schema 変更 (`stripe_webhook_events` 新規 + `archived_reason` enum) を 4 backend (sqlite / dynamodb / in-memory mock / e2e fixture) で同期投入し、Phase 7 Step 2 以降の atom 統合 / lookup_key 移行 / webhook shadow-mode を「schema 配備済み」状態で着手できるようにする |

> **位置づけ**: Phase 6 グループ B の DB 層 SSOT。Phase 5 子 3 (`stripe_webhook_events` 新規 table) + 子 4 (`archived_reason` enum 3 値) を **Phase 7 Step 1 (DB migration、推定 200 行) で 1 PR にまとめて投入** する際の、4 backend 整合 / migration 順序 / rollback / kill switch / e2e fixture 同期 を確定する。Phase 7 実装者は本 docs を参照するだけで「どの file をどの順序で触り、何を assert するか」が一意に決まる状態を確立する。

## 1. 設計背景 (§1)

### 1.1 課題: Phase 5 子 3+4 の DB 変更を 1 PR にまとめないと Phase 7 Step 2 以降が schema 不在で起動失敗する

Phase 6 子 1 #2661 §3 Step 1 で確定:

> **Step 1: DB migration (子 3 #2641 + 子 4 #2642 連動、推定 200 行)**
> 目的: `stripe_webhook_events` 新規 + `archived_reason` enum 拡張を 4 backend (sqlite / dynamodb / in-memory / interface) で同期投入

しかし子 1 #2661 は **「順序の全体図」のみ SSOT 化**しており、Step 1 の **具体的な file 一覧 / migration 順序 / 4 backend 整合 checklist / rollback migration / e2e fixture diff** は未確定。本 #2663 でこれを補完する。

確定しないと以下が発生する:

1. **drizzle schema 4 location (`schema.ts:40,70,109,430`) の `archived_reason` enum 制約追加を 1 location 漏らす** → drizzle-orm 経路の書込みで「不正 reason」を runtime 検知できず、`'dunning_canceled'` row が `archived_reason='unknown'` 等に化ける
2. **`tests/e2e/global-setup.ts` (`ALTER TABLE ... ADD COLUMN`) と `tests/unit/helpers/test-db.ts` (CREATE TABLE) と `src/lib/server/db/create-tables.ts` (CREATE TABLE IF NOT EXISTS) の 3 fixture が DDL 差分で乖離** → 同 spec が unit test では PASS、E2E では `no such column / table` で fail する分岐 hell (#2508 / #2510 と同型の 4 dimension 同期漏れ)
3. **既存 archived レコード (NULL) の補充 migration を Step 2 以降の atom rename PR と混ぜる** → atom rename の rollback で migration も巻き戻り、archived data が再び NULL に戻る非可逆事故
4. **Stripe webhook shadow mode (Step 4-a) 開始時に `stripe_webhook_events` table 不在** → shadow handler が `findByEventId` で「table not found」例外 → shadow mode 検証が一切できない

### 1.2 課題: 4 backend の DB schema 差異が SSOT 化されていない

現状 (2026-05-30 検証):

| backend | `archived_reason` 列 | `stripe_webhook_events` table | 整合手順 SSOT |
|---|---|---|---|
| sqlite (drizzle `schema.ts`) | `text('archived_reason')` 4 location (`children`:40 / `activities`:70 / `child_activities`:109 / `checklist_templates`:430)、CHECK 制約なし | なし | 本 #2663 で確定 |
| dynamodb (`dynamodb/keys.ts`) | attribute なし (free-form text)、CHECK 制約なし | なし | 本 #2663 で確定 |
| in-memory mock (`db/demo/*.ts`) | `child-repo.ts` / `activity-repo.ts` / `child-activity-repo.ts` / `checklist-repo.ts` で `archivedReason: string \| undefined` 型 (4 file) | なし | 本 #2663 で確定 |
| e2e fixture (`tests/e2e/global-setup.ts`) | `ALTER TABLE ... ADD COLUMN archived_reason TEXT` × 3 table (`children` / `activities` / `checklist_templates`) at L37-51 + CREATE TABLE 内 (L93/488) | なし | 本 #2663 で確定 |
| unit test fixture (`tests/unit/helpers/test-db.ts`) | `archived_reason TEXT` × 4 CREATE TABLE (L64 / L91 / L120 / L402) + `ALL_TABLES` 配列 (L824) | なし | 本 #2663 で確定 |
| legacy schema fixture (`tests/fixtures/legacy-schema/2026-05.sql`) | 既存 archived_reason 列定義あり (#2362 PR-3 / PR-5 で導入) | なし | 本 #2663 で確定 |

→ Phase 7 Step 1 PR で **6 location** (drizzle schema 4 col + dynamodb keys 1 const + in-memory 4 repo + e2e fixture 1 file + unit test fixture 1 file + legacy schema fixture 1 file = 13 file 同期) を 1 PR で完遂する必要がある。`docs/design/parallel-implementations.md` §「並行実装ペア (DB スキーマ)」表 (`既知の並行ペア` line 285-291) にも追補が必要。

### 1.3 課題: Drizzle migration script 機構の選定 (drizzle/ ディレクトリ vs lazy-startup-migrations.ts)

`drizzle-kit generate` の標準 output (`drizzle/0XXX_<name>.sql`) は本リポジトリでは **未採用**。本リポジトリは `src/lib/server/db/migration/lazy-startup-migrations.ts` の **4 dimension SSOT** (#2508 / #2510 教訓、`lazy-startup-migrations.ts` L29-50 コメント) で migration を管理:

1. `schema.ts` — drizzle table 定義 (型 SSOT)
2. `create-tables.ts` — `CREATE TABLE IF NOT EXISTS` (新規 DB 用)
3. `lazy-startup-migrations.ts` (structural) — `ALTER TABLE` / shadow-table recreation / FK switch (既存 production DB schema 更新)
4. `lazy-startup-migrations.ts` (data copy) — cross-table row 再配置

本 #2663 では `drizzle-kit generate` ルートを採用せず、上記 4 dimension SSOT に従う設計を確定する。子 1 #2661 §3 Step 1 では暗黙的に `drizzle/0XXX_phase6_billing.sql` と表記されていたが、本 #2663 で **正式に「4 dimension SSOT に統合、`drizzle/` ディレクトリは作成しない」と確定** する。

### 1.4 設計がなかった場合に何が困るか (4 シナリオ)

1. **Phase 7 Step 1 PR で `archived_reason` enum を `schema.ts` 1 location のみに追加 (4 location 全て揃えず)** → drizzle-orm 書込み経由は enum 検証されるが、`sqlite/child-repo.ts` の生 SQL 経由書込み (`UPDATE children SET archived_reason = ?`) は無検証で `'dunning_canceled'` row が `'foo'` に化ける
2. **Phase 7 Step 1 PR を `archived_reason` enum + `stripe_webhook_events` table 分離 (2 PR 化)** → Step 2 (atom 統合 5 sub step) の着手中に Step 1-a (enum) のみマージされ Step 1-b (webhook table) 未マージ状態で Step 4-a (shadow mode) 開始 → table 不在で 500 エラー
3. **既存 NULL archived レコード補充 migration を `lazy-startup-migrations.ts` に追加せず `migrate-local.ts` (dev 専用) のみに実装** → 本番 NUC 起動時に補充が実行されず、`getArchivedResourceSummary` で reason 別件数集計が NULL row を含めて誤集計
4. **e2e fixture (`tests/e2e/global-setup.ts`) に `stripe_webhook_events` CREATE TABLE を追加せず unit test fixture (`tests/unit/helpers/test-db.ts`) のみ追加** → unit test PASS、E2E で `tests/e2e/dunning-canceled-archive.spec.ts` (Phase 5 子 4 §7.3 新規) が `no such table` で fail → CI 緑だが production canary で fail (#2508 startup blocking と同型)

## 2. 設計原則 (§2)

| 原則 | 内容 | 根拠 |
|------|------|------|
| **1. 4 dimension SSOT に統合 (drizzle/ ディレクトリ不採用)** | `schema.ts` + `create-tables.ts` + `lazy-startup-migrations.ts` (structural + data copy) の 4 dimension で migration 完結。`drizzle-kit generate` の output は採用しない | `lazy-startup-migrations.ts` L29-50 + #2508 / #2510 教訓 / 子 1 #2661 §3 Step 1 整合 |
| **2. 1 PR で 6 location × 13 file を同期投入** | Step 1 PR を分割禁止 (2 PR 化禁止)、Step 2 以降の前提として全 file 同期マージ必須 | ADR-0031 (DB migration 互換) / `parallel-implementations.md` §「DB スキーマ並行実装」原則 / [[branch-base-main-freshness]] |
| **3. `archived_reason` enum 3 値は drizzle schema 4 location + dynamodb 書込み層で同期検証** | `archive-types.ts` で `as const` enum SSOT 化 (子 4 #2642 §2 原則 1 整合) + drizzle 4 location で `text(..., { enum: ARCHIVED_REASONS })` + dynamodb 書込み箇所で TypeScript 型強制 | 子 4 #2642 §2 + ADR-0045 (atom / compound) / OSS 先調査記録 (Strategy 不採用、enum + 統合 service 採用) |
| **4. `stripe_webhook_events` は新規 table のみで既存 schema 不変** | DDL 破壊的変更ゼロ (新規 table 1 + 2 index + dynamodb GSI なし single-partition)、rollback は `DROP TABLE` のみで active 0 件影響なし | 子 3 #2641 §7 ADR-0031 整合 / Pre-PMF Bucket A (ADR-0010) |
| **5. 既存 NULL archived レコード補充は `lazy-startup-migrations.ts` に統合 (production / NUC startup で自動実行)** | `migrate-local.ts` のみだと NUC startup で実行されず production canary で初期化失敗 (#2508 と同型) | `lazy-startup-migrations.ts` L29-50 教訓 / Phase 5 子 4 §2 原則 4 (default 補充) |
| **6. rollback migration は `DROP TABLE stripe_webhook_events` + `UPDATE archived_reason = NULL WHERE ...` の 2 段** | enum 制約は drizzle ORM 層のため DDL レベル DROP 不要、`archived_reason` 補充 migration の rollback は補充前 NULL 状態に戻す (data loss 許容、子 5 #2665 連動) | ADR-0031 / 子 5 #2665 ロールバック詳細 SSOT |
| **7. e2e + unit + legacy-schema fixture 3 file 同期** | `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `tests/fixtures/legacy-schema/2026-05.sql` の DDL を 1 PR で揃える (Phase 7 Step 1 PR body checklist で確認) | [[per-issue-execution-workflow]] / `tests/CLAUDE.md` §「スキーマ変更 PR のテスト要件」 / #2508 fixture 4 dimension 同期 |
| **8. DynamoDB は schemaless のため CDK 変更不要 (TTL は既設定)** | `infra/lib/storage-stack.ts` L29 で `timeToLiveAttribute: 'ttl'` 既設定済、Phase 7 で追加変更なし | `storage-stack.ts` L22-39 検証 (2026-05-30) / 子 3 #2641 §5.2 整合 |

## 3. Step 1 対象 file 一覧 (§3) ⭐ 本 docs の核

Phase 7 Step 1 PR (推定 200 行) で同期更新する **13 file** を category 別に列挙する。Phase 7 実装者は本表の file 順に touch + 各 file の AC を 1 つずつ満たす。

### 3.1 sqlite drizzle schema (1 file、4 location)

| file:location | 変更内容 | AC |
|---|---|---|
| `src/lib/server/db/schema.ts:40` (`children.archivedReason`) | `text('archived_reason')` → `text('archived_reason', { enum: ARCHIVED_REASONS })` | drizzle-orm 経路で `'foo'` insert 試行が compile error |
| `src/lib/server/db/schema.ts:70` (`activities.archivedReason`) | 同上 | 同上 |
| `src/lib/server/db/schema.ts:109` (`child_activities.archivedReason`) | 同上 | 同上 |
| `src/lib/server/db/schema.ts:430` (`checklist_templates.archivedReason`) | 同上 | 同上 |
| `src/lib/server/db/schema.ts:末尾` (新規 table 追加) | `stripeWebhookEvents` table + 2 index (子 3 #2641 §3.1 SSOT、`event_id` PK / `event_type` / `processed_at` / `handler_result` / `error_message` / `retry_count` / `tenant_id`) | `npx drizzle-kit generate` で migration 生成成功 (drizzle/ output は採用しないが generate 自体は schema 検証として実施) |

`ARCHIVED_REASONS` import は `import { ARCHIVED_REASONS } from '$lib/domain/archive-types'` (子 4 #2642 §2 原則 1 で新規 file)。

### 3.2 dynamodb keys (1 file、新規定数 2 個)

| file:location | 変更内容 | AC |
|---|---|---|
| `src/lib/server/db/dynamodb/keys.ts:末尾` (新規 export) | `STRIPE_WEBHOOK_EVENT_PK = 'STRIPE_WEBHOOK_EVENT'` 定数 + `stripeWebhookEventKey(eventId): DynamoKey` 関数 + `STRIPE_WEBHOOK_EVENT_TTL_DAYS = 30` 定数 (子 3 #2641 §3.2 SSOT) | dynamodb 書込み層 (Phase 7 で `dynamodb/webhook-event-repo.ts` 新規) から `stripeWebhookEventKey('evt_xxx')` 呼出で `{ PK: 'STRIPE_WEBHOOK_EVENT', SK: 'evt_xxx' }` 返却 |

`archived_reason` 関連の dynamodb 既存書込み (`dynamodb/child-repo.ts` / `dynamodb/checklist-repo.ts` 2 file) は enum SSOT を import + TypeScript 型強制で検証。DDL レベル変更なし (schemaless)。

### 3.3 in-memory mock (4 file、`ArchivedReason` 型強制 + 新規 webhook-event-repo)

| file:location | 変更内容 | AC |
|---|---|---|
| `src/lib/server/db/demo/child-repo.ts:既存 archive 関数` | `archivedReason: string \| undefined` → `archivedReason: ArchivedReason \| undefined` 型強制 | unit test で `archivedReason: 'foo'` が compile error |
| `src/lib/server/db/demo/activity-repo.ts:既存 archive 関数` | 同上 | 同上 |
| `src/lib/server/db/demo/child-activity-repo.ts:既存 archive 関数` | 同上 | 同上 |
| `src/lib/server/db/demo/checklist-repo.ts:既存 archive 関数` | 同上 | 同上 |
| `src/lib/server/db/demo/webhook-event-repo.ts` (新規 file) | 子 3 #2641 §3.3 の `demoWebhookEventRepo` 実装 (in-memory Map<string, WebhookEventRecord>、`findByEventId` / `insert` / `incrementRetryCount` / `deleteOlderThan` 4 メソッド) | demo Lambda 起動時 (`AUTH_MODE=anonymous + DATA_SOURCE=demo`) で webhook fixture 経由 dedup 動作確認 |

### 3.4 interface 層 (1 file 新規)

| file | 変更内容 | AC |
|---|---|---|
| `src/lib/server/db/interfaces/webhook-event-repo.interface.ts` (新規) | 子 3 #2641 §3.4 の `WebhookEventRecord` 型 + `IWebhookEventRepo` interface (4 メソッド) | factory pattern (`src/lib/server/db/factory.ts`) に 1 行追加 (`webhookEvent: createWebhookEventRepo(...)`) で 4 backend 切替動作 |
| `src/lib/server/db/interfaces/index.ts` (既存拡張) | 新規 interface を re-export | TypeScript 経路で `import { IWebhookEventRepo } from '$lib/server/db/interfaces'` 解決 |

### 3.5 domain 層 (1 file 新規、子 4 #2642 §2 原則 1)

| file | 変更内容 | AC |
|---|---|---|
| `src/lib/domain/archive-types.ts` (新規、子 4 #2642 §2 原則 1) | `ARCHIVED_REASONS = ['trial_expired', 'downgrade_user_selected', 'dunning_canceled'] as const` + `ArchivedReason` 型 + `getRetentionDays(reason): number \| null` helper (free plan 90 日 ADR-0049 整合) | unit test で 3 reason × 2 planTier (free / paid) = 6 ケースの `getRetentionDays` 正常値返却 |

### 3.6 startup migration 機構 (1 file 拡張、§2 原則 5)

| file:location | 変更内容 | AC |
|---|---|---|
| `src/lib/server/db/migration/lazy-startup-migrations.ts:末尾` (新規 export `migrateBillingPhase6`) | (a) `archived_reason IS NULL` の既存 archived レコード (`is_archived=1 AND archived_reason IS NULL`) を `'downgrade_user_selected'` で補充 (子 4 #2642 §2 原則 4)、(b) `stripe_webhook_events` table 存在チェック → 不在時に `CREATE TABLE` + 2 index (idempotent、`create-tables.ts` と diff 0 維持) | (a) integration test (`tests/integration/db/archived-reason-migration.test.ts` 新規、Phase 7 で実装) で「既存 NULL row → 補充後 `'downgrade_user_selected'`」物理確認 / (b) NUC startup シミュレート test で `stripe_webhook_events` table 存在確認 |

### 3.7 create-tables.ts (新規 DB 用 SQL、1 file 拡張)

| file:location | 変更内容 | AC |
|---|---|---|
| `src/lib/server/db/create-tables.ts:末尾` (新規 CREATE TABLE) | `CREATE TABLE IF NOT EXISTS stripe_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, handler_result TEXT NOT NULL, error_message TEXT, retry_count INTEGER NOT NULL DEFAULT 0, tenant_id TEXT);` + `CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at ...` + `CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_result ...` | 新規 dev DB 初期化で table + 2 index 作成成功 (`tests/unit/db/schema.test.ts` 拡張で CREATE TABLE SQL の正規表現一致確認) |

### 3.8 e2e + unit + legacy-schema fixture (3 file 同期、§2 原則 7)

| file:location | 変更内容 | AC |
|---|---|---|
| `tests/e2e/global-setup.ts:51` (既存 archived_reason ALTER 直後) | 新規 CREATE TABLE `stripe_webhook_events` + 2 index 追加 (sqlite ALTER で既存 production 既存環境再現) | E2E spec で `stripe_webhook_events` table 操作可能 |
| `tests/e2e/global-setup.ts:既存 seed 内` | dunning canceled e2e fixture 用に 1 件以上の `archived_reason='dunning_canceled'` archived レコードを seed (子 4 #2642 §4 step 8 整合) | `tests/e2e/dunning-canceled-archive.spec.ts` (Phase 5 子 4 §7.3 新規) で reason 別 banner 表示確認 |
| `tests/unit/helpers/test-db.ts:825` (ALL_TABLES 配列拡張) | `'stripe_webhook_events'` を `ALL_TABLES` 配列に追加 (DROP TABLE truncate ループに含める) + CREATE TABLE SQL を本 file に同期追加 | unit test の DB reset で `stripe_webhook_events` row が消去される (test 間漏洩防止) |
| `tests/fixtures/legacy-schema/2026-05.sql:末尾` | 新規 `CREATE TABLE stripe_webhook_events ...` 追加 (production canary 起動シミュレート用) | `tests/integration/db/startup-upgrade-path.test.ts` で legacy schema → 新 schema upgrade path PASS |

### 3.9 docs (1 file 拡張、§2 原則 7)

| file:location | 変更内容 | AC |
|---|---|---|
| `docs/design/parallel-implementations.md:291` (既知の並行ペア DB スキーマ表) | 2 行追加: (a) `stripe_webhook_events` (#2641 / Phase 5 子 3) + 4 backend 同期 file、(b) `archived_reason` enum (#2642 / Phase 5 子 4) + 4 backend 同期 file | `docs/design/parallel-implementations.md` 表に Phase 7 Step 1 PR で 2 行追加され、将来の reason 追加時に 4 backend 同期手順を 1 段落参照で完遂可能 |

## 4. Migration 順序 + DDL 詳細 (§4)

Phase 7 Step 1 PR の **single commit 内** で以下順序を保証する (rebase / squash でも順序保全)。

### 4.1 DDL 投入順序 (single transaction)

```sql
-- Step 4-1: stripe_webhook_events table 新規 (子 3 #2641 §3.1)
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handler_result TEXT NOT NULL,  -- 'success' | 'error' | 'skipped'
  error_message TEXT,             -- Stripe.Error.message 500 文字 truncate (子 3 §13 #3 PII strip)
  retry_count INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT
);

-- Step 4-2: 2 index 追加 (retention cron + analytics 用、子 3 §3.1)
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
  ON stripe_webhook_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_result
  ON stripe_webhook_events(event_type, handler_result);

-- Step 4-3: 既存 NULL archived_reason 補充 (子 4 #2642 §2 原則 4)
UPDATE children
   SET archived_reason = 'downgrade_user_selected'
 WHERE is_archived = 1 AND archived_reason IS NULL;
UPDATE activities
   SET archived_reason = 'downgrade_user_selected'
 WHERE is_archived = 1 AND archived_reason IS NULL;
UPDATE child_activities
   SET archived_reason = 'downgrade_user_selected'
 WHERE is_archived = 1 AND archived_reason IS NULL;
UPDATE checklist_templates
   SET archived_reason = 'downgrade_user_selected'
 WHERE is_archived = 1 AND archived_reason IS NULL;
```

順序根拠: Step 4-1+4-2 は新規 table のため既存 read 経路に影響ゼロ → 先に投入で安全。Step 4-3 は既存 row UPDATE のため、補充失敗時 (例: trigger 衝突) でも Step 4-1+4-2 はロールバック不要。本 SQL は `lazy-startup-migrations.ts` 新規 `migrateBillingPhase6()` 関数内で `db.exec()` で実行 (sqlite native transaction、SQLite ADR-0031 整合)。

### 4.2 DynamoDB 側

DynamoDB は schemaless + TTL 既設定 (`storage-stack.ts:29 timeToLiveAttribute: 'ttl'`) のため Phase 7 Step 1 で:

- **CDK 変更**: なし
- **書込み層**: `dynamodb/webhook-event-repo.ts` 新規 (Phase 7 Step 1 file 一覧 §3.3 外、Phase 7 Step 4-a で実装) で `stripeWebhookEventKey(eventId)` + `ttl: Math.floor((Date.now() + 30 * 86400 * 1000) / 1000)` を `put` (子 3 §5.2 整合)
- **migration 不要**: 新規 attribute (`event_id` 等) は put 時に自動作成、既存 archived レコードへの reason 補充は **sqlite と同型の data-copy migration** を `dynamodb/repo-helpers.ts` 経由 (Phase 7 Step 1 で実装、本 #2663 scope では「sqlite と同形式の補充 logic を dynamodb 書込み層に追加する」と SSOT 確定)

### 4.3 e2e fixture (sqlite ALTER 同形式)

`tests/e2e/global-setup.ts:51` の `archived_reason TEXT ADD COLUMN` ループ直後に以下を追加:

```typescript
// Phase 6 子 3 (#2663): stripe_webhook_events table 追加
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handler_result TEXT NOT NULL,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at ON stripe_webhook_events(processed_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_result ON stripe_webhook_events(event_type, handler_result)`);
  console.log('[E2E Setup]   Added stripe_webhook_events table + 2 index (#2663).');
} catch (e) {
  console.log('[E2E Setup]   stripe_webhook_events table already exists (#2663).');
}

// Phase 6 子 3 (#2663): 既存 NULL archived_reason 補充
for (const table of ['children', 'activities', 'child_activities', 'checklist_templates']) {
  try {
    db.exec(`UPDATE ${table} SET archived_reason = 'downgrade_user_selected' WHERE is_archived = 1 AND archived_reason IS NULL`);
  } catch {
    // table 未存在は無視
  }
}
```

unit test fixture (`tests/unit/helpers/test-db.ts`) の `ALL_TABLES` 配列 (L824) に `'stripe_webhook_events'` を追加し、test reset 時に row 消去対象に含める。

## 5. Rollback migration 設計 (§5、子 5 #2665 連動)

Step 1 PR を rollback する場合 (Step 4-b cutover 失敗 + 子 5 #2665 SSOT 連動):

### 5.1 sqlite rollback SQL

```sql
-- Rollback Step 4-3: 補充した archived_reason を NULL に戻す
--   注: 補充前後の判別は不可能 (UPDATE で全 NULL → 'downgrade_user_selected' を上書きしたため)
--   → data loss 許容 (子 4 #2642 §2 原則 4 で「default 補充」と確定済、補充前状態への完全復元は不要)
--   → rollback 時は全 archived row を NULL に戻すか、Step 1 マージ前の DB スナップショットから restore
UPDATE children SET archived_reason = NULL WHERE archived_reason = 'downgrade_user_selected';
UPDATE activities SET archived_reason = NULL WHERE archived_reason = 'downgrade_user_selected';
UPDATE child_activities SET archived_reason = NULL WHERE archived_reason = 'downgrade_user_selected';
UPDATE checklist_templates SET archived_reason = NULL WHERE archived_reason = 'downgrade_user_selected';

-- Rollback Step 4-1+4-2: stripe_webhook_events table 削除
DROP INDEX IF EXISTS idx_stripe_webhook_events_processed_at;
DROP INDEX IF EXISTS idx_stripe_webhook_events_type_result;
DROP TABLE IF EXISTS stripe_webhook_events;
```

### 5.2 rollback 実行手順 (子 5 #2665 SSOT 連動、本 docs では概要のみ)

| 状況 | rollback 手順 |
|---|---|
| Step 1 PR マージ直後 (Step 2 着手前) に発覚 | git revert で Step 1 PR の commit を打ち消し → `npm run dev` 起動時に `lazy-startup-migrations.ts` の `migrateBillingPhase6()` が「table 不在 → 何もしない」で idempotent 動作。既存 archived_reason は補充済 row が残るが Step 2 以降に影響なし (data loss 許容) |
| Step 4-b cutover 失敗 (Step 2-4 マージ済) で Step 1 まで巻き戻し必要 | 子 5 #2665 §「kill switch 実演」で SSOT 化された手順に従う (本 #2663 scope 外) |
| DynamoDB | `aws dynamodb delete-item` で `PK=STRIPE_WEBHOOK_EVENT` 全 SK 削除 (Pre-PMF 時点で <100 件想定、scan + delete 1 minute 以内完了) |

### 5.3 既存 archived_reason 補充の rollback 不可逆性 (PO 確認推奨)

§5.1 で記述した通り、補充前の `NULL` row と補充後の `'downgrade_user_selected'` row は **DB 上で区別不能**。子 4 #2642 §2 原則 4 で「default 補充」を確定済のため Phase 7 実装時の意図的選択だが、Phase 7 Step 1 PR body に「rollback 不可逆性を許容、production snapshot を Step 1 マージ前に取得推奨」を **PO 確認チェックボックス** として明記 (子 5 #2665 §「kill switch 実演」連動)。

## 6. Kill switch (§6)

Phase 7 Step 1 自体には **kill switch なし** (DB schema は前方互換、新 column / table 追加のみで既存 read 経路に影響なし、子 1 #2661 §3 Step 1 SSOT 整合)。

Step 2 以降の kill switch (`USE_LOOKUP_KEY` / `STRIPE_WEBHOOK_SHADOW_MODE`) は子 1 #2661 §5.3 + 子 4 #2664 (lookup_key 段階移行) で SSOT 化。

## 7. テスト計画 (§7、Phase 7 Step 1 PR body 必須)

Phase 7 Step 1 PR の Ready 化前に以下を全て PASS させる。

### 7.1 unit test (新規 / 拡張)

| spec | 対象 | カテゴリ |
|---|---|---|
| `tests/unit/domain/archive-types.test.ts` (新規) | `ARCHIVED_REASONS` enum 3 値検証 + `ArchivedReason` 型 + `getRetentionDays(reason)` 6 ケース (3 reason × 2 planTier) | domain |
| `tests/unit/db/schema.test.ts` (拡張) | `CREATE TABLE stripe_webhook_events` SQL 一致 + 2 index 一致 + 既存 archived_reason 4 location の enum 制約検証 | DB schema |
| `tests/unit/db/lazy-startup-migrations.test.ts` (拡張) | `migrateBillingPhase6()` を空 DB で実行 → table 作成成功 + 既存 archived row 補充検証 | startup migration |
| `tests/unit/helpers/test-db.test.ts` (拡張、存在しない場合は新規) | `ALL_TABLES` 配列に `'stripe_webhook_events'` が含まれることを assert | fixture 同期 |

### 7.2 integration test (新規)

| spec | シナリオ |
|---|---|
| `tests/integration/db/archived-reason-migration.test.ts` (新規、子 4 #2642 §7.2 SSOT) | (1) `archived_reason IS NULL` の既存 archived row を 3 件 seed (`is_archived=1, archived_reason=NULL`) → (2) `migrateBillingPhase6()` 実行 → (3) 全 3 row が `archived_reason='downgrade_user_selected'` に補充されたことを物理確認 |
| `tests/integration/db/startup-upgrade-path.test.ts` (拡張) | `tests/fixtures/legacy-schema/2026-05.sql` を seed → `migrateBillingPhase6()` 実行 → `stripe_webhook_events` table 作成成功 + 既存 archived 補充成功 |
| `tests/integration/db/stripe-webhook-events-crud.test.ts` (新規) | (a) `findByEventId('evt_xxx')` → null、(b) `insert({ eventId: 'evt_xxx', ... })` → row 1 件、(c) `incrementRetryCount('evt_xxx')` → retry_count=1、(d) `deleteOlderThan('2026-05-30T00:00:00Z')` → 該当 row 削除 |

### 7.3 E2E test (Phase 7 Step 1 PR では skip、Step 4 で実行)

Step 1 PR は schema 配備のみ、dedup logic は Step 4-a で実装のため E2E は Step 4-a PR で実行 (子 3 #2641 §8 / 子 1 #2661 §11 整合):

- `tests/e2e/dunning-canceled-archive.spec.ts` (Phase 5 子 4 §7.3 新規) — Step 4-a PR で追加
- `tests/e2e/stripe-webhook-idempotency.spec.ts` (子 3 #2641 §8) — Step 4-a PR で追加

Step 1 PR では fixture 配備 + integration test PASS まで担保 (E2E は Step 4 PR で連動)。

### 7.4 Phase 7 Step 1 PR Pre-Ready checklist

`npm run pre-ready -- --pr <step1-pr>` の 10 step に加えて、PR body 必須項目:

- [ ] §3 13 file 全て diff に含まれる (4 dimension SSOT × 4 backend = 13 file)
- [ ] `npx drizzle-kit generate` で migration 生成成功 (drizzle/ 採用しないが schema 検証として実施)
- [ ] `npx vitest run src/lib/server/db/` + `tests/unit/db/` PASS
- [ ] `npx vitest run tests/integration/db/archived-reason-migration.test.ts` PASS
- [ ] `tests/fixtures/legacy-schema/2026-05.sql` 拡張で legacy schema → 新 schema upgrade path PASS
- [ ] `docs/design/parallel-implementations.md` の DB スキーマ並行実装表に 2 行追加
- [ ] PO 確認: 既存 NULL archived 補充の rollback 不可逆性を許容 (§5.3 SSOT)

## 8. Impact-analysis 4 layer + 21 カテゴリ checklist (§8)

本 PR (#2663) は **docs 設計のみ** で新規 1 ファイル追加。Phase 7 Step 1 PR の事前見積として記録。

### 8.1 L1 構文 (grep / ast-grep) — 既存参照件数

2026-05-30 grep 検証済:

| 検索パターン | src/lib/server/db file 件数 | tests file 件数 |
|---|---|---|
| `archived_reason \| archivedReason` | 14 file (`schema.ts` / `create-tables.ts` / `lazy-startup-migrations.ts` / `types/index.ts` / `sqlite/{child,activity,child-activity,checklist}-repo.ts` × 4 / `dynamodb/{child,checklist}-repo.ts` × 2 / `demo/{child,activity,child-activity,checklist}-repo.ts` × 4) | 12 file (`e2e/global-setup.ts` / `fixtures/legacy-schema/2026-05.sql` / `integration/api/{activity,activity-log,point}-api.test.ts` × 3 / `integration/db/{data-orphan-gate,startup-upgrade-path}.test.ts` × 2 / `integration/services/{resource-archive,setup-service}.test.ts` × 2 / `unit/db/{lazy-startup-migrations,schema-validator,schema}.test.ts` × 3 / `unit/helpers/test-db.ts`) |
| `stripe_webhook_events \| stripeWebhookEvents` | 0 件 (新規) | 0 件 (新規) |
| `ARCHIVED_REASONS` (子 4 #2642 §2 原則 1) | 0 件 (新規) | 0 件 (新規) |

→ Phase 7 Step 1 PR の **実 file touch は 13 file** (§3) で完結、L1 grep 対象 14+12 file 中 13 file は touch、残り 13 file (sqlite/dynamodb 既存 repo + integration test の archive 経路) は **既存 string 値 (`'trial_expired'` / `'downgrade_user_selected'`) が enum 3 値に含まれるため変更不要**。

### 8.2 L2 意味 (型 / 同名異義)

- **`'family'` 同名異義 (子 1 #2661 §7 L2 整合)**: Phase 1 補強 2 で確定。本 #2663 scope ではプラン名 atom と独立、`archived_reason` enum は 3 値 (`'trial_expired'` / `'downgrade_user_selected'` / `'dunning_canceled'`) でプラン名と無関係
- **`processedAt` (ISO 8601 string vs sqlite CURRENT_TIMESTAMP)**: sqlite `text` 列で ISO 8601 形式統一、JS 経路で `new Date().toISOString()` 書込み (子 3 §3.1 SSOT)
- **`handlerResult` enum (`'success' \| 'error' \| 'skipped'`)** vs cancellation `category` (`'卒業' \| '離反' \| '中断'`)** — 異 namespace で衝突なし (子 3 §9 L2 整合)

### 8.3 L3 構造 (依存グラフ)

```
src/lib/domain/archive-types.ts (新規、SSOT 起点)
  ├─→ src/lib/server/db/schema.ts (4 location enum 制約)
  ├─→ src/lib/server/db/demo/*.ts (4 repo 型強制)
  ├─→ src/lib/server/services/resource-archive-service.ts (子 4 #2642 §4 step 2 で移行)
  └─→ src/lib/server/services/downgrade-service.ts (子 4 #2642 §4 step 2 で移行)

src/lib/server/db/dynamodb/keys.ts (新規 2 const + 1 関数)
  └─→ src/lib/server/db/dynamodb/webhook-event-repo.ts (Phase 7 Step 4-a で新規)

src/lib/server/db/interfaces/webhook-event-repo.interface.ts (新規)
  └─→ 4 backend repo 実装 (Phase 7 Step 1+Step 4-a で実装)
        ├─ sqlite/webhook-event-repo.ts (Step 1)
        ├─ dynamodb/webhook-event-repo.ts (Step 4-a)
        └─ demo/webhook-event-repo.ts (Step 1)
```

Phase 7 Step 1 PR で **§3 13 file (schema 4 location + create-tables + lazy-startup-migrations + archive-types + interface + 4 demo repo + e2e + unit + legacy-schema)** をマージ → Step 4-a PR で webhook handler 統合 + sqlite/dynamodb webhook-event-repo 実装。

### 8.4 L4 派生 artifact 21 カテゴリ checklist

| # | カテゴリ | 影響 | step |
|---|---|---|---|
| 1 | **DB schema** | **本 PR の最大 scope** — `stripe_webhook_events` 新規 + `archived_reason` enum (4 location) | Step 1 |
| 2 | DB 保存済 string value | 既存 NULL archived → `'downgrade_user_selected'` 補充 (子 4 §2 原則 4) + 補充済 row の rollback 不可逆性 (§5.3) | Step 1 |
| 3 | search index | なし (admin 内部) | — |
| 4 | Service Worker | なし | — |
| 5 | CDN cache | なし | — |
| 6 | server-side cache | なし (Redis 未採用) | — |
| 7 | Stripe Product / Price / Webhook | Phase 7 Step 4-a 連動 (本 Step 1 では schema 配備のみ) | Step 4-a |
| 8 | Cognito | なし | — |
| 9 | Sentry / Datadog | Phase 7 Step 4 で `handler_result='error'` 行 insert 時に Sentry alert (子 3 §10 R3 整合) | Step 4 |
| 10 | email template | なし (本 PR は schema のみ) | — |
| 11 | analytics event name | Phase 7 Step 4 で `event_type` 別 error 率を `/admin/analytics` 表示検討 (子 3 §10 R3 follow-up) | Step 4 |
| 12 | dashboard / alert | Phase 7 Step 4 で Discord alert + Sentry 連動 (子 3 §10 R3) | Step 4 |
| 13 | Help Center / FAQ | なし (内部機構) | — |
| 14 | bookmarks / SEO | なし | — |
| 15 | 法務文書 | なし (PII 流入回避設計、子 3 §3.1 で `payload` 列を意図的除外) | — |
| 16 | GitHub Actions / pipeline | `npm run pre-ready` Step 1-3 (biome / svelte-check / vitest) で自動検証 (本 #2663 で追加変更なし) | Step 1 |
| 17 | **deployment env / secrets** | DynamoDB CDK は既存 (`storage-stack.ts:29 timeToLiveAttribute: 'ttl'`)、Step 1 で追加変更なし | Step 1 |
| 18 | i18n platform | なし (内部 enum、UI 露出 0) | — |
| 19 | **fixture / seed / golden / snapshot** | `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `tests/fixtures/legacy-schema/2026-05.sql` 3 file 同期 (§3.8) | Step 1 |
| 20 | 過去 PR / commit / Issue / ADR | 検索性のため変更なし | — |
| 21 | **audit log** | `stripe_webhook_events` table 自体が webhook 処理の audit log として機能、別途 audit log 不要 (ADR-0010 Pre-PMF) | Step 1 |

## 9. 4 backend 整合 checklist (§9、`parallel-implementations.md` 追補内容)

`docs/design/parallel-implementations.md` の DB スキーマ並行実装表 (L285-291) に Phase 7 Step 1 PR で 2 行追加する。本 #2663 では SSOT として確定するのみ、Phase 7 Step 1 PR で実際の docs 編集を実施。

### 9.1 `stripe_webhook_events` (#2641 / Phase 5 子 3)

| 列 | SQLite schema | E2E setup ALTER | test-db.ts | demo-data.ts | 関連 Issue |
|----|--------------|-----------------|------------|--------------|-----------|
| `stripe_webhook_events` (#2641 / Phase 5 子 3) | `src/lib/server/db/schema.ts` (table 新規 + 2 index) | `tests/e2e/global-setup.ts` (CREATE TABLE + 2 INDEX) | `tests/unit/helpers/test-db.ts` (CREATE TABLE + 2 INDEX + ALL_TABLES に追加) + `src/lib/server/db/create-tables.ts` (CREATE TABLE + 2 INDEX) | `src/lib/server/db/demo/webhook-event-repo.ts` (in-memory `Map<string, WebhookEventRecord>`) | #2641 (Phase 5 子 3) + #2663 (Phase 6 子 3 DB migration plan) |

### 9.2 `archived_reason` enum (#2642 / Phase 5 子 4)

| 列 | SQLite schema | E2E setup ALTER | test-db.ts | demo-data.ts | 関連 Issue |
|----|--------------|-----------------|------------|--------------|-----------|
| `archived_reason` enum 3 値 (#2642 / Phase 5 子 4) | `src/lib/server/db/schema.ts` 4 location (`children:40` / `activities:70` / `child_activities:109` / `checklist_templates:430`) に `text(..., { enum: ARCHIVED_REASONS })` 拡張 + `src/lib/domain/archive-types.ts` (新規 SSOT) | `tests/e2e/global-setup.ts` (既存 archived ALTER 直後に NULL 補充 UPDATE 追加) | `tests/unit/helpers/test-db.ts` (CREATE TABLE 4 location で enum 制約) + `src/lib/server/db/create-tables.ts` (同上) | `src/lib/server/db/demo/{child,activity,child-activity,checklist}-repo.ts` 4 file で `archivedReason: ArchivedReason \| undefined` 型強制 | #2642 (Phase 5 子 4) + #2663 (Phase 6 子 3 DB migration plan) |

**追加運用ルール**: 新規 `ArchivedReason` 値追加時 (例: 将来の `'graduation'`) は本表 13 file 全てを 1 PR で同期更新。

## 10. ADR 起票判断 (§10)

本要件は **既確定 ADR で判断原則がカバー済**:

- **ADR-0010 (Pre-PMF)**: Strategy パターン不採用、enum + 統合 service 採用 (子 4 #2642 §1.5 で確定済)
- **ADR-0031 (DB migration 互換性、archive 移動済の精神継承)**: 新規 table のみで既存 schema 不変、compat test 対象外 (子 3 #2641 §7 で確定済)
- **ADR-0049 (retention 30 日)**: Stripe Events API 保持期間と同期、PII 最小化 (子 3 #2641 §1.4 で確定済)
- **ADR-0045 (atom / compound)**: `archived_reason` enum は内部識別子で UI 露出禁止、子 5 #2643 atom 経由で表示 (子 4 #2642 §6 で確定済)
- **子 1 #2661 §3 Step 1**: 5 step Phase 7 統合 PR の Step 1 SSOT (本 #2663 で具体化)

→ **新規 ADR 起票不要**。本 docs が Phase 7 Step 1 の判断 SSOT として機能。

子 1 #2661 §9 で言及された「Phase 7 統合 PR cutover シーケンスと kill switch 戦略」ADR 起票は Phase 7 全 step マージ完了後の別 PR で起票 (本 #2663 scope 外)。

## 11. Open question (§11、Adversarial Reviewer 3 軸、PO 判断)

| # | 軸 | 論点 | 推奨案 | 状態 |
|---|---|------|------|------|
| 1 | **business** | 既存 NULL archived 補充の rollback 不可逆性 (§5.3) を許容するか、Step 1 マージ前に production DB snapshot 取得を必須化するか | 推奨: snapshot 取得必須化 (`infra/scripts/snapshot-db.sh` 既存 or Phase 7 で新規) を Step 1 PR Pre-Ready checklist (§7.4) に追加。data loss tolerable だが本番運用では snapshot で保険を打つ (課金別格 [[billing-critical-extra-caution]] 整合) | Phase 7 Step 1 着手時 PO 判断 |
| 2 | **UX** | `archived_reason='dunning_canceled'` 列値の Phase 3 banner 文言出し分け (子 4 #2642 §10 #2 で「統合 = downgrade_user_selected variant 流用」推奨)。本 #2663 では schema 配備のみ、文言出し分けは Phase 7 Step 2 (atom 統合) で確定する想定 | 本 #2663 scope 外 (子 4 §10 #2 整合)。Phase 7 Step 2 で atom 統合と同時に文言出し分け判断、必要なら reason 別 sub-variant 追加 | Phase 7 Step 2 着手時 PO 判断 |
| 3 | **security** | `error_message` 列に Stripe customer email 等の PII 流入 (子 3 §13 #3)。Phase 7 Step 4-a 実装時に 500 文字 truncate + `Stripe.Error` 型から `param` / `code` / `type` のみ抽出するヘルパで PII strip を実装する設計だが、Step 1 schema 配備時点では PII strip logic が存在しないため shadow mode 開始前に Step 4-a で必ず確認 | 推奨: Step 4-a PR Pre-Ready checklist (子 1 #2661 §10 #3) に「Test mode で `Stripe.Error.param` に email 含む event を流して `error_message` 内に email 不在を assert」を追加 | Phase 7 Step 4-a 実装時に必須 |
| 4 | **security (adversarial)** | dispatcher 入口の並列同時到達時の PK 一意性違反 (子 3 §13 #6)。Step 1 schema 配備で `event_id PRIMARY KEY` 制約は機能するが、sqlite `INSERT OR IGNORE` + `RETURNING` の atomic check-and-insert は Step 4-a で実装。Step 1 単独では race condition 検出 test 不可 | 推奨: 本 #2663 では schema PK 制約 + dynamodb `ConditionExpression: 'attribute_not_exists(SK)'` 設計を SSOT 化、Step 4-a 実装時に必ず両 backend で実装 (子 3 §13 #6 整合) | Phase 7 Step 4-a 実装時に必須 |
| 5 | **security (adversarial)** | DynamoDB TTL は **48h 以内** に自動削除 (AWS 公式: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html>)。SQLite cron は日次。30 日 retention の精度差で SQLite 側が遅れて削除 (例: 31 日目 cron 失敗 → 32 日目に削除) → DynamoDB → SQLite 移行時の data 不整合リスク | 推奨: Step 1 schema 配備時に「retention 期間の精度差は Pre-PMF Bucket B (ADR-0010) として許容、PMF 後の DB 移行時に整合性検査 cron 追加」と SSOT 確定。Phase 7 Step 1 PR では追加実装なし | Step 1 ready 化前に文書化 |

## 12. 6 観点 自己検証 (§12、[[per-issue-execution-workflow]] SSOT)

| # | 観点 | 本 docs 反映 |
|---|---|---|
| 1 | **着手時 deep-research** | §1.3 で drizzle-kit standard route vs 4 dimension SSOT (本リポジトリ採用) を比較、`lazy-startup-migrations.ts` L29-50 コメント検証済。子 3 §1.3 (Stripe 公式 dedup) + 子 4 §1.5 (Strategy vs enum) の OSS 先調査を活用、新規 OSS 比較は本 #2663 scope 外 (DB migration 機構は本リポジトリ既存パターン使用)。自プロダクト既存実装 (`schema.ts` / `create-tables.ts` / `lazy-startup-migrations.ts` / `dynamodb/keys.ts` / `storage-stack.ts` / `tests/e2e/global-setup.ts` / `tests/unit/helpers/test-db.ts` / `tests/fixtures/legacy-schema/2026-05.sql`) を Explore 照合 (2026-05-30、feedback_deep_research_product_specific 整合) |
| 2 | **UI SS + アクセシビリティ検証計画** | 本 #2663 は DB migration 設計のみで UI 影響ゼロ。Phase 3 #2575 + Phase 4 #2623 既設計 SS / a11y を保全 (子 4 #2642 §6 で確認済) |
| 3 | **UX 変更時のテスト項目追加** | §7 で unit (4 spec 新規 / 拡張) + integration (3 spec 新規 / 拡張) + E2E (Phase 7 Step 4 PR で実行) + Phase 7 Step 1 PR Pre-Ready checklist 7 項目を SSOT 化 |
| 4 | **用語 SSOT (atom)** | §3.5 で `archive-types.ts` 新規 (子 4 §2 原則 1 整合) を SSOT 確定、内部 enum で UI 露出禁止 (ADR-0045)、文言出し分けは Phase 7 Step 2 atom 統合で判断 (§11 #2) |
| 5 | **影響範囲事後検証** | §8 で impact-analysis 4 layer 適用 (L1: 2 検索 × 26 file 列挙、touch 13 file + 既存 string 値で変更不要 13 file の判別 / L2: enum 3 値 + `'family'` 同名異義 + `processedAt` ISO 8601 / L3: 依存グラフ 4 path / L4: 21 カテゴリ checklist 全件、A-1 schema / A-2 既存値補充 / G-19 fixture 3 file / G-21 audit log を主要影響として明示) |
| 6 | **目的達成 / 大方針整合** | AC 全件達成 (`docs/design/billing-redesign/phase6-db-migration-plan.md` 新規 ≤ 500 行 / 4 backend 整合表 §3+§9 / Drizzle migration 機構 §1.3+§4 / rollback migration §5 / `parallel-implementations.md` 反映差分 §9) / Phase 5 子 3+4 連動 §1+§3 / 子 1 #2661 §3 Step 1 SSOT 補完 / ADR-0010+0031+0049+0045 整合 §10 |

## 13. 影響範囲事後検証 (本 PR scope、§13)

| 項目 | 内容 |
|---|---|
| **本 PR 変更ファイル** | 新規 1 ファイル: `docs/design/billing-redesign/phase6-db-migration-plan.md` |
| **着手前見積** | 推定 400-500 行 (Phase 6 子 3、子 1 #2661 §3 Step 1 補完) |
| **実際の影響範囲** | docs 設計のみ、コード変更ゼロ。Phase 7 Step 1 実装 PR で参照される SSOT |
| **乖離度** | 0% (見積通り、`docs/design/billing-redesign/README.md` §Phase 6 表は触らず conflict 連鎖回避、指示通り) |
| **L1-L4 防御** | L1 (構文): 本 PR では既存コード参照なし、Phase 7 Step 1 実測予測のみ §8.1 で記録 / L2 (意味): enum 3 値 + 同名異義 3 件 §8.2 / L3 (構造): 依存グラフ §8.3 / L4 (派生 artifact): 21 カテゴリ checklist 主要項目 §8.4 |

## 14. 関連 (§14、2026-05-30 整合)

### Phase 1 (上位要件)

- [phase1-dunning-requirements](phase1-dunning-requirements.md) — NFR-1 (webhook 冪等性) / FR-3 (canceled → 無料化 + archive) → 本 #2663 schema 配備で具体化
- [phase1-security-requirements](phase1-security-requirements.md) — FR-4 (event.id で冪等性管理) → 本 #2663 で `stripe_webhook_events` table 配備
- [phase1-data-lifecycle-requirements](phase1-data-lifecycle-requirements.md) — NFR-2 (削除 cron idempotent / webhook 二重実行耐性) → 本 #2663 の retention cron が整合

### Phase 5 (アーキ、本 #2663 の起点)

- [phase5-webhook-idempotency-architecture](phase5-webhook-idempotency-architecture.md) (子 3 #2641) — `stripe_webhook_events` schema SSOT、本 #2663 §3.1+3.2+3.4 の元
- [phase5-archive-unified-architecture](phase5-archive-unified-architecture.md) (子 4 #2642) — `archived_reason` enum SSOT + 統合 service 設計、本 #2663 §3.5+§4.1 Step 4-3 の元

### Phase 6 同位 (本 PR と並ぶ子 issue)

- 子 1 #2661 ([phase6-phase7-execution-ssot](phase6-phase7-execution-ssot.md)) — Phase 6 グループ A 最優先、本 #2663 §3 13 file 一覧の起点 (子 1 §3 Step 1 を補完)
- 子 2 #2662 (Test clock 6 シナリオ詳細設計、グループ B 並列) — 本 #2663 と独立、Phase 7 Step 3+4 連動
- 子 4 #2664 (文脈判断 6 件 + lookup_key 段階移行 + apiVersion bump、グループ B 並列) — 本 #2663 と独立、Phase 7 Step 3 連動
- 子 5 #2665 (ロールバック詳細 + kill switch SSOT、グループ C) — 本 #2663 §5 rollback 連動

### Phase 7 (実装、本 PR の落とし先)

- #2531 (Phase 7 実装) — 本 docs を参照して Step 1 統合 PR (DB migration、推定 200 行) を実行

### ADR (関連)

- ADR-0010 (Pre-PMF、Strategy パターン不採用 / GSI 追加しない / 汎用 audit log にしない)
- ADR-0031 (DB migration 互換性、新規 table のみで既存 schema 不変、archive 移動済の精神継承)
- ADR-0049 (retention 30 日、Stripe Events API 保持期間と同期 / PII 最小化)
- ADR-0045 (atom / compound、`archived_reason` enum は内部識別子で UI 露出禁止)

### skill (関連)

- `db-migration` — 本 #2663 §3 13 file 同期 + §5 rollback + §7 test 計画 で SSOT 化
- `impact-analysis` — 本 #2663 §8 で 4 layer + 21 カテゴリ checklist 適用
- `regression-check` — Phase 5 子 3+4 + Phase 7 Step 1 連動の影響範囲

### memory (関連)

- [[per-issue-execution-workflow]] — 6 観点 + git workflow
- [[impact-analysis-methodology]] — 4 layer 防御 + 21 カテゴリ
- [[branch-base-main-freshness]] — main 最新化 + push 前 rebase
- [[pr-body-encoding-powershell]] — Bash here-doc UTF-8
- [[pause-and-replan-on-stuck]] — 詰まり時立ち戻り 4 ステップ
- [[pr-review-recurring-blocks]] — QM BLOCK 予防 4 項目
- [[billing-critical-extra-caution]] — 課金別格、§11 #1 production snapshot 取得推奨の根拠

## 15. 根拠 (primary source、§15)

### 自プロダクト既存実装 (Explore 照合 2026-05-30)

- `src/lib/server/db/schema.ts:40,70,109,430` (`archived_reason` text 列 × 4 location)
- `src/lib/server/db/schema.ts:46-78` (`activities` table 既存定義)
- `src/lib/server/db/create-tables.ts:36-95` (`CREATE TABLE IF NOT EXISTS` 4 location)
- `src/lib/server/db/migration/lazy-startup-migrations.ts:29-50` (4 dimension SSOT コメント、#2508 / #2510 教訓)
- `src/lib/server/db/dynamodb/keys.ts:1-79` (DynamoKey interface + 79 export 既存パターン)
- `src/lib/server/db/dynamodb/keys.ts:494-526` (`cancellationReasonKey` / `graduationConsentKey` の global single-partition パターン、子 3 §3.2 整合)
- `src/lib/server/db/demo/{child,activity,child-activity,checklist}-repo.ts` 4 file (in-memory archive 経路)
- `tests/e2e/global-setup.ts:30-51` (#783 archived ALTER + CREATE TABLE 既存パターン)
- `tests/unit/helpers/test-db.ts:64,91,120,402,824-906` (CREATE TABLE 4 location + ALL_TABLES + DROP TABLE truncate ループ)
- `tests/fixtures/legacy-schema/2026-05.sql` (#2362 PR-3 / PR-5 legacy schema、production canary 起動シミュレート)
- `infra/lib/storage-stack.ts:22-39` (DynamoDB TableV2 + `timeToLiveAttribute: 'ttl'` 既設定)

### Phase 5 子 3+4 SSOT (本 #2663 の上位)

- [phase5-webhook-idempotency-architecture.md](phase5-webhook-idempotency-architecture.md) §3.1+3.2+3.3+3.4 (`stripe_webhook_events` 4 backend schema)
- [phase5-archive-unified-architecture.md](phase5-archive-unified-architecture.md) §2 原則 1 (`ARCHIVED_REASONS` enum SSOT) + §2 原則 4 (default 補充) + §4 9 step (本 #2663 §3 13 file 一覧の元)

### Phase 6 子 1 SSOT (本 #2663 の直接親)

- [phase6-phase7-execution-ssot.md](phase6-phase7-execution-ssot.md) §3 Step 1 (DB migration、推定 200 行、本 #2663 で具体化)

### Stripe / AWS 公式 (子 3 §15 deep-research 6 URL 継承)

- [Stripe Webhooks: Handle duplicate events](https://docs.stripe.com/webhooks#handle-duplicate-events) — `event.id` dedup pattern (子 3 §15)
- [Stripe API: Event object](https://docs.stripe.com/api/events/object) — `evt_*` immutable
- [Stripe API: Events list (30 日 retention)](https://docs.stripe.com/api/events/list) — Events API 30 日保持
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) — item-level TTL native 機能、§11 #5 SSOT
- [SQLite ALTER TABLE limitations](https://www.sqlite.org/lang_altertable.html) — `lazy-startup-migrations.ts` 4 dimension SSOT の根拠 (§1.3)
