# 0065. DSQL DPU コスト規約 — service 層クエリの 5 原則 (実測裏付け)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-07-11 |
| 起票者 | Dev (Claude 補佐) |
| 関連 Issue | #3430 / #3425 (実測) / EPIC #3424 |

## コンテキスト

DSQL の課金は DPU (処理バイト + CPU 秒) で、行数課金ではない。設計を誤ると「機能は正しいがコストが爆発する」クエリが CI を素通りする。規約の前提は #3425 の staging 実測で裏取り済み:

- **write txn には Transaction minimum 0.05 WriteDPU / read に 0.00375 ReadDPU** が適用される (EXPLAIN ANALYZE VERBOSE 実測)。小さい write を N txn に分けると、内容に関わらず 0.05×N が課金される
- WriteDPU は同量処理で ReadDPU の約 27 倍のコスト密度 (公式 billing-metering)
- **スキャンした全行が課金対象** (フィルタ後の返却行ではない)。非 PK filter は統計未反映時 full scan になる (Phase 1 PoC 検証 7)
- 代表クエリ実測: home read 0.050 / 履歴 50 件 0.056 / ledger INSERT 0.022 / 残高 UPDATE 0.012 DPU — 定常運用は無料枠の 1% 未満であり、**規約の目的は「正常時の節約」ではなく「事故 (full scan / N+1 の常態化) の構造的防止**」

## 検討した選択肢（OSS / 確立パターン — #1350）

### 選択肢 A: DynamoDB 時代の RCU/WCU 規約の踏襲 (確立パターン)
- 概要: 旧 backend で運用していた「PK アクセス必須 / scan 禁止」の慣行
- メリット: チームに既知。DSQL の PK prefix 原則と同型
- デメリット: txn minimum 課金・DPU の read/write 非対称という DSQL 固有の軸を持たない

### 選択肢 B: pgMustard 等の EXPLAIN 解析 SaaS・OSS
- 概要: Postgres の実行計画を継続解析しコスト回帰を検出する製品群
- メリット: 成熟した回帰検出
- デメリット: DSQL の DPU Estimate は独自拡張で対応外。外部 SaaS は Pre-PMF 過剰 (ADR-0010)

### 選択肢 C: 本 ADR (5 原則 + EXPLAIN 相対チェック運用)
- A の PK 原則を継承しつつ、DSQL 固有 (txn minimum / DPU 非対称 / ASYNC index 制約) を実測値で規約化。ツール導入ゼロ

## 決定 — service 層クエリの 5 原則

1. **フルスキャン禁止 (PK prefix 必須)**: 全クエリは `WHERE family_id = ...` を先頭に持つ複合 PK prefix でアクセスする (ADR-0063 tenant 分離と同一の機械強制点)。非 PK filter を追加する場合は PK prefix で範囲を絞った上で適用する
2. **N+1 禁止・write は束ねる**: 同一操作の複数 write は単一 txn にまとめる (txn minimum 0.05 WriteDPU × N の防止、実測裏付け)。模範 = `recordActivityCore` (core 5 行 1 txn、#3541)。ループ内 `await repo.insert()` の逐次 txn は禁止
3. **secondary index は既定で張らない (PoC 保留原則)**: 全 index が write 課金対象 (≤24/table)。追加は実データ規模での実測 (m3-physical-model §5.2) を経て採否判断。「張れば効く」は統計未反映時に成立しない (Phase 1 PoC 検証 7)
4. **hot key write を作らない**: 連番・固定 key への write 集中は OCC 競合 → retry 再実行の二重課金。UUID v4 PK 分散を維持 (§P9)
5. **一括処理は 3,000 行 / 10MiB チャンク + 冪等 upsert**: import/復元は txn ハード上限 (P5) 内に分割 (§6.4)

**EXPLAIN 運用**: `EXPLAIN ANALYZE VERBOSE` の Statement DPU Estimate は **相対比較 (変更前後の回帰確認) 用**とし、絶対閾値の CI gate にはしない (Estimate は billing-grade でない + データ量依存)。重い新規クエリ (集計 / cross-tenant cron) を追加する PR は、PR body に代表データでの DPU Estimate を記録する (レビュー判断材料。機械 gate 化は実運用の回帰実績が出てから再判断)

## 機械強制の適用状況 (原則 1 / 2、#3682 AC1)

- **原則 1 (PK prefix 必須) = 既存 fitness 2 本の合成でカバー済 (新規 fitness 不要)**。
  (a) `tests/unit/db/pk-freeze-manifest.test.ts` [2b] が全テナント表の PK 先頭 = `family_id` を強制し、
  (b) `tests/unit/architecture/dsql-tenant-predicate-fitness.test.ts` (ADR-0063) が dsql module の全 SQL 文に `family_id` 述語を強制する (例外は閉じた allowlist)。
  ∴ family_id 述語 = 複合 PK 先頭列アクセス = PK prefix であり、原則 1 は tenant 分離と同一強制点で機械強制済。allowlist 例外 (global-UNIQUE capability lookup = UNIQUE index 経由 / cross-tenant cron §11.2) は原則 1 の明示例外と同一集合
- **原則 2 (ループ内逐次 txn 禁止) = `tests/unit/architecture/dsql-loop-sequential-write-fitness.test.ts` (#3682) で機械強制**。
  TS AST でループ body 内の awaited write call (`await repo.insertX(...)` 等) を検出し、既存分は baseline に file × method × count で pin (ratchet、増加 = CI fail / 減少 = baseline 更新)。正当な例外 (cross-tenant cron の per-tenant txn 分離 / 非 DB write) は `// dpu2-allow: <理由>` で明示除外
- **静的検出の限界 (残余はレビュー基準で担保)**: helper 関数経由の transitive write (`await processChild(...)` 等) と `Promise.all(map(...))` 並行形状は静的追跡不能。原則 3〜5 も定量判断 / 実測依存のため機械 gate 化しない (per-query DPU 予算 gate は #3682 AC2 = cutover 後 1 ヶ月の CloudWatch 実測で要否判断)

## 結果

- コスト事故 (full scan 常態化 / N+1) がコードレビューの明文基準になる。監視側は CloudWatch TotalDPU 日次 alarm (#3431) が defense-in-depth
- トレードオフ: 原則 3 により当面 secondary index なしで読み性能は PK 依存。家庭スケール (実測: home read 0.05 DPU / CommitLatency 2.87ms) では問題なし、成長時は実測で個別解禁
- 10 枠超過の 1-in-1-out は 2026-07 最終週の月 1 棚卸で消化する (ADR-0060〜0064 と同運用)
