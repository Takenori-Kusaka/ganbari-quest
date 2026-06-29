# バックアップ export/import チーム → DSQL 移管チーム 申し送り (2026-06-29)

> 目的: EPIC #3424（DynamoDB → Aurora DSQL 移管）チームへ、バックアップ export/import 領域
> （#3329 完遂 + #3326 import-then-swap 原子化 実装済）から見た**衝突点・協調点・共同設計すべき箇所**を申し送る。
> 本書は cross-team coordination note（research 層）。確定仕様は各設計書 / ADR / Issue を SSOT とする。

---

## 0. 1 行サマリ

**「replace import の原子化（#3326）」と「DSQL 一括 import チャンク+saga 設計（#3436）」は同一問題である。** DSQL の
`1 write txn = 最大 3,000 行 / 10 MiB / 5 分`（実機確定、research §11.1 / line 169 `3,001 行 → [54000] transaction row limit exceeded`）
により、家族 1 件分（20 年 × 子供数）の置換 import を**単一トランザクションで all-or-nothing にすることは DSQL でも不可能**。
→ #3326 と #3436 を**別々に設計すると二重実装 + 不整合**になる。**1 つの設計に統合すべき。**

---

## 1. バックアップ側の現状（移管時に保持してほしい不変条件）

### 1.1 完了済み（#3329 EPIC、ratchet 空）

- 全 source 実体（活動 / 評価 / ごほうび交換履歴 / settings / チャレンジ / スタンプ / 証書 / 親子メッセージ /
  兄弟応援 / 活動 pref / チェックリスト override / 休息日 / カスタム音声 …）が export→import で round-trip する。
- SSOT = `src/lib/server/db/backup-entity-registry.ts`。schema.ts 全テーブルが
  source / derived / excluded に分類済。`tests/unit/db/backup-entity-registry.test.ts` が
  **「schema.ts のテーブル ⊆ registry」を機械検証**（silent-gap ガード）+ 未 export source = 0 件 ratchet。
- **DSQL repo を追加する際の必須事項**: 新 repo 実装でも `findAllByChild` / `insertForRestore` の
  2 メソッドを各 repo に維持すること。これを落とすと round-trip テストが落ちる（= バックアップ取りこぼし再発）。

### 1.2 `insertForRestore` パターン（DSQL repo でも踏襲必須）

通常 `insert` は `createdAt = now` を再発番し status / timestamp をリセットする。バックアップ復元では
**作成日時・状態・全フィールドを保全**する必要があるため、各 repo に `insertForRestore` を別途用意している。
DSQL（Postgres）実装でも同じ契約（id は新規採番、その他は書き戻し）を維持すること。
interface は `src/lib/server/db/interfaces/*-repo.interface.ts`。

### 1.3 childId / 相互参照の再解決

import は新 tenant で childId が変わるため、`childRef → childId`（childIdMap）で全 per-child 行を貼り直す。
さらに cross-reference（rewardRef=ごほうび title / activityName / templateExportId / voiceRelPath /
from-toChildRef）も title/名前ベースで再解決している。DSQL でも**自然キー（PK）に依存した再解決**になる点は不変。

### 1.4 セキュリティ不変条件（移管で絶対に緩めない）

- settings export は **default-deny allowlist**（`EXPORTABLE_SETTING_KEYS` / `isExportableSettingKey`、
  `src/lib/domain/export-format.ts`）。`pin_hash`（おやカギコード bcrypt）/ `session_token` /
  lockout 状態を **export からも import からも除外**（CWE-522 平文資格情報 / CWE-916）。import 時も再フィルタ（多層防御）。
- tenant 分離は ADR-0063（pool + 信頼 tenantId + アプリ層単一強制点 + fitness function）。
  バックアップ import は**必ず ctx の tenantId に対してのみ**書く。DSQL 移管後も
  `WHERE tenant_id = :ctx` 単一強制点を import 経路でも通すこと（生クエリ直書き禁止）。

---

## 2. トランザクション処理 — 見直し中の核心（#3326 ⇄ #3436 共同設計）

### 2.1 現状（DynamoDB、非原子＝事故の原因）

`src/routes/api/v1/import/+server.ts:94-106` replace mode:

```
clearAllFamilyData(tenantId)        // 全削除（data-service.ts / tenant-cleanup-service.ts）
  → importFamilyData(...)           // 54 個の for...of + await insert（バッチなし・トランザクションなし）
```

途中 hang / 失敗で「消した後・入れ途中」で停止 = データ消失。本番 tenant t-82c17558 の事故そのもの。

### 2.2 backend 別の原子化制約（重要）

| backend | 単一 txn で clear+import 全体を包めるか | 理由 |
|---|---|---|
| SQLite (NUC) | △ 可能性あり | better-sqlite3 は**同期** txn。多数の `await insert` を跨ぐ現構造とは非整合 → 構造変更が要る |
| DynamoDB (現本番) | ✕ | TransactWriteItems 100 item 上限。数千行を 1 tx 不可 |
| **DSQL (移管先)** | **✕（実機確定）** | **1 write txn = 最大 3,000 行 / 10 MiB / 5 分**（research line 169-172）。家族 1 件で容易に超過 |

→ **どの backend でも「全 import を 1 txn」は不可。** したがって import-then-swap は
（a）staging へ全 import → 成功後にアクティブ切替（pointer swap） か
（b）clear 前スナップショット退避 → 失敗時に補償ロールバック（saga）
のいずれか。これは #3436 の「(1) チャンク分割 + 冪等 upsert / (2) import バッチ ID + 進捗マーカ /
(3) saga（"import 中"フラグ → 全 chunk 成功後 commit フラグ）」と**完全に同じ問題空間**。

### 2.3 DSQL ならではの追い風 / 制約

- **追い風**: DSQL は PostgreSQL 互換の ACID txn を持つ（OCC, SQLSTATE 40001 retry）。
  → import を**3,000 行未満のチャンク単位では真の all-or-nothing**にできる（DynamoDB の 100 item より緩い）。
  チャンク境界の整合は saga / batch-id マーカで担保する設計に集約できる。
- **制約**: 単一 txn 全体は不可（前述）。OCC リトライラッパ必須（#3435）。
  DDL と DML を同一 txn 不可 / 1 txn 1 DDL（line 170-171）。
- **FK の扱い（要確認・協調）**: 現 SQLite/DynamoDB は `onDelete cascade` を持たず、clear 順序を
  `tenant-cleanup-service.ts` で手動管理している（certificate / rewardRedemption の child_id FK 連鎖で
  過去に children 削除が FK 違反で失敗 → import でデータ消失したクラスのバグを個別修正済）。
  **DSQL が FK 制約を本物の DB 制約として張れるなら（research に "FK拒否" 契約テスト言及 line 100/168）、
  `ON DELETE CASCADE` 宣言で clear 順序の手動管理が不要になる可能性**がある。
  DSQL の FK サポート範囲は #3433（sqlite→pg 型/制約差分）/ #3427（DDL 制約適合）で確定後、
  `tenant-cleanup-service` の手動順序ロジックを簡約できるか判断してほしい。

### 2.4 申し送りの肝（お願い）

1. **#3326（import 原子化）と #3436（DSQL 一括 import チャンク+saga）を 1 つの設計にマージ**してほしい。
   バックアップ側は本番事故を今塞ぐため #3326 を **SQLite=BEGIN/ROLLBACK + DynamoDB=backup-before-clear で実装済**
   （単一強制点 = `src/lib/server/services/replace-import-service.ts` の `replaceImportAtomic`）。
   **DynamoDB 向け backup-before-clear は DSQL 移管完了で破棄される前提**であり、DSQL の import 原子化は
   #3436 の chunk+saga に合流して一度だけ設計してほしい（DynamoDB 実装をそのまま移植しない）。
   なお `replaceImportAtomic` は backend 別 strategy 切替（`DATA_SOURCE` dispatch）なので、DSQL strategy を
   1 本足すだけで合流できる構造にしてある。
2. import の**バッチ化**（現状 54 個の per-row await insert）は DSQL では DPU 課金・OCC・3,000 行上限の
   いずれの観点でも必須（research §1「N+1 → batch 化せよ」）。#3436 のチャンク設計とバックアップ import を
   同じバッチ機構に乗せること。
3. **clearAllFamilyData の呼び出し元は import 以外にもある**（`/api/v1/data/clear`,
   `/admin/settings/data`, `/api/v1/import/cloud`）。原子化機構を data-service 層に作ると全経路で効く。

---

## 3. スケール（20 年 × 子供数）— DSQL 移管と独立だが影響あり

バックアップ側で別途見直し予定（推奨順 #3）。DSQL チームの設計判断に絡む点のみ抜粋:

- export が**全行メモリロード + payload 全体を 2 回 `JSON.stringify`**（checksum 用 + 本体、
  `export-service.ts:186` 近辺）→ 大規模家族でメモリ膨張。`MAX_EXPORT_ROWS=999999` / ZIP 上限 100MB
  （`backup-archive.ts`、fail-closed）。
- DSQL の **read DPU は バイト数課金**（research §1）。全行 SELECT を素朴に回すと大規模時に課金/レイテンシ増。
  export の paged/stream 化は #3437（AWS Backup PITR とアプリ層 backup の役割分担）と整合させたい。
  例えば「DR/全体復旧は AWS Backup PITR、ユーザー操作の家族単位 export/import はアプリ層」のように
  役割を割れば、アプリ層 export が背負うデータ量を抑えられる。

---

## 4. 関連 Issue / PR インデックス

### バックアップ側（自チーム）
- #3329 EPIC（backup export/import 完全 round-trip、完遂）。registry #3362。
- #3326 **import-then-swap 原子化**（SQLite=BEGIN/ROLLBACK + DynamoDB=backup-before-clear で実装済。単一強制点 `replace-import-service.ts`）。
- 個別実体 PR: #3373 / #3378 / #3385 / #3391 / #3398 / #3409 / #3418 / #3448 / #3470 / #3481 / #3486（全マージ済）。
- 設計書 SSOT: `docs/design/backup-import-redesign.md`（§3.3 import / D2 に import-then-swap 記述。
  ※ 12 実体ロールアウトに対し stale、同期は推奨順 #2 で実施予定）。

### DSQL 側（移管チーム、交点）
- #3424 EPIC（DynamoDB → DSQL 移管）。ADR-0063（tenant 分離）= #3434。
- **#3436 一括 import チャンク+saga 設計** ← #3326 と統合候補（最重要交点）。
- **#3437 DSQL backup(AWS Backup PITR) とアプリ層 backup-archive の役割分担** ← §3 と直結。
- #3428 PoC 一括 import 3,000 行 / 10MiB 抵触実測 / #3435 OCC retry ラッパ /
  #3433 sqlite→pg 型・制約差分（FK 含む）/ #3427 DDL 制約適合 / #3438 db/dynamodb 撤去計画。
- 実機制約の SSOT: `docs/research/2026-06-28-aurora-dsql-adoption.md` §5（OCC）/ §11（実機 PoC 結果）。

---

## 5. 結論（DSQL チームへの依頼 3 点）

1. **#3326 と #3436 を共同設計に統合**（import 原子化 = chunk+saga、backend 横断の単一機構）。
   DynamoDB 向け実装は DSQL 移管で破棄される前提。DSQL strategy を `replaceImportAtomic` に 1 本足す形で合流できる。
2. **DSQL repo 追加時に `findAllByChild` / `insertForRestore` 契約と backup-entity-registry を維持**
   （落とすと round-trip テストが落ちて検知できる仕組みにはなっている）。
3. **FK を DB 制約で張れるなら clear 順序の手動管理（tenant-cleanup-service）を簡約できるか判断**し、
   できる場合はバックアップ側にも共有してほしい（#3433/#3427 確定後）。
