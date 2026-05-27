# Issue #2510 — activities Data Recovery Rationale

> **対象**: 開発者 / future maintainer
> **関連 Issue**: [#2510](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2510)
> **関連 PR**: 本 PR (Phase 1 recovery + runbook + 4 dim SSOT), 後続 PR (PR #2509 マージ後 lazy-startup-migrations.ts に `migrateActivitiesLegacyDataCopy()` append + test)
> **関連 ADR**: ADR-0002 / ADR-0010 / ADR-0031

---

## 1. なぜ Phase 1 (NUC SQL 復旧) を先に行ったか

### 検討した選択肢

#### A: PR #2509 マージ待ち → main から派生 → 全 Phase 1 PR 完遂

- Pros: 1 PR で完遂、conflict 0
- Cons: PR #2509 は `lint-and-test` / `ci-gate` 失敗で停滞中。マージ時刻 不明。NUC user は data 全件 orphan で UI 表示不可の状態が継続

#### B: PR #2509 worktree (`wt-2509`) で append → 同一 file の stacked work

- Pros: 1 PR にまとめられる
- Cons: 他 Agent (a4efb279526b1e82d) との衝突リスク、PR #2509 スコープ膨張

#### C: 緊急 SQL 復旧を即時実施 + Recovery Script を独立 PR + 恒久 fix は PR #2509 マージ後の follow-up PR

- Pros: NUC user の緊急性を即解消、本 PR は独立で完結、PR #2509 と非依存
- Cons: フォローアップ PR が必要 (`yarikiri = 分割 PR は OK、ただし後続 PR を必ず実施` 原則整合)

### 決定

**選択肢 C 採用**。理由:

1. NUC user 緊急性 (data 全件 UI 不表示) は分単位での復旧が望ましい。PR #2509 マージ待ちは数時間〜数日想定で受容不可
2. Recovery script は将来 DynamoDB 等別 backend で同型問題が起きた際にも再利用可能な runbook として価値がある
3. PR #2509 マージ後の follow-up PR (Issue #2510 AC2 / AC3) で恒久 fix を実施することで、`feedback_yarikiri_means_no_carryover.md` 「分割 PR は OK、後続 PR を必ず実施」原則を満たす

---

## 2. Recovery Script の copy 範囲: なぜ「referenced ∪ age_fit」か

各 child に対する `child_activities` copy 対象選定で 3 つの選択肢を検討:

### Option 1: referenced のみ (history 保全のみ)

- Pros: 最小限の copy、UI 一覧の overlap なし
- Cons: 新規 activity 追加経路 (`/admin/activities` add) が機能するまで一覧空、user 操作 UX 悪化

### Option 2: age 適合 のみ (UI 一覧のみ)

- Pros: 新規 child でも UI 即動作
- Cons: 既往 activity_logs が orphan 残存、過去履歴 表示不可 → 本 Issue の根本症状再発

### Option 3: referenced ∪ age_fit ∪ is_archived=0 (採用)

- Pros: history 保全 (logs / missions / mastery / prefs 全件 remap 可能) + UI 一覧表示両立。is_archived=0 で運用上不要 activity を除外
- Cons: copy 件数がやや多い (NUC 実績 76 件、PostgreSQL 等の scale-up 環境では数千件規模可能性)

### 決定

**Option 3 採用**。NUC 規模 (children 2 / activities 191 → copy 76) では性能問題なし。scale-up 時は `migrateActivitiesLegacyDataCopy` で同等 logic を batch 化する想定。

---

## 3. なぜ recovery script を runbook 化したか (一過性 script に留めない)

`feedback_root_cause_first_principle.md` 「短期措置は必ず根本 Issue とセット」 + `feedback_preserve_intermediate.md` 「中間成果物保全」原則整合:

- recovery script を捨て (1 回切り NUC 復旧後 delete) せず `scripts/recover-activities-data.mjs` に永続化
- runbook (`docs/runbooks/activities-data-recovery.md`) で再現手順を明文化
- 別 backend (DynamoDB / Postgres) で同型問題が起きた際に同じ pattern を再利用

これにより、たとえ恒久 fix (lazy-startup-migrations.ts append) が PR #2509 マージ後フォローアップに分割されても、当面の緊急復旧手順は SSOT 化される。

---

## 4. 4 dimension SSOT の独立扱い (dim 3 vs dim 4)

### 検討した選択肢

#### A: dim 3 (structural) と dim 4 (data copy) を一体扱い

- 1 つの章 (`Schema 変更時の lazy migration`) で両方を扱う

#### B: dim 3 と dim 4 を明示的に分離

- 4 dim SSOT の独立 row として扱う

### 決定

**選択肢 B 採用**。理由: PR #2487 (activities flip) が dim 3 (`migrateActivityFkSwitchover`) のみ実装し dim 4 を漏らした典型例。**両者の責務を明示的に分離**することで、今後の `#2458-*` 系 PR レビュー時に「FK swap した? data copy も書いた?」を 2 軸で確認可能。

PR #2480 (checklist_templates flip) は PR #2509 で dim 3 + dim 4 を 1 PR で完遂した好例。本 PR / Issue #2510 follow-up は同じ pattern で activities を完遂する。

---

## 5. 棄却された案 (back-mig: 旧 activities table 再 active 化)

### 検討した選択肢 X: 旧 activities table を SSOT に戻す (PR #2487 を rollback)

- Pros: 復旧時間 0 (revert のみ)
- Cons: ADR-0055 (per-child 主軸 + 限定 family master データモデル) に逆行。マルチ child 環境で個別 customize が不可能。PR #2487 / #2491 / #2497 / #2498 等 4 連続 PR の意思決定を覆す

### 棄却理由

**ADR-0055 整合性**: per-child 主軸が production design として確立済。「PR #2487 が data copy を漏らした」のは migration logic の欠陥であって、設計方針自体は維持されるべき。

---

## 6. 残懸念

### 6.1 DynamoDB backend で同型問題が起きるか

PR #2491 (`#2458-A2 demo + dynamodb activity-repo 同期`) は demo + dynamodb の write 経路を per-child に統合済。**ただし**:

- 既存 DynamoDB tenant data の activities → child_activities 移行 (data copy) は **未実施**
- 現状の本番 SaaS user 数は 0 (NUC self-host 1 件のみ) のため緊急性なし
- 将来 SaaS 立上時 ([Pre-PMF 段階](../decisions/0010-pre-pmf-scope-judgment.md)) には DynamoDB 用 backfill script (本 recovery script の DynamoDB ポート) が必要

### 6.2 child_activities の追加 INSERT 性能

NUC 規模 (76 行) では問題なし。scale-up (例: 子供 5 人 × 191 activities = 955 行) でも prepared statement + transaction 内なので 1 秒未満想定。

### 6.3 同期書き戻し (renew) 経路

Recovery script は **一度切りの copy** であり、その後に `activities` table に追加された row は `child_activities` に伝播しない。**本 PR scope では問題なし**:

- PR #2487 (`activity-repo.ts`) は `child_activities` を SSOT として write、旧 `activities` への write 経路 0
- 旧 `activities` table は read 経路 0 (今後 #2458 で物理 drop 予定)
- 新規 activity は `child_activities` に直接 INSERT される

---

## 7. 関連 ADR / ドキュメント

- [ADR-0002 Critical 5 要件](../decisions/0002-critical-fix-quality-gate.md)
- [ADR-0010 Pre-PMF Bucket A](../decisions/0010-pre-pmf-scope-judgment.md)
- [ADR-0031 SQLite ADD COLUMN only (archive)](../decisions/archive/0031-schema-change-compat-testing.md)
- [ADR-0055 per-child 主軸 + 限定 family master](../decisions/0055-per-child-primary-data-model-pattern.md)
- [docs/design/08-データベース設計書.md §8.6](../design/08-データベース設計書.md) (4 dim SSOT)
- [docs/runbooks/activities-data-recovery.md](../runbooks/activities-data-recovery.md) (緊急復旧 runbook)
- 教訓 memory: `feedback_schema_ssot_create_tables_sync.md` (4 dim 拡張)
