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

### 4.2 checklist (PR-5、現状 per-child instance → family master template 化)

**現状**: `checklist_templates.child_id NOT NULL` (per-child instance)

**目標**:

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

### 4.3 reward exchange (PR-4、現状 per-child 維持)

**現状**: `special_rewards.child_id NOT NULL` (per-child instance、現状一致)

**目標**: 既存 schema 維持 + `source_preset_id` 経路を `MarketplaceTypeRegistry.reward-set` strategy 経由 (#2366) に統一。schema 変更なし、Strategy 経路統一のみ。

### 4.4 rule bonus (PR-6、現状維持)

**現状**: `settings` KVS の `bonus_rules` JSON value (tenant scope)

**目標**: 既存維持 + marketplace `rule-preset` strategy (#2368) の取込先を `settings` に確定。RB2「たろうだけ + 10P」のような child 別 bonus が将来要件として立ち上がった場合のみ別 table 化検討 (本 ADR 範囲外)。

### 4.5 rule exchange = 特別ルール (I1 #2445 で削除)

`MarketplaceItemType` から `rule-preset` の exchange サブセットを削除、`MARKETPLACE_TYPE_CODES` も同期更新。schema 変更は I1 PR 内で実施。

### 4.6 challenge (I2 #2446 で per-child 化)

**現状**: `sibling_challenges` family-wide + `sibling_challenge_progress` per-child progress

**目標** (I2 #2446 PR で実装):

```
child_challenges  -- ★新 table (sibling_challenges を per-child 化、リネーム)
  id                INTEGER PK
  child_id          INTEGER NOT NULL FK → children.id  ★追加
  title             TEXT NOT NULL
  description       TEXT
  challenge_type    TEXT NOT NULL DEFAULT 'individual'  -- 旧 cooperative / competitive 概念を UX 工夫で吸収
  period_type       TEXT NOT NULL DEFAULT 'weekly'
  start_date        TEXT NOT NULL
  end_date          TEXT NOT NULL
  target_config     TEXT NOT NULL  -- JSON
  reward_config     TEXT NOT NULL  -- JSON
  status            TEXT NOT NULL DEFAULT 'active'
  is_active         INTEGER NOT NULL DEFAULT 1
  source_preset_id  TEXT
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  INDEX (child_id, status)

child_challenge_progress  -- 既存 sibling_challenge_progress を child_challenge_id にリネーム
  (challenge_id → child_challenge_id、他 column 維持)
```

`sibling_cheers` は別概念 (応援スタンプ) として既存維持。「みんなで頑張る」UX は同一 `source_preset_id` の challenge を複数 child に取込時、ダッシュボードで合算表示する UI 工夫で表現 (I2 #2446 仕様)。LP 訴求への波及も I2 内で扱う (ADR-0013 LP truth)。

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
