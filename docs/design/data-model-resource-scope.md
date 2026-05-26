# data-model-resource-scope.md — 6 type データモデル scope SSOT

| 項目 | 内容 |
|------|------|
| 関連 ADR | [ADR-0055](../decisions/0055-per-child-primary-data-model-pattern.md) (per-child 主軸 + 限定 family master 原則) / ADR-0052 (Strategy + Registry) / ADR-0046 (Service Interface + Context DI) |
| 関連 Issue | EPIC #2362 / 派生 I1 #2445 / I2 #2446 / I3 #2447 / I4 #2448 |
| 更新タイミング | 新 MarketplaceType 追加 / 既存 type の scope 変更 / aggregate root 変更時 |

---

## 1. 設計背景

`MarketplaceTypeRegistry` (ADR-0052) で 5 type の **実装** が統一されたが、**"何 scope で持たれるか" のデータモデル原則が SSOT 化されていない**ため、各 type が歴史的経緯で per-child / family master を選択し、PR ごとに判断ぶれが発生していた (#2441 / #2442 / #2443 の連続誤実装の構造的原因)。

本ドキュメントは ADR-0055 で確定した「per-child 主軸 + 限定 family master pattern」の **6 type 適用範囲 + DB schema 設計案 SSOT** を提供する。後続 PR (PR-3〜7) は本表を参照して schema 変更を判定する。

---

## 2. 設計原則

### 2.1 per-child 主軸 (default)

新 type 追加時の **default 選択は per-child instance**。Aggregate root は child に閉じ、`childId` FK を必須とする。

理由: User §1 直接指針「親管理目線でもどこまでも子供主体であるべき」+ customer use case 集計 25 件中 per-child が family master を上回る (`tmp/user-question/2026-05-23-customer-use-case-data-model-qa.md` §1-§6)。

### 2.2 family master の許容条件

以下を **全て満たす場合のみ** family master を許容:

1. customer use case で「家族共通が自然」が過半 (`tmp/user-question/2026-05-23-customer-use-case-data-model-qa.md` 判定表で `✅ family` が ✓ より多い)
2. per-child カスタマイズ要件が当面不要 (将来要件が立ち上がっても per-child instance への migration が可能)
3. 1 record で全 child に効果が及ぶことが UX 上自然 (「保育園じゅんび」「朝 7 時前起床ボーナス」等)

### 2.3 取込時の child binding は **取込ダイアログ** で決定

Marketplace 側に child 情報を露出させず、AdminApp 側で「誰に追加 / 全員」を選ぶ。詳細 sequence は [marketplace-import-flow.md](marketplace-import-flow.md) §3。

---

## 3. 6 type の scope 適用表 (SSOT)

| Type | 採択 scope | aggregate root | child binding | family master 共有要素 | 関連 marketplace strategy |
|---|---|---|---|---|---|
| **activity** | per-child instance | `ChildActivity` | 必須 (取込時にダイアログ選択) | カテゴリ master (`categories`) のみ | `activity-pack` (#2365) |
| **checklist** | family master template + per-child progress | `ChecklistTemplate` (family) + `ChecklistProgress` (child) | template は family、progress は child | template / item list を 1 record で共有 | `checklist` (#2367) |
| **reward (exchange)** | per-child instance | `ChildReward` | 必須 | レート / 目標は child 固有、共通 master なし | `reward-set` (#2366) |
| **rule (bonus)** | family master (tenant scope) | `BonusRule` | 不要 (全 child 自動適用) | bonus 条件 + 加算 point を tenant 単位で保持 | `rule-preset` (#2368) |
| **rule (exchange) = 特別ルール** | **削除予定** (I1 #2445) | — | — | — | `rule-preset` から除外 |
| **challenge** | per-child instance + UI 工夫 | `ChildChallenge` | 必須 | 「みんなで頑張る」表現は UI / template で再現 | `challenge-set` (#2369、I2 #2446 で per-child 化) |

---

## 4. DB schema 設計案 (PR-3〜7 で実装)

本節は PR-3〜7 が参照する **schema 変更目標**。実際の migration / Lazy Migration `_sv` 設計は各 PR で確定。

### 4.1 activity (PR-3 で per-child 化)

**現状**: `activities` family master + `age_min/max` で per-child visibility (PR で破棄)

**目標**:

```
child_activities
  id                INTEGER PK
  child_id          INTEGER NOT NULL FK → children.id  ★追加
  category_id       INTEGER NOT NULL FK → categories.id
  name              TEXT NOT NULL
  icon              TEXT NOT NULL
  base_points       INTEGER NOT NULL DEFAULT 5
  is_visible        INTEGER NOT NULL DEFAULT 1
  daily_limit       INTEGER
  sort_order        INTEGER NOT NULL DEFAULT 0
  source            TEXT NOT NULL DEFAULT 'seed'
  priority          TEXT NOT NULL DEFAULT 'optional'  -- 'must' / 'optional'
  trigger_hint      TEXT
  is_main_quest     INTEGER NOT NULL DEFAULT 0
  source_preset_id  TEXT
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  is_archived       INTEGER NOT NULL DEFAULT 0
  archived_reason   TEXT
  -- age_min / age_max は削除 (marketplace 側の表示 filter にのみ残す)
  INDEX (child_id, is_archived)
```

`activity_logs` は既存 `activity_id` を `child_activity_id` にリネーム (FK 変更)。

**service 層 API 使い分け (#2471、PR #2455 Round 6 follow-up)**:

| 経路 | 呼ぶ API | 用途 |
|---|---|---|
| 子供 home (`/(child)/[uiMode]/home/+page.server.ts`) | `getChildActivities(child.id, tenantId, filter?)` | 現在の child の per-child instance のみ取得 |
| setup フロー (`/setup/first-adventure/+page.server.ts`) | `getChildActivities(firstChild.id, tenantId)` | 「はじめての活動」体験の初期 child のみ |
| admin 集約 (`/admin/+page.server.ts`, `/admin/activities`, `/admin/license`, `/admin/packs`) | `getActivities(tenantId, filter?)` | tenant 全 child を aggregate (admin tab で per-child filter) |
| API 集約 (`/api/v1/activities/*`) | `getActivities(tenantId, filter?)` | tenant 集計 / export (認可は別経路) |
| onboarding 完了率判定 (`onboarding-service.ts`) | `getActivities(tenantId)` | 「活動が 1 件でも存在するか」総数判定のみ (aggregate 適切) |

**禁忌**: child context が確定している経路 (child home / setup の child binding 後) では必ず `getChildActivities` を使う。`getActivities` (tenant aggregate) を child 経路で使うと 5 children 環境で同名 activity が 5 倍に重複 render される UX 退行が再発する (#2471 教訓)。

**実装状況 PR-A1 (2026-05-26、#2458 Path A)**:

- ✅ facade rewrite (`src/lib/server/db/sqlite/activity-repo.ts`) — 全 write method (insertActivity / updateActivity / setActivityVisibility / deleteActivity / archiveActivities / restoreArchivedActivities) を `child_activities` 経由に切替。**旧 `activities` table への write が 0 件 = #2458-C drop ready**
- ✅ read method (`findActivities` / `findActivityById` / `getCategoryCountsByDate` / `countActiveActivityLogsByCategory` / `countMainQuestActivities`) も `child_activities` 経由に統一。signature 不変で caller 修正ゼロ (`Activity` shape は `_toActivityShape` adapter で互換性維持、削除 field は null fallback)
- ✅ explicit 2 per-child site migrate: `activity-log-service.ts` L159 / L350 を `getChildActivities(childId, tenantId, filter)` に置換
- ✅ parallel write 撤去: `activity-import-service.ts:151` の family master insert を削除、childIds 未指定時は fallback で tenant 最初の child に bind
- ✅ regression test: `tests/unit/services/activity-legacy-table-write-zero.test.ts` — 全 write method に対し旧 `activities` table row count が 0 のまま不変であることを assert (8 test)

**実装状況 PR-A2 (2026-05-26、#2458 Path A の demo + dynamodb 同期)**:

- ✅ `src/lib/server/db/dynamodb/activity-repo.ts` rewrite — 全 write method (`insertActivity` / `updateActivity` / `setActivityVisibility` / `deleteActivity` / `archiveActivities` / `restoreArchivedActivities` / `insertActivityLog` / `insertPointLedger`) を `NotImplementedError` に置換。ADR-0048 で DynamoDB は production 未使用 (main Lambda は sqlite local file) のため、再実装時は `dynamodb/child-activity-repo.ts` (ADR-0055 per-child schema) 経由で実装し直す構造的ガードを設置 (旧 `activities` partition (`SK=MASTER`) への退行を防止)
- ✅ `src/lib/server/db/demo/activity-repo.ts` SSOT コメント追記 — 全 write method (insertActivity / updateActivity / setActivityVisibility / deleteActivity / archive / restore / insertActivityLog / insertPointLedger / markActivityLogCancelled / deleteDailyMissionsByActivity / deleteActivityLogsBeforeDate) は元から no-op stub または synthetic 戻り値 (id=0) を返すのみで fixture を mutate しないことを明文化。read 経路は marketplace integration テスト (#2097 Phase B-7) を退行させないため `ALL_DEMO_ACTIVITIES` (hand-curated + marketplace merged) を primary source として保持し、per-child scope queries は別 file (demo/child-activity-repo.ts) 経由で `DEMO_CHILD_ACTIVITIES` から取得する設計
- ✅ regression test (demo): `tests/unit/services/activity-legacy-table-write-zero-demo.test.ts` (12 test) — 全 11 write/stub method 呼出後に `DEMO_CHILD_ACTIVITIES` / `DEMO_ACTIVITIES` / `DEMO_MARKETPLACE_ACTIVITIES` / `DEMO_ACTIVITY_LOGS` の長さ + flag 不変を assert + read 経路 (marketplace integration) 維持を 2 件確認
- ✅ regression test (dynamodb): `tests/unit/services/activity-legacy-table-write-zero-dynamodb.test.ts` (11 test) — 全 write method が `NotImplementedError` throw + `mockSend.not.toHaveBeenCalled()` で DynamoDB Client に到達しないこと、エラー message に「ADR-0055」「child-activity-repo」が含まれ再実装方針を誘導することを assert
- ✅ schema 不変 (本 PR は backend rewrite のみ、`schema.ts` / `create-tables.ts` / `interfaces/activity-repo.interface.ts` 変更なし。interface.ts は comment 更新のみ)
- ⏳ physical drop (#2458-C): 3 backend (sqlite / demo / dynamodb) で旧 `activities` table / partition への write 0 化完遂 → main merge + 1 release 経過後に旧 `activities` table / `IActivityRepo` interface / 残 read 経路を schema / dynamodb partition から削除

### 4.2 checklist (PR-5 Phase 1 完了 / Phase 2 UX 化進行中)

**実装状況** (2026-05-25 PR-5 Phase 1):
- ✅ schema flip 完了 (`checklist_templates.child_id` 削除 + `tenant_id` 列追加 + `checklist_template_assignments` 新規)
- ✅ repo interface 改定 (`IChecklistRepo` に `findTemplatesByTenant` / `findAssignmentsByTemplate` / `assignTemplateToChildren` / `unassignTemplate` 等 family + distribution method 追加)
- ✅ 3 実装 (sqlite / dynamodb / demo) 全 method 更新
- ✅ `checklist-distribution-service.ts` 新規 (SRP: 配信先管理専用)
- ✅ `checklist-template-import-service.ts` family scope 重複判定 + `importChecklistTemplateForFamily` 追加
- ✅ `event-checklist-strategy.ts` discriminated union ctx (`family-master-with-distribution` / `legacy-single-binding`) 対応
- ⏳ admin UX 全面刷新 (Phase 2): family checklist 一覧 + `ChecklistDistributionDialog` + per-child progress 表示
- ⏳ 子供画面 data 取得 path 修正 (Phase 2): 既存 `findTemplatesByChild` (assignments join 経由) で後方互換維持中
- ⏳ marketplace 取込 CWE-598 + admin redirect (Phase 2)

**Schema 構造 (Phase 1 完了時点)**:

```
checklist_templates  -- family master 化
  id                INTEGER PK
  tenant_id         TEXT NOT NULL
  -- child_id を削除
  name              TEXT NOT NULL
  icon              TEXT NOT NULL DEFAULT '📋'
  points_per_item   INTEGER NOT NULL DEFAULT 2
  completion_bonus  INTEGER NOT NULL DEFAULT 5
  time_slot         TEXT NOT NULL DEFAULT 'anytime'
  is_active         INTEGER NOT NULL DEFAULT 1
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  is_archived       INTEGER NOT NULL DEFAULT 0
  archived_reason   TEXT
  source_preset_id  TEXT
  INDEX (tenant_id, is_archived)

checklist_template_assignments  -- ★新規 (template ↔ child 配信先)
  id                INTEGER PK
  template_id       INTEGER NOT NULL FK → checklist_templates.id
  child_id          INTEGER NOT NULL FK → children.id
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  UNIQUE (template_id, child_id)
  INDEX (child_id)

checklist_logs       -- 既存維持 (per-child progress、(child_id, template_id, date) UNIQUE)
```

C6 use case「配信先を全員 or 個別で選ぶ」は `checklist_template_assignments` 側で表現。C2「たろうにだけ色鉛筆追加」は `checklist_overrides` (既存 per-child override) で表現。

### 4.3 reward exchange (PR-4、現状 per-child 維持 + UX 整備済)

**現状**: `special_rewards.child_id NOT NULL` (per-child instance、現状一致)

**目標**: 既存 schema 維持 + `source_preset_id` 経路を `MarketplaceTypeRegistry.reward-set` strategy 経由 (#2366) に統一。schema 変更なし、Strategy 経路統一のみ。

**PR-4 実装状況** (2026-05-25): admin/rewards UX を PR-3 と同型に整備済。子供別タブ切替 + ChildSelectionDialog auto-open + 「他の子供から copy」action + marketplace 取込 child 排除 (CWE-598)。schema 変更ゼロ、UX 整備のみ。詳細動線は [marketplace-import-flow.md](marketplace-import-flow.md) §3.2 reward-set 節参照。

### 4.4 rule bonus (PR-6、現状維持)

**現状**: `settings` KVS の `bonus_rules` JSON value (tenant scope)

**目標**: 既存維持 + marketplace `rule-preset` strategy (#2368) の取込先を `settings` に確定。RB2「たろうだけ + 10P」のような child 別 bonus が将来要件として立ち上がった場合のみ別 table 化検討 (本 ADR 範囲外)。

### 4.5 rule exchange = 特別ルール (I1 #2445 で削除)

`MarketplaceItemType` から `rule-preset` の exchange サブセットを削除、`MARKETPLACE_TYPE_CODES` も同期更新。schema 変更は I1 PR 内で実施。

### 4.6 challenge (#2362 PR-7 で per-child 化、User §6)

**現状**: `child_challenges` per-child instance + 進捗 inline 化。legacy SSOT への参照は完全撤去済。
- **#2362 PR-7**: schema 追加 + admin/challenges 移行
- **#2458-B (PR #2488 / merged 2026-05-25)**: 子供 home / history + setup challenges + challenge-set-import-service legacy path + activity-log dynamic import の caller migration 完遂、`sibling-challenge-service.ts` 撤去
- **#2458 Path B sibling drop (本 PR、2026-05-26)**: 旧 `sibling_challenges` / `sibling_challenge_progress` を schema / create-tables / global-setup / test-db / demo-data から物理撤去 + `sibling-challenge-repo` 3 backend 実装 + facade + `ISiblingChallengeRepo` interface + `SiblingChallenge*` 型を削除完了 (per-child child_challenge 経路のみ残存)

**実装スキーマ** (本 PR で実装済):

```
child_challenges  -- ★新 table (per-child instance、進捗 inline 化)
  id                  INTEGER PK
  child_id            INTEGER NOT NULL FK → children.id (CASCADE)  ★追加
  title               TEXT NOT NULL
  description         TEXT
  challenge_type      TEXT NOT NULL DEFAULT 'cooperative'  -- 新規作成は cooperative 固定 (#2296 競争撤廃)
  period_type         TEXT NOT NULL DEFAULT 'weekly'
  start_date          TEXT NOT NULL
  end_date             TEXT NOT NULL
  target_config       TEXT NOT NULL  -- JSON: { metric, baseTarget, categoryId? }
  reward_config       TEXT NOT NULL  -- JSON: { points, message? }
  status              TEXT NOT NULL DEFAULT 'active'
  is_active           INTEGER NOT NULL DEFAULT 1
  source_template_id  TEXT  -- 兄弟連動 group キー (`challenge-set:<presetId>:<title>` 等)
  current_value       INTEGER NOT NULL DEFAULT 0  -- 進捗 inline 化
  target_value        INTEGER NOT NULL              -- 年齢調整済目標
  completed           INTEGER NOT NULL DEFAULT 0
  completed_at        TEXT
  reward_claimed      INTEGER NOT NULL DEFAULT 0
  reward_claimed_at   TEXT
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  INDEX (child_id, status), (start_date, end_date), source_template_id
```

**設計差分** (I2 #2446 提案からの変更):

- `child_challenge_progress` 別 table を作らず、`child_challenges` に `current_value` / `target_value` / `completed*` / `reward_claimed*` を inline 化 (1 instance = 1 child binding なので 1:1、別 table の意味なし)
- `source_preset_id` → `source_template_id` にリネーム (兄弟連動 group キーの意味を明示、`challenge-set:<presetId>:<title>` 形式)
- `challenge_type` は legacy 互換のため `cooperative` 既定維持 (新規作成 UI 側で固定、#2296 競争撤廃)

**兄弟連動 UX** (User §6「兄弟にこだわらない、子供別 challenge セットで管理し、共通化コントロールで兄弟チャレンジに魅せる」):

- 同じ `source_template_id` (または `title + start_date + end_date`) を共有する複数 child instance を admin/challenges で group 表示
- `SiblingChallengeComparison.svelte` (admin 画面でのみ使用) で「兄弟の進捗」一覧表示。全員完了時のみ簡素な祝福バナー
- 子供画面では兄弟比較は非表示 (ADR-0012 Anti-engagement、個人ペース重視)
- marketplace 取込時に `requiresChildSelection: true` で ChildSelectionDialog から複数 child を選択し、同じ `source_template_id` で per-child instance を一括生成

**LP 訴求への波及** (ADR-0013 LP truth):

- LP / pricing / faq の「チャレンジ」訴求は per-child 体験ベース (「自分から目標を立てる」「ウィークリーチャレンジ」) のため per-child 化と既に整合済み
- 「兄弟チャレンジ family-only」「全員自動参加」「兄弟競争」は LP に元から訴求なし → 文言修正不要
- `CHALLENGES_LABELS.familyPlanTitle` family-only gate はアプリ内 UI のみで LP 側に波及せず。本 PR では family-only gate を維持 (LP/pricing 整合性は #2457 plan-limit 別 PR 判断)

`sibling_cheers` は別概念 (応援スタンプ) として既存維持。

---

## 5. 並行実装チェック

本ドキュメントを参照して schema 変更を行う PR は、`docs/design/parallel-implementations.md` で以下の同期対象を確認すること:

- `src/lib/server/db/schema.ts` (Drizzle スキーマ SSOT)
- `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts` (test DB)
- `scripts/migrate-local.ts` (本番 / NUC migration)
- `docs/design/08-データベース設計書.md` §3 テーブル定義 (PR で同時更新)

---

## 6. 関連

- [ADR-0055](../decisions/0055-per-child-primary-data-model-pattern.md) (本ドキュメントの上流 原則)
- [marketplace-import-flow.md](marketplace-import-flow.md) (取込フロー sequence SSOT)
- [marketplace-architecture.md](marketplace-architecture.md) (Strategy + Registry アーキ、ADR-0052)
- [08-データベース設計書.md](08-データベース設計書.md) (DB SSOT、各 PR で同期更新)
- [parallel-implementations.md](parallel-implementations.md) (並行実装ペア一覧)
