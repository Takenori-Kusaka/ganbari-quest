# Import Hub データモデル原則 — 家族 master + per-child preference

| 項目 | 内容 |
|------|------|
| 版数 | 1.0 |
| 作成日 | 2026-05-23 |
| 作成者 | 日下武紀 |
| 関連 ADR | [ADR-0054](../decisions/0054-family-master-per-child-preference-pattern.md) (本原則の意思決定根拠) / [ADR-0052](../decisions/0052-marketplace-type-registry.md) (import strategy 側) |
| 関連 EPIC | #2362 |

---

## 1. 設計背景

### 解決する課題

リソース (活動 / ごほうび / 持ち物チェックリスト / ルール / チャレンジ) の data model が type ごとに分裂し、以下を引き起こしている:

1. marketplace 詳細画面で child 選択 UI を強制 → public ページに child 名が露出する privacy リスク (OWASP CWE-598 / COPPA / GDPR Art.8)
2. `event-checklist` 3 preset × 子供 3 人 = 9 行のデータ重複 (#2137)
3. `activities` (family master) と他 4 type (per-child instance) の paradigm 分裂による認知負荷
4. marketplace URL に `?childId=X` を載せると Referer leak / browser history 残存リスク

### 関連ペルソナ

| ペルソナ | この原則との関係 |
|---------|--------------|
| P1 田中ゆかり (親) | 家族のリソースを 1 箇所で管理し、子供別の表示制御を edit modal でのみ行う |
| P2 佐藤洋介 (親) | marketplace を browse する際、自分の子供名が public UI に露出しない安心感を得る |
| C2 ゆい (子供) | 自分専用に visibility ON されたリソースのみ表示される (paradigm 統一で混乱なし) |

---

## 2. 設計原則

### 2.1 家族 master + per-child preferences (一次原則)

| 概念 | 表現 | 例 |
|---|---|---|
| **家族 scope のリソース master** | `<resource>_masters` テーブル (childId 列なし、`source_preset_id` で marketplace 由来を識別) | `activities` / `reward_masters` / `checklist_template_masters` / `rule_masters` |
| **per-child × resource の visibility 制御** | `child_<resource>_preferences` junction table (`(child_id, resource_id) UNIQUE`、`is_visible` 列) | `child_activity_preferences` / `child_reward_preferences` / `child_checklist_preferences` / `child_rule_preferences` |
| **per-child progress / history** | 別テーブル (`activity_logs` / `special_rewards` granted / `checklist_logs` 等)、master を JOIN | `activity_logs` (既存) / `special_rewards` (per-child progress として残置、title 等は master JOIN) |

family-wide でかつ進捗が child 単位な type (challenge-set) は **master + per-child progress** のみで preferences 不要 (`sibling_challenges` + `sibling_challenge_progress` の既存パターン)。

### 2.2 marketplace ページ (public 経路) の child 露出禁止

- `/marketplace` 一覧 / `/marketplace/[type]/[itemId]` 詳細に **child name / child id / プルダウンを一切表示しない**
- import CTA = 「家族に取り込む」(child 選択なし)、import action は family-wide master row として登録、既定 visibility = 全 child ON
- 未認証なら CTA を「無料で始めて取り込む」に切替えて signup 誘導
- URL query / hidden form / Referer に childId を載せない (CWE-598 違反路線回避)

### 2.3 Pattern Z (age filter) default + Pattern Y (visibility chip) override

- **default = Pattern Z**: master の `age_min / age_max` と child の age を比較して自動表示。90% のケースで親は何もしない (Hick's Law 整合)
- **override = Pattern Y**: edit modal 内に per-child visibility chip 列を出し、親が任意に override 可能 (例: 9 歳の上の子に preschool 用ごほうびも見せたい)
- **一覧画面の row には visibility chip を default 非表示** (age filter 結果を信じる、UI noise を避ける)
- chip primitive は `VisibilityChipGroup` として `$lib/ui/primitives/` に新規追加 (本 EPIC #2362 PR-2 で実装)

### 2.4 child 選択は authenticated 内部 UI のみ

- import 完了直後トーストに「○○管理を開く」secondary CTA を入れ、admin/{type} 画面の対象 row に scroll + highlight して visibility 設定を促す
- visibility 設定は admin/{type} edit modal 内で完結 (authenticated session 必須)
- demo route (`src/routes/demo/(parent)/admin/`) も同型同期 (ADR-0047 demo-prod UI 等価性)

### 2.5 import service / strategy との連携 (ADR-0052)

- `ImportStrategy<T>.apply()` は family master row + 既定 visibility 行を一括 insert する
- 既定 visibility = 全 child ON (age filter で実表示は age 範囲外を自動除外、override は edit modal 経由)
- 各 type の Strategy 実装は `src/lib/marketplace/types/<type>.ts` に配置 (本 EPIC #2362 PR-3〜7 で順次実装)

---

## 3. 仕様

### 3.1 master + preferences 統一構造

```text
                ┌─────────────────────────┐
                │ <resource>_masters      │
                │ id (PK)                 │
                │ source_preset_id (optional)
                │ age_min / age_max       │ ← Pattern Z (age filter)
                │ (type 固有列)            │
                └────────────┬────────────┘
                             │ 1:N
                             ▼
                ┌─────────────────────────┐
                │ child_<resource>_preferences│
                │ id (PK)                 │
                │ child_id (FK)           │
                │ <resource>_id (FK)      │
                │ is_visible (default 1)  │ ← Pattern Y (override)
                │ (pin / sort_order 等)   │
                │ UNIQUE(child_id, <resource>_id)
                └─────────────────────────┘
```

### 3.2 5 type の対応一覧 (EPIC #2362 PR-3〜7 で順次実装)

| type | master table | preferences | progress / history | PR |
|---|---|---|---|---|
| activity | `activities` (既存) | `child_activity_preferences` (既存、`is_visible` 列追加) | `activity_logs` (既存) | PR-3 |
| reward-set | `reward_masters` (新) | `child_reward_preferences` (新) | `special_rewards` (granted_at 時系列、title 等は master JOIN) | PR-4 |
| checklist | `checklist_template_masters` (新) | `child_checklist_preferences` (新) | `checklist_logs` / `checklist_overrides` (template_id を master 参照に変更) | PR-5 |
| rule-preset | `rule_masters` (新) | `child_rule_preferences` (新、exchange / bonus 区別を含む) | `special_rewards` (exchange) / settings KVS (bonus) | PR-6 |
| challenge-set | `sibling_challenges` (既存、family-wide) | — | `sibling_challenge_progress` (既存) | PR-7 |

詳細 schema 定義は `docs/design/08-データベース設計書.md` §3.X を参照。

### 3.3 marketplace 詳細画面の UI

```text
┌─ /marketplace/reward-set/kinder-rewards ──────────────┐
│  🏆 幼児向けごほうびセット                              │
│  対象年齢: 3-6 歳                                     │
│                                                       │
│  含まれるごほうび (5件):                              │
│   - 🎮 ゲーム 30 分                                    │
│   ...                                                 │
│                                                       │
│  ┌──────────────────────────────────┐                │
│  │ [+ 家族に取り込む]                │  ← child 選択なし
│  └──────────────────────────────────┘                │
│                                                       │
│  取り込み後、ごほうび管理画面でお子さま別に             │
│  表示するかしないかを設定できます                       │
└────────────────────────────────────────────────────────┘
```

- 未認証: CTA = 「無料で始めて取り込む」(signup 誘導)
- 認証済み: CTA = 「家族に取り込む」(POST → トースト → admin/{type} へ遷移)
- child name はこの画面に一切登場しない

### 3.4 admin/{type} 画面の UI

- 一覧 row には visibility chip 列を default 非表示 (age filter 結果を信じる)
- edit modal 内に per-child visibility chip 列を表示
- chip primitive: `VisibilityChipGroup` (EPIC #2362 PR-2 で新規追加)
- 子供が 1 人なら chip 列非表示 (singleton optimization)

### 3.5 import 完了トーストの導線

```text
┌─────────────────────────────────┐
│ ✅ 家族に取り込みました          │
│                                 │
│ [○○管理を開く]                  │  ← admin/{type} の対象 row に
└─────────────────────────────────┘     scroll + highlight
```

---

## 4. 禁忌 (per-child instance パターン再発防止)

| 禁止事項 | 理由 |
|---|---|
| 新規リソース type を `<resource>.childId notNull` 形式で作成する | family master + per-child preferences 原則違反、技術負債発生 |
| marketplace ページに child name / プルダウン / `?childId=X` URL を出す | CWE-598 違反、privacy 信頼毀損 |
| import action で childId 引数を受け取る | family-wide master 登録の paradigm 破壊 |
| visibility 列を `child_<resource>_preferences` 以外の場所で表現する (例: `<resource>_masters.visible_children TEXT` JSON 列) | junction table SSOT 違反、検索性能 / 拡張性低下 |
| chip primitive を duplicate 実装する (`$lib/features/` 配下で独自 chip 再実装) | DRY 違反、`VisibilityChipGroup` SSOT 違反 |

---

## 5. marketplace は family scope only

- marketplace = 「家族リソースに何を加えるか」の resource discovery 経路
- marketplace = 「どの子に何を買うか」の child shopping ではない
- public ページ (`/marketplace`) で表示する情報: master 由来の preset 情報のみ (preset 名 / preset 説明 / age 範囲 / 含まれる item 一覧)
- 未認証 user に対しても child name / family member 情報を一切出さない (Notion / Asana / Linear / Trello / VSCode Marketplace 同型)

---

## 6. 並行実装影響

本原則を変更する場合、以下の並行実装を同期更新する:

- `src/lib/server/db/schema.ts` (master + preferences の SQLite 定義)
- `src/lib/server/db/dynamodb/*-repo.ts` (DynamoDB 側 master / preferences repository、ADR-0031 同型)
- `src/lib/server/services/<resource>-*.ts` (service 層の import / visibility 更新ロジック)
- `src/routes/admin/<type>/+page.svelte` (admin 画面の chip UI)
- `src/routes/demo/(parent)/admin/<type>/+page.svelte` (demo 同型 UI、ADR-0047)
- `tests/e2e/global-setup.ts` / `tests/unit/helpers/test-db.ts` / `src/lib/server/demo/demo-data.ts` (fixture)
- `docs/design/parallel-implementations.md` (本原則を追加)
- `docs/design/08-データベース設計書.md` (schema 定義)
- `docs/decisions/0054-family-master-per-child-preference-pattern.md` (本原則の意思決定根拠)

---

## 関連

- [ADR-0054](../decisions/0054-family-master-per-child-preference-pattern.md) — 本原則の意思決定根拠
- [ADR-0052](../decisions/0052-marketplace-type-registry.md) — import strategy 側 (Registry + Strategy パターン)
- [ADR-0047](../decisions/0047-demo-prod-ui-contract-ssot.md) — demo / 本番 UI 等価性原則
- [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md) — Pre-PMF Bucket A 判断
- [`docs/design/08-データベース設計書.md`](08-データベース設計書.md) — schema 定義 SSOT
- [`docs/design/marketplace-architecture.md`](marketplace-architecture.md) — Registry + Strategy 全体像
- EPIC #2362 — UnifiedImportHub 統一
