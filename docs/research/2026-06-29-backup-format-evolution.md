# backup 形式進化戦略 — 一次資料比較と責務整理 (2026-06-29)

> backup export/import 形式の進化方式（A: 抽象 DTO + tolerant reader / B: version-keyed migration seam /
> C: 確立解）の比較と、このプロダクトでの推奨・責務整理。設計結論の SSOT は
> [docs/design/backup-import-redesign.md §6](../design/backup-import-redesign.md)。本書は根拠（一次資料）を保存する research 層。

## 問い

backup 形式に破壊的変更（フィールド rename / 分割 / 意味変更）が来たとき、誰がそれを安全に吸収するか。
tolerant reader 単独（A）で十分か、明示的 migration seam（B）が要るか、確立解（C）に寄せるべきか。

## 実装事実（前提）

- backup は raw DB 行でなく **抽象 DTO**（`Export*` 型が自然キー `childRef` / `categoryCode` / `rewardRef` / `activityName` を持つ）。export = id→自然キー、import = 自然キー→新 id 再解決 + field-by-field マッピング。
- `version` フィールド（`EXPORT_VERSION='1.6.0'`）。これまでの bump は全て「追加のみ optional」。
- `validateExportData` が allowlist で受理、`verifyChecksum` で整合検証。Pre-PMF・ユーザー未獲得。

## A/B/C 比較（5 軸 × 一次資料）

| 軸 | A: 抽象 DTO + tolerant reader | B: version-keyed seam (eager once) | C: 確立解 (Protobuf/Avro 規律 + ES copy-transform) |
|---|---|---|---|
| 管理負担 | 最小。だが additive-only 不変条件が**暗黙**で人の注意のみが守る | 低〜中。seam + 連鎖宣言 | 規律は near-zero cost。完全 registry 前倒しは YAGNI |
| 責務の明瞭さ | 低い。tolerant reader は「additive のみ」が範囲（Fowler 明言） | 本来最高（脱直列化と業務ロジック間の単一翻訳層 = ACL/upcaster）。ただし allowlist 二重所有で逆に不明瞭 | 明確（安定 identity を再利用しない強制） |
| 破壊的変更の安全性 | **致命的に弱い**。rename/split を「欠損→default」と区別できず silent data loss | **強い**。破壊的変換に単一の置き場 + 未定義経路 throw（fail-loud） | 最強（`reserved` で番号/名の再利用をコンパイラ強制） |
| Pre-PMF 適合 (ADR-0010) | 最軽だが機械強制なし（ADR-0061 思想に反する） | seam の「場所」は cheap seam（Feathers）。identity registry 前倒しは過剰 | 規律（reserved + optional default）は near-zero cost で今やる |
| DSQL 相性 | DTO 抽象が sqlite→pg 型差を既に吸収 | seam は #3433 型差が初の破壊的変更になった時の置き場 | copy-transform（eager once）が bounded データの正解 |

## 決定的知見: backup は lazy upcasting でなく copy-transform (eager once)

event-sourcing 一次資料が B の方向を裏付ける:

- lazy upcasting（毎読込で変換する read-path middleware）は**継続的に読まれる無限 append-only store** 用。Marten 公式が「Upcasting code is run each time the event is deserialized … N+1 problem」と警告。
- **bounded・1 回読みのデータ**には Greg Young の **Copy-Transform**（version→version を import 時に 1 回だけ eager 変換）が正解。

→ 本プロダクトの `migrateExportData` は import 入口で 1 回 eager 実行であり、まさに copy-transform 型。lazy-on-read の N+1 の罠には陥っていない。**B の設計方向は正しい。**

## 推奨: B の「場所」+ C の規律、ただし責務を統合（3→1）

「分かりにくさ」の正体は seam の存在でなく **二重所有**: 旧 `supportedVersions` allowlist を残したまま seam を足したため、「旧版を読む」責務が 3 重・版一覧が 2 本になっていた。**seam を消すと A に戻り silent loss（後退）。正解は allowlist を seam 配下に統合**して seam を唯一所有者にすること（責務 3→1 に**減って**明瞭化）。

今やる（near-zero cost、ADR-0010 Bucket A）:
1. seam キープ（import 入口の単一正規化点 = cheap seam）
2. `supportedVersions` を `MIGRATABLE_VERSIONS` から導出（版一覧 SSOT 1 本化）
3. bump tripwire（EXPORT_VERSION bump で STEP 未登録なら test fail）
4. `RESERVED_EXPORT_KEYS` + 交差ガード（キー名 = 不変 identity、Protobuf reserved の安価版）+ 旧版 golden round-trip テスト

defer（やれない/speculative）: 実 transform 関数は最初の破壊的変更（DSQL #3433 の型表現変更が初回トリガ候補）と同 PR で実装。原則「値表現の差 = L3 DTO 抽象で吸収 / shape 変更 = L2 transform」。

## 責務再整理（単一責務割当）

L1 整合性 = checksum（migrate 前）→ L2 版識別 + 旧 shape 読取 = export-migrations 単独（version SSOT）→ L3 DTO 抽象 = export-format 自然キー（DSQL 型差吸収）→ L4 ref→id 再解決 = import childIdMap。詳細表は backup-import-redesign.md §6。

## 「seam は責務を増やして分かりにくくしていないか」への回答

**条件付き NO**。seam の設計方向は文献的に正当（ACL/upcaster/copy-transform）。破壊的変更の置き場が無い A 案こそ「責務の穴」。分かりにくさの原因は seam でなく統合し損ね（二重所有）。allowlist を seam 配下に統合すれば責務は 3→1 に減る。

## 一次資料

- Postel 原典: RFC 761 §2.10 / RFC 1122 §1.2.2。批判: Thomson `draft-iab-protocol-maintenance-05`（「conceals problems」）/ Allman, ACM Queue 2011。
- tolerant reader の範囲限定: Fowler `TolerantReader`（"allow the provider to make any change that ought not to break your code"）。
- 構造的 rename 防止: protobuf.dev proto3（reserved / field number）/ Avro 1.11 Schema Resolution + Aliases / Confluent compatibility types。
- upcasting / copy-transform: Axon Event Versioning / Greg Young `esversioning` / Marten Versioning（N+1 警告）/ Oskar Dudycz `how_to_do_event_versioning` / Kurrent event immutability。
- 単一翻訳層: Fowler `ParallelChange` / MongoDB Schema Versioning（lazy vs eager）/ MS Learn ACL。
- 既存ツール: SQLite As Application File Format（additive 互換）/ pg_dump（未知の新版は refuse）。
- Pre-PMF 判断: Fowler `Yagni` / refactoring.guru `Speculative Generality` / Feathers seam。

> 注: Allman ACM Queue の逐語は取得時 403。論旨は複数ソースで一致するが逐語確定は fulltext 照合が要。
