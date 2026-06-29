# DSQL データモデル設計書（ground-up 再設計、EPIC #3424）

> **状態**: 叩き台（PO レビュー反復で確定）。関連: EPIC #3424 / #3433 / ADR-0063 / research `2026-06-28-aurora-dsql-adoption.md` §10-§11。
> **原則**: 既存 schema は**入力であって anchor ではない**。ドメインとアクセスパターンから DSQL 最適なリレーショナルモデルを起こす。

---

## §1 設計背景（この設計がなかった場合に何が困るか）

現行 DB は **3 バックエンド並行実装（SQLite / DynamoDB / demo）の共通形状**であり、スキーマが DynamoDB single-table に強く規定されている（監査で実証）:

- auth ドメイン（tenant/user/membership/invite/consent）が **SQL schema に不在**（DynamoDB 専用）。
- tenant_id が 46 表中 15 表のみ。child 配下は childId 経由の暗黙導出で、SQLite は `_tenantId` を捨てる。
- surrogate integer PK 43/46 + `counter.ts`（hot-item 採番）+ `padId` 辞書順ハック。
- JSON 詰め込み（itemsJson 等）/ 非正規化スナップショット / 残高二重実装（BALANCE item vs SUM）。
- `recordActivity` が 5+ 表を**非トランザクション best-effort**で書込（例外握り潰し）。

これを「移植」すると **DSQL に NoSQL 前提構造を持ち込み**、整合性・コスト・保守性を恒久的に毀損する。SQL 統一の機に、あるべき DB 設計を ground-up で確定する。

## §2 設計原則（DSQL 物理特性 → 設計ルール、一次ソース根拠は research §11）

| # | 原則 | 根拠 |
|---|---|---|
| P1 | **PK = 物理レイアウト**（DSQL は index-organized）。PK は後から変更不可 → 凍結してから migration | Primary keys doc |
| P2 | **複合 tenant PK `(family_id, …)`** をテナント系全表に（tenant_id 先頭）。同一家族を物理共置・越境クエリ抑止 | Citus 定石 / SaaS PG Guidance |
| P3 | **UUID PK 既定**（`gen_random_uuid()`、実機✅）。単調増加 PK 禁止（hot partition）。自然複合 identity は複合自然 PK に昇格 | SQLAlchemy blog / Part2 |
| P4 | **FK 非対応 → DDD 集約 + repository で整合**。`onDelete cascade` 不可 → soft delete（`deleted_at`） | SQL Dialect blog |
| P5 | **index 最小化**（1本=全書込の追加 DPU）。読み hot path は `INCLUDE` covering。表あたり実用 2-4 本 | EXPLAIN blog / quotas |
| P6 | **3NF 既定**。非正規化は「read DPU 削減 > 追加 write DPU」を計測で示した場合のみ。JSON 列型は使わない（解体 or TEXT+cast） | EXPLAIN blog / SQL Dialect |
| P7 | **派生データは同一 txn 内の派生列**（残高等）。手動 ADD 乖離（Dynamo）を根絶。重い集計は compute-on-read+index を既定、計測でマテビュー化 | 監査 §2A |
| P8 | **1 txn = 1 集約**。3,000 行/10MiB/5分 上限と自然整合。集約横断は結果整合 + 冪等。OCC 40001 retry ラッパ | quotas / Concurrency doc |
| P9 | **tenant_id NOT NULL を全テナント表で機械強制**（fitness function、ADR-0063） | ADR-0063 |
| P10 | **cloud=DSQL(pg)/local=SQLite が同一論理モデル共有**。tenant_id は SQLite でも保持（単一家族では定数）。FK は両方張らない | EPIC #3424 |

## §3 集約マップ（DDD aggregate）

| 集約ルート | 主な子エンティティ | txn 境界根拠 |
|---|---|---|
| **Family（テナントルート）** | users, memberships, invites, consents, settings, subscription, push_subscriptions, notification_logs, trial_history, viewer_tokens, cloud_exports, cancellation_reasons, graduation_consent | auth ドメイン。SQL で初めて正式化 |
| **Child** | activity_logs, point_ledger(+balance 派生列), statuses, status_history, evaluations, activity_mastery, daily_missions, login_bonuses, child_achievements, special_rewards, reward_redemptions, certificates, parent_messages, sibling_cheers, character_images, checklist_logs(+items), checklist_overrides, child_challenges, daily_battles, enemy_collection, usage_logs, rest_days, report_daily_summaries | `deleteChild` が 11 表を 1 txn 削除＝最強シグナル |
| **StampCard**（Child サブ集約） | stamp_entries | card 単位で entry を扱う |
| **ChecklistTemplate**（Family master） | checklist_template_items, checklist_template_assignments(N:M child) | family master。進捗は Child 集約側 |
| **グローバル master**（tenant 非依存） | categories, achievements, stamp_masters, market_benchmarks, stripe_webhook_events | tenant プレフィクスなし |

> **整合ルール**: 集約をまたぐ書込は同一 txn にしない（結果整合 + 冪等）。集約内は 1 txn（例: `recordActivity` を単一 txn 化）。

## §4 キー戦略

- **Family ルート**: `families (family_id uuid PRIMARY KEY DEFAULT gen_random_uuid())`。
- **テナント系全表**: `PRIMARY KEY (family_id, <entity_id>)`（family_id 先頭）。entity_id は UUID 既定。
- **自然複合 identity の子表は複合自然 PK 昇格**（surrogate + counter.ts + padId 全廃）。例:
  - `statuses (family_id, child_id, category_id) PK`（旧 surrogate id + unique(child,category)）
  - `activity_mastery (family_id, child_id, activity_id) PK`
  - `login_bonuses (family_id, child_id, login_date) PK`
  - `daily_missions (family_id, child_id, mission_date, activity_id) PK`
  - `stamp_entries (family_id, card_id, slot) PK`
  - `checklist_logs (family_id, child_id, template_id, checked_date) PK`
- **テナント内一意制約**は `UNIQUE(family_id, …)`（グローバル一意は分散で hot 化のため避ける）。
- **グローバル master**は自然キー優先: `categories(code) PK` / `achievements(code) PK` / `stripe_webhook_events(event_id) PK`。

## §5 正規化（JSON 解体・派生データ）

### JSON 列の解体（P6）
| 旧 JSON 列 | 新リレーショナル |
|---|---|
| `checklist_logs.itemsJson` | `checklist_log_items (family_id, child_id, template_id, checked_date, item_id, checked bool)` |
| `child_challenges.targetConfig/rewardConfig` | 列展開（`metric`/`category_id`(論理FK)/`base_target`/`reward_points`/`reward_message`） |
| `daily_battles.playerStatsJson` | 列展開 or `daily_battle_stats` 子表 |
| `evaluations.scoresJson` | `evaluation_scores (… , category_id, score)` |
| `report_daily_summaries.categoryBreakdown/checklistCompletion` | §7 で read-model 再判定（解体 or 廃止） |
| `children.displayConfig` / `certificates.metadata` / `achievements.milestoneValues` | 設定値は列展開。真に可変な構成のみ TEXT+cast（要 PO 判断） |

### 派生列（P7）
- `children.total_point`（残高）: `point_ledger` への INSERT と**同一 txn で更新**。乖離不能。閲覧は列 read 1 回（SUM スキャン廃止 → DPU 削減）。
- `statuses.total_xp/level/peak_xp`: status 更新 txn 内で派生維持。
- `activity_logs.streak_days/streak_bonus`: 記録 txn 内で算出・確定。
- 監査用の再計算は**バッチで突合**（drift 検出 fitness）し、正本は派生列。

## §6 カタログ + override 再設計（ADR-0055 見直し、PO 採択済方針）

現行 `child_activities`（活動を子供ごとに物理コピー）+ 旧 `activities` 二重テーブルを解消:

```
activity_catalog (family_id, activity_id) PK        -- 家族の活動マスタ（1 定義）
  name, category_id, base_point, default_*, deleted_at
child_activity_override (family_id, child_id, activity_id) PK  -- 子ごとの差分のみ
  enabled, point_override, sort_order, is_archived, ...(null = カタログ既定継承)
```
- 配信は override 行の有無で表現（コピー消滅、重複書込・DPU 削減）。
- child 表示 = カタログ ⟕ override の解決（repository で合成、INCLUDE covering で 1 パス）。
- マイグレーション: 既存 per-child instance → カタログ（重複排除）+ child override（差分抽出）。**要 PO 確認**: 既存データの「どこまでを差分とみなすか」の抽出ルール。

## §7 read-model（report_daily_summaries）

Dynamo は GSI 回避で持たざるを得なかった read-model。DSQL では **compute-on-read + index を既定**（`activity_logs`/`checklist_logs`/`statuses` から集計）。実 DPU を計測し、ホーム/レポートで恒常的に重ければマテビュー化（更新は集計元 txn 内 or バッチ、乖離しない形）。**まず廃止して実クエリ化を試す**。

## §8 recordActivity 単一トランザクション化（最大の質的改善）

現行 5+ 表 best-effort 書込（例外握り潰し）→ **Child 集約内 1 txn**:
```
BEGIN
  insert activity_log
  upsert activity_mastery
  insert point_ledger + update children.total_point(派生列)
  update statuses(+status_history)
  combo/mission/challenge/certificate 判定（同集約内）
COMMIT  (OCC 40001 なら冪等 retry)
```
- 3,000 行/10MiB に収まる粒度（1 記録 = 数十行）。
- 失敗は全ロールバック（部分適用の不整合を根絶）。

## §9 NUC(SQLite) 両立・マイグレーション

- 同一論理モデルを drizzle で sqlite-core / pg-core 2 方言定義（型差分は §P3/P6 に従い両立）。tenant_id は SQLite でも保持（単一家族は定数 `default`）。FK は両方張らない。
- **NUC cutover はデータ保全マイグレーション**（#3438）: backup → backup-archive 論理エクスポート → 新スキーマ DB 構築 → 変換 import → コピー検証 → 切替（旧 DB 保持）。**`drizzle-kit push` 禁止**。
- 旧 surrogate integer id → UUID 変換は論理エクスポート時に id マッピング表を作り、参照（旧 FK）を新 UUID へ張り替える。

## §10 未決事項（PO レビューで確定）

1. **catalog+override の差分抽出ルール**（§6 マイグレーション）— 既存 per-child instance のどの属性を「override」とみなすか。
2. **report_daily_summaries**（§7）— compute-on-read 化で許容レイテンシか、マテビュー維持か（実 DPU 計測後判断）。
3. **reward_redemptions のスナップショット列**（rewardTitle 等）— 申請時点 snapshot を正式 `reward_redemption_snapshot` 子表に分離するか、live JOIN に一本化するか。
4. **可変構成 JSON**（displayConfig 等）— 完全列展開 vs TEXT+cast の線引き。
5. **enum/CHECK 制約**（priority/status/archivedReason 等）— pg enum 型 vs CHECK 制約。
6. **auth ドメインの粒度**（memberships/invites/consents の正規化深度）— 現 DynamoDB 実装からの抽出範囲。
