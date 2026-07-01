# backup export / import 再設計（確定版）

> **位置づけ**: 本書は backup export / import の確定設計かつ**実装済みの正仕様**（PO 決定 2026-06-27、§4 D1-D5）。NUC→AWS 本番 import 事故（活動・履歴・ごほうび等が広範に欠落）の再発防止として、source 全実体の round-trip（#3329）と置換 import の原子化（#3326）まで実装済み。前提監査は [research/2026-06-27-backup-import-coverage-audit.md](../research/2026-06-27-backup-import-coverage-audit.md)。
> 関連: #3324 / #3325 / #3326 / #3327 / #3328 / #3329 / #3330

## 1. 設計背景（なぜ再設計が必要か）

現状の backup は **export / import の両側に網羅漏れ**があり、replace import で約半数の種別（活動・活動ログ・評価・ごほうびの大半）が失われた。さらに **(a) 失敗が warning に埋もれ「成功(200)」を返す集計不全**、**(b) 非ACID（clear→import の途中失敗で半端状態）**、**(c) per-child instance を export で master へ flatten して binding を失う構造**が重なる。これらを個別に直すと、別の漏れで再び手戻りする（実際に活動だけ追えば評価・交換履歴・設定で再発する）。よって **export 網羅・import 正復元・完全性テストを一体で再設計**する。

## 2. 設計原則

1. **source / 派生 / 除外 の三分類を SSOT 化**。各 family 実体を「source（保持必須）/ 派生（source から再計算で復元）/ 除外（廃止・未実装・再生成可）」のいずれかに**必ず宣言**し、新実体追加時に分類必須（silent 漏れ禁止）。
2. **source は完全網羅**。「`keys.ts` の family 実体 = source ∪ 派生 ∪ 除外」を**機械検証**（分類されない実体があれば CI fail）。
3. **all-or-nothing**。import は途中失敗で本番を半端状態にしない（import-then-swap、#3326）。
4. **per-child 忠実性**。per-child instance（活動等、ADR-0055）は per-child のまま round-trip し、master flatten で binding を失わない。
5. **失敗を可視化**。skip/warning を集計し、0 件でなければ**部分失敗を明示**（success(200) にしない）。
6. **派生は復元時に再計算**（projection rebuild）。backup は source + 設定 + 初期値（+ 任意で検証用 snapshot）に限定。
7. **failing-test-first**。各欠落は「赤で再現 → 修正で緑」（ADR-0061、#3328）。機序未確定の事項は再現で確定してから直す。

## 3. 仕様（目標設計）

### 3.0 活動喪失機序（確定済み）
活動 101→0 の機序は、replace import が children を作る前に活動を投入し、`childIdMap` 不在 / first-child 一律 bind で per-child binding を喪失していたことに起因する（#3327 で再現テストにより確定）。修正は §3.3「依存順序」（children 先行 → 元 child へ復元）で実装済み。`tests/unit/services/backup-roundtrip-completeness.test.ts` が回帰ネット。

### 3.1 source / 派生 / 除外 分類レジストリ
- SSOT = `src/lib/server/db/backup-entity-registry.ts`。各 family 実体を `{ classification: 'source'|'derived'|'excluded', reason, backupStatus?, schemaTable?, excludedKind? }` で宣言。
- 機械検証（`tests/unit/db/backup-entity-registry.test.ts`）: **schema.ts の全 sqliteTable ⊆ レジストリ**（key builder を持たない実テーブルも対象、silent-gap ガード）+ keys.ts 全 key builder ⊆ レジストリ。未分類で CI fail。
- **ratchet（#3329 完遂）**: 未 export の source 実体 = 0 件（`notYetExportedSourceEntities()` が空）。新たに not-yet-exported な source を足すと CI fail し、backup 取りこぼしを即検知する。deferred 除外は `characterImage` / `dailyMission` のみ。
- 分類（監査 §3 準拠。新実体追加時はレジストリで分類を必須宣言）:
  - **source**: children / activities(per-child) / activityLogs / **statusHistory** / pointLedger(交換・bonus・手動含む) / rewardRedemption / childChallenge / evaluations / checklist(template/item/assignment/log/override) / parentMessage / siblingCheer / certificate / stampCard 設定 / activityPref / settings(PIN 除く or 暗号化) / ルール設定(decay/スコア)
  - **派生**: statuses(現在値) / pointBalance / loginBonus streak / activityMastery / dailyBattle / enemyCollection
  - **除外**: childAchievements・childTitles（機能廃止 #322）/ childAvatarItems（未実装）/ characterImage（再生成可・非決定性 caveat は §4 D4 注記。PO 承知の上で除外）/ dailyMissions（Phase 2 繰延・現状空配列）

> **statusHistory を source に分類する根拠（#3332 監査と整合）**: 監査 §2 は statusHistory を「派生候補」と仮置きしつつ、§3 caveat 1/3 で「decay は経過時間依存・スコア式は temporal versioning が必要で現行ルール再計算では過去値が変わる」、§4 #6 で「recordedAt を import 時刻で上書きしない」と注記している。実コード検証（`status-service.ts` `updateStatus`/`insertStatusHistory`）では statusHistory は append-only の変更イベントログで、各行が `recordedAt`（実イベント時刻）+ `changeAmount` + `changeType` + 結果値を保持する。changeType には `activity` / `weekly_evaluation` のほか **`daily_decay`（時間駆動 cron、`evaluation-service.ts` L205）/ `admin_edit`（手動調整、`admin/children/+page.server.ts` L289）が含まれ、これらは対応する activityLog を持たない**ため、activityLogs からの再計算では原理的に再構成できない。よって過去推移は他 source から忠実再計算できず（監査の「派生候補」を closure し）、本書では **source（backup 必須、recordedAt 保持、再計算しない）** に確定する。一方 `statuses`（カテゴリ別の現在 XP / level / peak）は statusHistory を含む source から再構成可能な真の projection であり派生に残す。

### 3.2 export
- source 実体を全網羅（#3329）。per-child instance は **per-child 構造で出力**（master 名前 flatten をやめる、活動の binding 保持）。
- backup フォーマットを**自由に刷新してよい**（ユーザー未獲得のため**下位互換不要**、D5 決定）。旧 ZIP 互換読込は実装しない（version 判定の延命コードを持たない）。
- 派生・除外は出力しない（または検証用 snapshot として分離区画に。復元時は無視）。
- **PIN（おやカギ pin_hash）取扱**（監査 §3 セキュリティ caveat、CWE-522/916）: backup から除外し復元後に再設定、または別パスフレーズで暗号化。無防備同梱しない（PO 判断、§4）。

**実装（`src/lib/domain/export-format.ts` / `src/lib/server/services/export-service.ts`）**:
- フォーマット = `EXPORT_FORMAT='ganbari-quest-backup'` / `EXPORT_VERSION='1.6.0'`。下位互換読込は持たない（D5）。
- **settings は default-deny allowlist**（`EXPORTABLE_SETTING_KEYS` / `isExportableSettingKey`）。`pin_hash` / `pin_locked_until` / `pin_failed_attempts` / `pin_reset_applied` / `session_token` / `session_expires_at` を export からも import からも除外（CWE-522/916、import 側でも再 filter する多層防御）。
- per-child instance は **自然キー参照（ref）で出力**し、import で新 childId / 新 id に再解決する（§3.3）: `childRef`（child）/ `rewardRef`（ごほうび title）/ `activityName`（per-child 活動名）/ `templateExportId`（checklist template）/ `voiceRelPath`（音声ファイル相対パス、tenant prefix 除去済）/ `from`-`toChildRef`（兄弟応援）。
- 音声 / アバター等の静的ファイルは `backup-archive.ts` が ZIP に同梱（`MAX_ZIP_SIZE=100MB`、fail-closed）。DB 行は tenant prefix を除いた相対パスを持ち、import で新 tenant+childId に再構成する（#3077）。

### 3.3 import
- per-child 実体を **正しい child へ復元**（childIdMap で元 child に対応付け。findFirstChild 一律 bind をやめる）。
- **未実装の取込を実装**（evaluations 等、網羅）。
- **依存順序**を保証（children → per-child 実体 → ログ/履歴系。lookup 依存は復元順で解決）。
- **失敗集計**: skip/warning を種別ごとに集計し、>0 なら結果に部分失敗を明示。UI で「N 件取り込めませんでした」を表示。
- **atomicity（#3326 実装済）**: replace は **「途中失敗時に旧データを必ず復元可能」な原子境界**で clear + import を実行する。clear 先行の永久喪失を廃止。単一強制点は `src/lib/server/services/replace-import-service.ts` の `replaceImportAtomic`（全 replace 経路 = `/api/v1/import` / `/api/v1/import/cloud` が経由）。**success-on-partial-failure ban**: import 中に hard error（例外を伴う取込失敗、`ImportResult.errors > 0`）が 1 件でもあれば原子境界を中止し旧データを復元する（childRef 不在等の skip は `*Skipped` に積まれ中止対象外）。中止時は呼び出し側へ `AtomicReplaceError` を送出し、API は「既存データは保全されています」を返す。
- 復元後に**派生を再計算**（statuses 現在値/balance/streak 等の projection rebuild。source の statusHistory は再計算せず recordedAt 保持で復元）。

**実装（`src/lib/server/services/import-service.ts`）**:
- **`insertForRestore` パターン**: 通常 `insert` は `createdAt=now` を再発番し status/timestamp をリセットするため、各 repo（sqlite / dynamodb / demo の 3 実装 + interface）に `insertForRestore` を別途用意し、**createdAt・status・全フィールドを保全**して書き戻す（id のみ新規採番）。新 backup 実体を足す際は 3 実装すべてに `findAllByChild` + `insertForRestore` を実装する（落とすと round-trip 完全性テストが赤）。
- **依存順序**: children を先に作成して `childIdMap`（exportId→新 childId）を確定 → per-child 活動を**元の child へ**復元（master flatten の first-child 一律 bind を廃止、#3327）→ 活動 lookup（childId×name）を構築してからログ / pref / 交換履歴等を貼り直す。
- **clear-FK 連鎖**: `child_id` に `onDelete cascade` を持たない実体（`certificate` / `rewardRedemption`）は、`tenant-cleanup-service.ts` で **children 削除より先に `deleteByTenantId`** する（順序を誤ると children 削除が FK 違反で失敗し、replace で children ごと喪失する）。
- **DynamoDB の意図的 no-op**: `restDays`（おやすみ日）は DynamoDB に保存せず SQLite/NUC 専用のため、DynamoDB の `insertRestDayForRestore` は no-op（import 側で skip 計上）。

> **backend 別 atomicity 実装（#3326 で確定）**: SQLite と DynamoDB で「どの backend でも全 import を単一 tx で包めない」制約（SQLite=同期 tx が多数の `await insert` を跨げない / DynamoDB=`TransactWriteItems` 100 item 上限 / DSQL=1 write txn 最大 3,000 行）への対処が異なる。
> - **SQLite（NUC）**: 単一接続で `BEGIN IMMEDIATE` → 成功で `COMMIT` / 例外で `ROLLBACK`。clear も import も同一 tx に乗る（内部の `db.transaction()` は better-sqlite3 が SAVEPOINT にネスト）。
> - **DynamoDB（本番）**: 全実体の PK が `T#<tenantId>#…`（`keys.ts` `tenantPK`）で tenant の上に staging を切る namespace 間接層が無く、ポインタ差替えの O(1) swap は不可。よって **backup-before-clear（補償トランザクション）**: clear 前に旧データを `exportFamilyData` で snapshot 取得（取得失敗時は安全側に中止）→ clear + import を試行 → 失敗時は snapshot を storage（`tenants/<tenantId>/recovery/`）へ永続化したうえで旧データを復元。二次故障（復元自体の失敗）はオペレータが永続化済 snapshot から手動復旧する退路を残す。
> - **DSQL 移管時（#3424 / #3436）**: DSQL も単一 tx で家族 1 件を包めない（3,000 行上限、実機確定）ため、import 原子化は #3436「一括 import チャンク+saga」と共同設計に統合する（調整は #3436 で行う）。

### 3.4 完全性テスト（#3328）
- 全 source 実体の **round-trip**（rich fixture → export →(clear)→ import → 派生再計算 → **件数 + 代表内容一致**）を SQLite + DynamoDB / add + replace で。
- **活動 101→0 を赤で再現** → 修正で緑（failing-test-first）。
- 部分失敗（skip/warning>0）を success と扱わない assert。
- 「`keys.ts` family ⊆ 分類レジストリ」整合の機械検証。

## 4. PO 判断事項（**決定済み — 2026-06-27 PO**）

D1-D4 は補佐推奨どおり承認、D5 は「下位互換不要」で決定。

| # | 論点 | 決定 |
|---|---|---|
| D1 | **event-sourcing スコープ** | **(a) Lite**: 現在値は従来通り保持し、backup は source のみ・**復元時のみ**派生再計算。Full 化（status/balance を恒常 projection 化）は別 design issue で Pre-PMF 判断 |
| D2 | **replace モード** | **(a) 残す**（import-then-swap で安全化）。**clear 先行は廃止** |
| D3 | **PIN(おやカギ) の backup** | **(a) 除外し復元後に再設定**（4桁・低 entropy hash 同梱は CWE-522/916 リスクのため同梱しない）|
| D4 | **派生の明示除外** | characterImage=再生成 / pointBalance=台帳から再計算 / dailyMissions=Phase 2 繰延 を**意図的除外**として確定（除外理由を分類レジストリに明記）|
| D5 | **下位互換** | **不要**（ユーザー未獲得）。旧 ZIP 互換読込は実装しない。backup schema は自由に刷新してよい |

> **D4 characterImage 除外の非決定性 caveat（PO 承知の上で除外）**: characterImage の生成は Gemini で非決定的（`docs/reference/gemini_image_generation_guide.md` A-4「同一テーマでもセッションでスタイルが逸脱する」）であり、「再生成可＝除外」は **復元時に元画像は復元されず別画像が生成される**ことを意味する。子供が愛着を持つキャラ画像が backup/restore のたびに silent に変わるため、厳密な round-trip 同一性は得られない。本書は PO 承知の上で除外を確定する（バイト同一の復元を要する場合は将来 source 化 / 別パスフレーズ暗号化での同梱を別 issue で再判断する）。

## 5. 実装状況

| 段階 | 内容 | 状況 |
|---|---|---|
| P1 | 活動喪失機序の確定（§3.0、#3327/#3328） | 実装済み |
| P2 | 分類レジストリ + 機械検証 + export source 全網羅 + per-child binding 保持（#3329） | 実装済み（ratchet 空） |
| P3 | per-child 正復元 + 未実装取込 + 失敗集計 + import 原子化（#3327/#3326） | 実装済み |
| P4 | 復元時 projection rebuild | 実装済み |
| P5 | UX/安全: 進捗フィードバック + クライアント timeout + 大容量・スケール対応（#3324/#3325） | 未実装（20 年×子供数 scale = 全メモリ export / 逐次 import / 100MB ZIP 上限の見直し） |

各段階に round-trip 完全性テスト（`backup-roundtrip-completeness.test.ts`、#3328）。source/派生/除外の三分類原則の ADR 昇格は未判断。
