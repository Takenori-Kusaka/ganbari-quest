# staging 合成ダミーデータ seed 設計書 (#3412)

**関連**: #2999 (本番 PII を staging で使わない) / #2872 (NUC staging) / #2873 (AWS staging) / ADR-0064 (PGlite) / ADR-0066 (export/import 値域 SSOT)
**研究 SSOT**: [docs/research/2026-06-28-dummy-dataset-requirements.md](../research/2026-06-28-dummy-dataset-requirements.md) (網羅次元 D1-D21 / 既存資産評価 / 選択肢比較)

---

## §1 設計背景

staging (NUC #2872) は本番 DB snapshot (`scripts/snapshot-prod-db.cjs`) から起動しており、実在の子供のニックネーム・生年月日・活動履歴 (= PII、CWE-359/200) が staging 環境に複製される。本設計がなかった場合:

- 本番 PII が検証環境に恒常的に流出し続ける (privacy / 法務リスクの構造化)
- AWS staging (#2873、cognito + DSQL) には本番 snapshot を流す経路自体がなく、「機能を一通り検証できる代表データ」が存在しない
- 検証データが本番の偶然の状態に依存し、決定的な visual regression / E2E の基盤にならない

PO 方針: 本番 PII の匿名化 mask ではなく、**最初から合成 (synthetic) データセット**で代替する。

## §2 設計原則

1. **既存資産の最大再利用** (research §5 決定 = 選択肢 A+B、#1442 使い捨て script 禁止):
   demo-data.ts (PII-free がんばり家) を Tenant A の基盤に再利用し、プラン / トライアル軸の薄い tenant を専用 fixture で足す。流し込みは backup wire format (`ExportData`) + `importFamilyData` + `nuc-cutover-verify` 件数突合を再利用し、専用 insert 経路を新設しない (ADR-0066 wire SSOT 整合)。
2. **決定性** (AC3): 乱数 / wall-clock 非使用 (faker 不採用、research §5 選択肢 C)。全日付は `anchorDate` の純関数で、同一 anchor に対し出力 byte 同一。
3. **PII-free の機械保証** (AC1): 実在名 denylist はそれ自体が PII になるため置かず、「出現してよい合成名の完全列挙 (allowlist)」+ email / 電話番号 pattern の全走査 0 件を unit test で fail-closed 検証する。
4. **非破壊 / fail-closed**: 空 dataDir にのみ seed し、import error / 件数突合不一致は部分構築を削除して abort する (`nuc-pglite-cutover.ts` と同型)。

## §3 データセット仕様

SSOT: `src/lib/server/demo/synthetic-staging-dataset.ts` (`buildSyntheticStagingDataset`)。5 tenant で research §2 の次元を網羅する:

| tenant key | tenantUuid | plan / trial | 内容 | 担う次元 |
|---|---|---|---|---|
| `premium-family` | `LOCAL_TENANT_UUID` | family-monthly | がんばり家 5 人 (demo-data.ts 変換)。per-child 活動 + 14 日履歴 + marketplace 取込済 + checklist + スタンプ + 交換申請 3 status + 証明書 + メッセージ / きょうだい応援 | D1-D3 / D9-D17 / D20 |
| `free` | `...00b1` | free (plan null) | 子供 1 人 + 最小データ。marketplace 未取込 = empty admin | D4 / D18 |
| `trial-active` | `...00c1` | trial standard (anchor-2..+5 日) | 子供 1 人。トライアルバナー表示 | D6 |
| `trial-expired` | `...00c2` | trial family (anchor-30..-23 日) | 子供 1 人 + archive 済 activity / checklist | D6 / D19 |
| `empty` | `...00d1` | free | 子供 0 人 (行を一切 seed しない) | D18 |

- **anchor shift**: `--anchor` (YYYY-MM-DD / today) で全日付 (birthDate 含む) が一律 shift される。birthDate も shift するため compute-on-read の age-tier 網羅 (5 mode) が anchor に依らず保たれる。trial は相対 offset (`startOffsetDays` / `endOffsetDays`) で保持し apply 時に絶対日付へ解決する。
- **ロール軸 (D8、owner/parent/child/ops/federated)**: auth 層 (Cognito user) の関心で DB seed では表現しない。cognito staging のアカウント整備は `DEV_USERS` 同型で #2873 lane が担う。
- **wire format 外の実体** (dailyBattles / enemyCollection 等、export-format 非対象): seed 対象外。バトル戦績は demo Lambda (DATA_SOURCE=demo) のみが持つ。

## §4 seed 実行フロー

```
scripts/seed-staging.ts generate --out <json> [--anchor today]   # DB 不要・決定的
scripts/seed-staging.ts apply --in <json> --data-dir <pglite>    # fresh PGlite 構築 + 件数突合
```

- generate / apply は別プロセス (factory singleton 制約、`nuc-pglite-cutover.ts` と同じ)。
- apply core は `scripts/lib/runtime/seed-staging-apply.ts` (`applySyntheticDataset`)。drizzle pg db を注入できるため PGlite / DSQL (AWS staging) の両 pg-core backend で共通。tenant ごとに ①families 行 (plan 軸) ②trial_history 行 ③`importFamilyData` verbatim ④`nuc-cutover-verify` 件数突合 を実行する。
- 機械検証: `tests/unit/demo/synthetic-staging-dataset.test.ts` (PII-free / 決定性 / 次元網羅) + `tests/unit/services/synthetic-staging-seed-pglite.test.ts` (実 PGlite への貫通 + 件数突合)。

## §5 staging 配線

| 環境 | 配線 | 状態 |
|---|---|---|
| NUC staging (#2872) | `deploy-nuc-staging.yml` の `workflow_dispatch` input `syntheticSeed` (opt-in、`pgliteEnabled=true` 前提)。true で本番 snapshot (Step 4) + cutover rehearsal (Step 5.5) を skip し、image 同梱 CLI で `generate --anchor <当日>` → `apply --data-dir /app/data/pglite` を実行して起動する | 配線済 (実機発火は統合 PR / dispatch lane で確認) |
| NUC staging 統合 PR (pull_request) | 従来どおり snapshot + cutover rehearsal (既存検証フロー不変)。**合成 seed への完全切替 (snapshot 経路の置換) は staging 実機で合成 seed lane の緑を確認後に判断**し、切替時に `snapshot-prod-db.cjs` の staging 用途を撤去する | 未切替 (#2999 完遂条件) |
| AWS staging (#2873) | apply core は DSQL でも動く構造 (drizzle db 注入 + factory 経由 repos)。DSQL staging cluster への seed 配線 (creds / dsql:migrate 後の実行 step) は #2873 lane で行う | 構造準備済 / 配線は #2873 |
