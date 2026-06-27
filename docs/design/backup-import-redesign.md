# backup export / import 再設計（確定版）

> **位置づけ**: 本書は PO 決定済み（2026-06-27、§4 D1-D5）の確定設計。NUC→AWS 本番 import 事故（活動・履歴・ごほうび等が広範に欠落）の再発防止に向けた目標設計を定め、実装は #3324-3330 で段階実施する。前提となる現状監査は [research/2026-06-27-backup-import-coverage-audit.md](../research/2026-06-27-backup-import-coverage-audit.md)（#3332 merge 済）。
> **唯一の残課題（局所）**: 活動 101→0 の厳密な機序のみ、実装初手の本番相当データ再現テストで確定する（§3.0）。これは設計全体の非確定ではなく、P1 で再現により closure する単一の調査項目である。
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

### 3.0 前提: 活動喪失機序の確定（実装の最初の一歩）
活動 101→0 の機序（per-child flatten binding 喪失 / findFirstChild 依存 / dedup 縮約 のいずれか・複合）は**本番相当データの再現テストで確定**してから修正する。確定前に実装方針を断定しない（#3327 訂正済）。

### 3.1 source / 派生 / 除外 分類レジストリ
- `keys.ts` の family 実体に対し、分類を宣言するレジストリ（例 `backup-entity-registry.ts`）を新設。`{ entity, classification: 'source'|'derived'|'excluded', reason }`。
- 機械検証: `keys.ts` family 実体集合 ⊆ レジストリ。未分類で CI fail（#3329 / #3328 と連動）。
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

### 3.3 import
- per-child 実体を **正しい child へ復元**（childIdMap で元 child に対応付け。findFirstChild 一律 bind をやめる）。
- **未実装の取込を実装**（evaluations 等、網羅）。
- **依存順序**を保証（children → per-child 実体 → ログ/履歴系。lookup 依存は復元順で解決）。
- **失敗集計**: skip/warning を種別ごとに集計し、>0 なら結果に部分失敗を明示。UI で「N 件取り込めませんでした」を表示。
- **atomicity**: replace は **import-then-swap**（新 namespace/staging へ投入→検証成功後に切替、失敗は破棄）。clear 先行を廃止（#3326）。
- 復元後に**派生を再計算**（statuses 現在値/balance/streak 等の projection rebuild。source の statusHistory は再計算せず recordedAt 保持で復元）。

> **import-then-swap の DynamoDB 実装 caveat（安価な atomic swap 前提で着手しない）**: DynamoDB(SaaS) 側は単一テーブル設計で全実体の PK が `T#<tenantId>#…`（`keys.ts` `tenantPK`）であり、tenant の上に staging を切る namespace 間接層が無い。よって all-or-nothing の「namespace 切替」は実体間接ポインタの差し替えでは実現できず、staging tenant へ全 item を **copy → 検証 → 旧 item delete** する copy+delete 方式になる。さらに `TransactWriteItems` は 1 tx 100 item 上限のため、tenant 全データを単一 tx で swap することはできず、batch 投入 + 検証成功後に切替（旧データ delete / 新 tenantId へ alias）という粒度設計が必要になる（部分失敗時は staging を破棄）。NUC(SQLite) 側は単一ファイル / トランザクションで import-then-swap を素直に表現できるため、**SQLite(NUC) と DynamoDB(SaaS) で atomicity の実装方式が異なる**点を実装時に前提化する（#3326 実装で確定）。

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

## 5. 段階（phasing）

1. **P1（確定）**: 活動喪失機序を再現テストで確定（§3.0、#3327+#3328）。
2. **P2（基盤）**: 分類レジストリ + 機械検証（#3329/#3328）。export の source 全網羅 + per-child binding 保持。
3. **P3（import）**: per-child 正復元 + 未実装取込 + 失敗集計 + import-then-swap（#3327/#3326）。
4. **P4（派生）**: 復元時 projection rebuild。
5. **P5（UX/安全）**: 進捗フィードバック + クライアント timeout + 大容量対応（#3324/#3325）。
6. 各段階に round-trip 完全性テスト（#3328）。

> §4 の D1-D5 は PO 決定済み（2026-06-27）。本書を確定版として、P1（活動喪失機序の再現テストで確定）から着手する。source/派生/除外の三分類原則は ADR への昇格を別途検討する。
