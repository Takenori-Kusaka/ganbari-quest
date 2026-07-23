# 15. ログインボーナス counter 縮約 (案 B) rationale

**関連 Issue**: #3330 / **関連 research**: [docs/research/2026-07-11-login-data-structure.md](../research/2026-07-11-login-data-structure.md) / **関連 ADR**: ADR-0012 (anti-engagement)・ADR-0049 (retention、本決定で改訂)

## 1. 決定 (PO 決裁 2026-07-19)

per-date 永続行 (`login_bonuses` 表の日次行) を廃し、子供ごとの **counter 状態
(`login_streaks`: lastLoginDate + currentStreak)** に縮約する (**案 B 採用**)。

- **案 D (ログインボーナス機構自体の縮小/廃止) は不採用** — ログインボーナスは価値であり、
  anti-engagement を理由に毀損しない (PO 判断)。おみくじ rank / 連続倍率テーブル /
  point_ledger 記帳は現行仕様のまま維持する。
- **新規 ADR は起票しない** (PO 意向: ADR は最小限維持)。記録は既存 ADR-0049 の改訂
  (login_bonuses を retention 物理削除対象から除去) + 本 rationale + `08-データベース設計書.md` /
  `dsql-data-model.md` 同期で行う。

## 2. 検討した代替案と棄却理由 (research doc §3 の要約)

| 案 | 内容 | 判断 |
|---|---|---|
| A: 現状維持 (per-date 永続) | `login_bonuses` 日次行を保持 | 棄却 — premium/NUC で無限増加、COPPA 2025 / GDPR data minimization に不整合、backup 線形肥大 (#3329) |
| **B: counter 縮約 (採用)** | `lastLoginDate` + `currentStreak` の 1 状態 | 業界定石 (Duolingo / Habitica 型)。全 consumer が 2 フィールド + conditional write で成立、失う機能なし (履歴カレンダー UI は存在しない、付与事実は point_ledger 保持) |
| C: counter + bounded window | B + 直近 N 日の bitmap / 窓 | 棄却 — 窓の消費者が存在しない (YAGNI) |
| D: 機構自体の縮小/廃止 | データ構造と独立のプロダクト判断 | 不採用 (PO 決裁: ログインボーナスは価値) |

## 3. 実装上の設計判断 (#3330 実装 PR)

- **当日冪等の担保方式**: 旧 per-date PK 衝突 → **conditional write**
  (`INSERT ... ON CONFLICT DO UPDATE SET current_streak = CASE ... WHERE last_login_date <> excluded.last_login_date`)。
  increment / reset の判定も SQL 内 CASE で行い、read-then-write の TOCTOU 窓を作らない。
  race 回帰は `tests/unit/db/dsql-login-streak-repo.test.ts` (PGlite 実 tx、failing-test-first で
  naive 実装の二重加点 fail を物理確認済、ADR-0061)。
- **PK**: `login_streaks (family_id, child_id)` の child-level 自然 PK (pk-freeze-manifest
  anchor (b) 構造的確実性 — counter 縮約により per-date cardinality が product 上存在しない)。
- **migration**: 既存 per-date 行から counter を導出する fold は「最新ログイン日を終端に前日が
  存在する限り遡る」旧 `calculateConsecutiveDays` と同一論理
  (`deriveStreakCounter`、SQL 側は gaps-and-islands)。sqlite = lazy-startup-migration、
  pg (DSQL / NUC PGlite) = `drizzle/pglite/0003+0004` migration が fold + 旧表 DROP を行う。
- **backup 後方互換**: EXPORT_VERSION 1.8.0 (初の breaking transform)。旧 backup の
  `loginBonuses[]` は export-migrations の 1.7.0→1.8.0 step が childRef ごとに fold して
  `loginStreaks[]` に変換する (旧 backup 読込可)。新 export は counter のみで固定サイズ化 (#3329)。
  merge import は「lastLoginDate が新しい方 (同日なら streak 大)」を残す conditional upsert。
- **retention**: `retention-cleanup-service.ts` から login_bonuses 削除ロジックを除去
  (削除すべき履歴が最初から生まれない = privacy by design、ADR-0049 改訂)。

## 4. 残懸念

- 過去日の遡及修正 (ログインの付け直し) は不可能になるが、現 UI にその機能はなく、
  counter 破損時も 1 から再開で被害は限定される (付与事実は point_ledger に残る)。
- タイムゾーン境界は JST 固定 (`todayDateJST`) の現行踏襲で影響なし。
