# 0064. NUC 新 model repo 構築方式 — PGlite 一次採用 (dialect 税ゼロ) + raw SQLite fallback

| 項目 | 内容 |
|------|------|
| ステータス | accepted (2026-07-09 PO 承認: NUC 基盤 PGlite 化をロールバック可能前提で許可) |
| 日付 | 2026-07-09 |
| 起票者 | Dev (Claude) |
| 関連 Issue | EPIC #3620 (AC1) / 親 #3424 / #3531 (PGlite 採用) |

## コンテキスト

DSQL 移行 M4 (#3614) は **クラウド = Postgres(DSQL) 側のみ**を実装し、NUC(local) の新 clean model は未着手。M4 は「同一 repo を 2 方言で再利用」する当初設計 (dsql-data-model §9 / m4-plan §143) を採らず **raw pg SQL** を採用したため、`src/lib/server/db/dsql/*` の repo 33 本は pg 固有機能に依存する:

- STORED 生成列 (`generatedAlwaysAs` の `CASE WHEN`) × 3 = **条件付き一意の DB 強制** (§6.6 `owner_guard` owner≤1 / `email_lower` / `weekly_auto_guard` auto:weekly 行のみ一意)。DSQL は部分 index 非対応のためこの生成列パターンが唯一の代替
- `SELECT … FOR UPDATE` = write-skew 防止 (非負残高 point-repo / owner 移譲 auth-repo / daily-mission / activity-pin)。read 値を条件に別行を書く不変条件を write-intent 化
- `gen_random_uuid()` / `::timestamptz` / pg 版 `ON CONFLICT`(53) / `RETURNING`(90) / `jsonb`

これらは SQLite で動かず「同一 repo 再利用」が不成立。`src/lib/server/db/sqlite/*` は旧実装 (counter.ts / padId / hydrate) のまま。新 model の sqlite repos をどう構築するかが本 ADR の判断対象 (実装は AC2-AC6 の sub で別途)。既存 factory は `DbBackend = 'sqlite'|'dsql'|...` の 1-interface / backend 別 impl 構造 (`db/backend.ts`)。

## 検討した選択肢 (8 軸 deep research サマリ、詳細は EPIC #3620 コメント)

### 案 A: sqlite-core 用の別 raw SQL repo 群 (dsql/ と対の sqlite2/)
- pg raw SQL を SQLite 方言に手書き翻訳: 生成列→app 側計算 + trigger/部分 UNIQUE、`FOR UPDATE`→`BEGIN IMMEDIATE` (SQLite は txn 開始で DB 全体 lock ゆえ本来不要)、`gen_random_uuid`→`$defaultFn(randomUUID)`、`RETURNING` は SQLite 3.35+ で可、`::timestamptz`→text ISO
- **独自実装量**: repo 33 本 × 2 (最大)。恒久 dialect-parity 税を fitness で機械強制
- **pg 固有並行制御の担保**: SQLite 単一 writer + `BEGIN IMMEDIATE` で write-skew 消滅 (parity は保てるが機構は別物 = 二重検証必要)
- **NUC 基盤リスク**: なし (better-sqlite3 WAL/docker 現状維持)。OSS = drizzle sqlite-core (公式サポート)

### 案 B: drizzle query-builder で dialect 非依存 repo に書き直し (hybrid)
- **致命的問題**: drizzle は `pgTable`/`sqliteTable` を意図的に分離、runtime dialect swap 不可 (公式 Discussion #5269/#3396)。共有は「app 側 interface 層」で行う設計 = 既存 factory と同じ。builder 化しても §6.6 の pg 固有不変条件 (`FOR UPDATE` は sqlite-core に存在せず / 生成列式・条件付き一意は方言差) は **backend 別 raw に退避必須** = hard 20% は結局 2 本
- さらに **既に shipping 済・test 済の raw pg repo 33 本を builder へ全面書き直す回帰リスク** をクラウド完成側に負う (「動くものを触る」)。80% を builder 化しても 20% の split は残り、書き直し税が上乗せ = 最悪

### 案 C: NUC を PGlite (@electric-sql/pglite、組込 Postgres WASM) で動かし pg repos を完全再利用
- **決定的事実**: pg repos 33 本は **既に PGlite 上で全 unit test が通っている** (`tests/unit/db/dsql-*.test.ts`、#3531 で採用済 dev dep `^0.5.4`)。repo コメントが PGlite 挙動 (FOR UPDATE / boolean / bigint / TZ) を明示的に前提化済 = **dialect 税ゼロ・書き直しゼロ**
- **並行制御**: PGlite は実 pg の locking を持つ (`FOR UPDATE` 本物)。DSQL の OCC 40001 は再現しないが (research §D)、NUC = 単一世帯・単一 writer envelope では locking の方が強い (write-skew 原理的に不在)。`withOccRetry` は no-op (案 A の `BEGIN IMMEDIATE` と同格)
- **懸念 (一次ソース)**: PGlite は single-user mode = 単一接続 (v0.4 で multiplexing 追加も単一 WASM プロセス)。公式 positioning は **embedded / local-first / dev tool** で「複数同時ユーザーには不適」と明記。永続化は Node FS VFS (query 毎 flush)。長期本番サーバの durability/backup は better-sqlite3 ほど battle-tested でない。TZ はローカル継承 (DSQL は UTC 固定 P10) → `PGTZ=UTC` 明示が必要

## 決定

**案 C (PGlite for NUC) を採択する (2026-07-09 PO 承認)。案 B は却下、案 A は fallback として温存。**

PO 判断 (2026-07-09): 「PGlite にしたいのは SQLite がクエリ複雑度に耐えられないからか?」への回答は **No — SQLite は複雑クエリ対応可 (部分 index 等 DSQL に無い機能すら持つ)。案 C の理由は複雑度でなく、pg repos の verbatim 再利用による二重実装税ゼロ化とクラウド挙動 parity**。「どちらにせよ (旧→新 schema の) マイグレーションは不可避」を確認のうえ、**ロールバック可能を前提に PGlite 化を許可**。

決定的根拠: (1) 案 C は pg repos を verbatim 再利用し、**恒久 dialect-parity 税を唯一ゼロにする**。(2) 再利用可能性は「33 repos が PGlite で test green」の実測で裏付け済。(3) NUC の単一世帯・単一 writer envelope は PGlite single-connection 制約と一致。(4) 案 B は shipping 済 pg repo の全面書き直し回帰 + hard 20% split 残存で最悪。

## 結果 (トレードオフ)

- **案 C 採択時**: repo 実装 = 追加ゼロ (schema は pg-core 1 本を NUC でも使用)。撤去対象 = 旧 sqlite/* + counter.ts + padId + hydrate。§12.2 backup round-trip は id 非保全・自然キー再解決ゆえ backend 差に非依存で整合。代償 = NUC 実行基盤を better-sqlite3→PGlite に変更 (WAL/docker/backup 再設計)、PGlite durability の本番検証、`PGTZ=UTC` 固定
- **案 A fallback 時**: NUC 基盤不変で安全だが repo 33×2 の恒久税 + parity fitness を CI に常設
- dialect-parity fitness (AC2) は **案 C なら不要** (schema 1 本)、案 A なら必須 — 方式決定が後続 AC の工数を大きく分岐させる

## ロールバック保証 (PO 承認の前提条件、§12.2 整合)

案 C 採択の前提 = **ロールバック可能**。cutover は非破壊 import-then-swap で担保する:
1. 旧 NUC DB (better-sqlite3) は **読み取りのみ**でエクスポート (非破壊)、新 PGlite DB は別途構築
2. **検証 OK まで旧 DB のまま稼働**、round-trip completeness `errors > 0` で swap 中止 → 旧 DB に戻す
3. 切替後も**旧 DB を物理保持**。PGlite 実行基盤に問題が出れば env/runtime を旧 sqlite に戻すだけで復帰
4. 残注意: 切替後の新 DB 書込は旧 DB 復帰で検証窓分を失う (単一世帯 NUC の短い検証窓で許容)

## 実装時の検証 gate (AC 消化中に確認、不合格なら案 A へ)

案 C の残懸念は実装 sub で検証する (不合格時は案 A fallback が生きている):
- (a) PGlite の Node FS VFS crash-safe durability + backup 手順、(b) 単一世帯負荷の常駐メモリ/性能 (vs better-sqlite3)、(c) `PGTZ=UTC` 固定 (DSQL は UTC 固定 P10、PGlite はローカル TZ 継承)。実際の NUC 本番 cutover はバックアップ取得を作業直前に行う最終ゲート付き
