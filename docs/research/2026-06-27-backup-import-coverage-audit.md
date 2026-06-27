# backup export / import 網羅性 監査 — 全 family 実体マトリクス (2026-06-27)

> 本書は #3329 / #3327 / #3328 の **設計の土台**。NUC→AWS 本番 import 事故（活動・履歴・ごほうび等が広範に欠落）を契機に、「アプリが保存する全 family 実体」を SSOT に、**export（backup に入るか）× import（復元されるか）** を全数監査した結果を記録する。実装着手前に、どの実体を **source（保持必須）/ 派生（再計算で復元）** とするかを確定するための基礎資料。

- 関連: #3324（timeout/UX）/ #3325（payload）/ #3326（非ACID）/ #3327（import 欠落）/ #3328（テスト完全性）/ #3329（export 網羅漏れ）/ #3330（ログイン構造）
- 証跡: 本番 table `ganbari-quest`（read-only scan）/ `export-service.ts collectForChild` / `import-service.ts importFamilyData` / `keys.ts` 全 key builder

## 1. 事故サマリ（実証）

`kokorokagami+test1@gmail.com`（tenant t-82c17558）が NUC backup(26KB) を replace import → 子・ポイント・履歴は復元されたが、活動101→0 / 活動ログ362→0 / 評価22→0 / ごほうび9→1 と**約半数の種別が欠落**。Lambda は error 無しで 28.86s 完了（warnings に埋もれ「成功」扱い）。根本は (a) import の網羅漏れ（evaluations は import 関数自体が存在しない / specialRewards は部分失敗、#3327）+ (b) export の網羅漏れ（#3329）+ (c) 非ACID（#3326）+ (d) 失敗が warning に埋もれ「成功」扱いになる集計不全。

> **訂正（実コード検証済み、#3332）**: 当初記載した「import 順序バグ（活動→子で子未存在 throw 握り潰し）」は実装と一致しない。`import-service.ts importFamilyData`（L233-245）の実順序は `importActivityMaster`（活動 = tenant master、L233）→ `importChildrenData`（子、L235、空なら abort）→ `importStatusesData`（L242）→ `importActivityLogsData`（L243）… であり、子は活動より**後ではなく先に依存解決される**。活動は子を参照しない tenant master として子より前に import されるため「子未存在 throw」の順序バグは存在しない。活動 101→0 の真因は順序ではなく、(i) 活動が per-child instance（ADR-0055）であるのに export では `master.activities` に**名前で flatten・dedup**され（`export-service.ts` L103-114）、import 側 `importActivityMaster`（L287-338）が `insertActivity` を **childId 無し（tenant スコープ）** で呼ぶため per-child binding が失われる構造、(ii) activityLogs が `buildActivityLookup`（L342-346）の活動名→活動 lookup に依存し、活動の復元が崩れると連鎖 skip する構造、にある（厳密な 101→0 の機序は本 2 service だけでは確定できないため別途 incident 再現で要確定）。

## 2. 全 family 実体 × export × import マトリクス

凡例: ✓=対応 / ✗=未対応 / △=部分・要確認 / 廃止=機能廃止済でデータ自体が存在しない（バックアップ対象外）/ 繰延=将来対応予定（未実装、空配列を意図的に出力）

| 実体 (keys.ts) | ユーザー概念 | export | import | 判定・備考 |
|---|---|---|---|---|
| children | 子供 | ✓ | ✓ | OK |
| activities (CHILDACT) | 活動 | ✓ | △ | export は `master.activities` に**名前で flatten・dedup**（`export-service.ts` L103-114、per-child binding 喪失）。import は `importActivityMaster`（L287-338）で childId 無し insert。順序バグではない（§1 訂正参照）。per-child instance ⇄ master flatten の構造ギャップが真因 |
| activityLogs | 活動記録 | ✓ | △ | `buildActivityLookup`（L342-346）の活動名 lookup 依存。活動復元が崩れると連鎖 skip（#3327） |
| pointLedger | ポイント台帳 | ✓ | ✓ | OK（交換/spend 含むか要確認）|
| statuses | ステータス | ✓ | ✓ | OK（**派生候補**）|
| statusHistory | ステータス履歴 | ✓ | △ | 件数OKだが recordedAt が import 時刻に書換の疑い（**派生候補**）|
| loginBonuses | ログインボーナス | ✓ | ✓ | OK（構造見直し #3330 / streak は**派生候補**）|
| evaluations | 評価 | ✓ | **✗** | **import 関数が存在しない**（`import-service.ts` に evaluations import 経路なし、#3327）|
| specialRewards | 特別ごほうび | ✓ | △ | 9→1 部分失敗（`importSpecialRewards` L836-、name/preset dedup でスキップ #3327）|
| checklistTemplates | チェックリスト | ✓ | ✓ | OK |
| checklistLogs | チェックリスト記録 | ✓ | ✓ | OK |
| checklistAssignment | チェックリスト配信先 | **✗** | △ | export schema に経路無し（#3329）。ただし import 時 `importOneChecklistTemplate` が `assignTemplateToChildren(newTpl.id, [childId])`（`import-service.ts` L665）で**取込先 child へ自動付与（再導出）**するため、取込先 1 child 分の assignment は復元される。原本の配信先 fan-out（どの child に配信済みか）は保持されない。key builder は実装済（`checklistAssignmentKey` `keys.ts` L575）|
| checklistOverride | チェックリスト日次 override | **✗** | **✗** | key builder 実装済（`checklistOverrideKey` `keys.ts` L633）だが export-service / import-service いずれにも経路が無い（#3329）。per-child の日次 override 設定が backup で失われる |
| childAchievements | 実績(子) | **廃止** | **廃止** | **実績システム廃止済（#322）**。export は空配列を意図的に出力（`export-service.ts` L432 `childAchievements: [], // 実績システム廃止（#322）`）。データ自体が存在せずバックアップ対象外 — import 欠落（#3327）の対象ではない |
| childTitles | 称号(子) | **廃止** | **廃止** | **称号システム廃止済（#322）**。export は空配列を意図的に出力（`export-service.ts` L433 `childTitles: [], // 称号システム廃止（#322）`）。データ自体が存在せずバックアップ対象外 — import 欠落（#3327）の対象ではない |
| childAvatarItems | アバター所持 | **未実装** | **未実装** | **実体未実装**: `keys.ts` に key builder も ENTITY_NAMES 登録も無く、データ自体が存在しない。export は空配列（`export-service.ts` L439 `childAvatarItems: []`）。dailyMissions（実装済・export 未対応）とは状態が異なる。実体導入時に export/import 整備が必要 |
| dailyMissions | デイリーミッション | **繰延** | **繰延** | **機能は実装済（export 未対応）**: `keys.ts` に key builder（`dailyMissionKey` L656-676）+ 専用 `daily-mission-service.ts` があり production data を持つ。export が空配列なのは Phase 2 繰延（`export-service.ts` L440 `dailyMissions: [], // Phase 2: エフェメラルデータ対応後に対応`）であって機能未実装ではない（childAvatarItems と区別）。**派生/期限切れ候補** |
| **rewardRedemption** | **ごほうび交換/購入履歴** | **✗** | **✗** | **export 自体に無い（#3329）。残高に必須（source）** |
| **childChallenge** (+auto-weekly) | **チャレンジ/達成履歴** | **✗** | **✗** | **export 自体に無い（#3329）** |
| **stampCard / stampEntry** | スタンプカード | **✗** | **✗** | export 自体に無い（#3329） |
| **dailyBattle / enemyCollection** | バトル / 敵図鑑 | **✗** | **✗** | export 自体に無い（**派生候補**: 活動結果から）|
| **certificate** | 証明書/賞状 | **✗** | **✗** | export 自体に無い（#3329） |
| **parentMessage / siblingCheer** | 親メッセージ/兄弟応援 | **✗** | **✗** | export 自体に無い（#3329） |
| **activityPref / activityMastery** | 活動設定 / 習熟 | **✗** | **✗** | export 自体に無い（mastery は**派生候補**）|
| **settings** | PIN / ポイント表示 / onboarding / tutorial | **✗** | **✗** | export 自体に無い（#3329）。PIN 等の喪失は実害大 |
| **pointBalance** (BALANCE) | ポイント残高 | **✗** | **✗** | **派生**: 台帳から再計算可 |
| **characterImage** | 生成キャラ画像 | **✗** | **✗** | **派生/再生成可**の可能性 |
| master: categories/titles/achievements/avatarItems | マスタ定義 | ✓ | ✗ | グローバル seed（tenant import 不要）— 要明示 |

### 集計
- export ✓ かつ import ✓（健全）: children / pointLedger / statuses / statusHistory(△) / loginBonuses / checklistTemplates / checklistLogs
- export ✓ だが import ✗ or △（**import 側の欠落**, #3327）: activities(△) / activityLogs(△) / evaluations(✗) / specialRewards(△)
- export ✗（**export 側の網羅漏れ**, #3329）: rewardRedemption / childChallenge / stampCard / dailyBattle / enemyCollection / certificate / parentMessage / siblingCheer / activityPref / activityMastery / settings / pointBalance / characterImage / checklistAssignment(import は再導出 △) / checklistOverride
- **廃止済（#322）= バックアップ対象外**（export/import 欠落の対象外、データ自体が存在しない）: childAchievements / childTitles
- **実体未実装（key builder 不在、データ自体が存在しない）**: childAvatarItems
- **機能実装済だが export 未対応（Phase 2 繰延、空配列を意図的に出力）**: dailyMissions

## 3. source / 派生 分類（再設計の根幹）

PO 指摘（ステータスは活動結果の projection）を踏まえ、backup 対象を分離する。**source は backup 必須、派生は復元時に再計算**（event-sourcing / CQRS）。なお childAchievements / childTitles は**機能廃止済（#322）でデータ自体が存在しない**ため、source / 派生いずれの分類対象でもない（バックアップ対象外）。

### source（イベント = 真実、backup 必須）
children / activities（定義）/ activityLogs / pointLedger（**交換 redemption / bonus / 手動調整を含む**）/ rewardRedemption / childChallenge / evaluations / checklist(template/item/assignment/log/override) / parentMessage / siblingCheer / certificate（授与記録）/ stampCard 設定 / dailyMission 定義 / activityPref / **settings（PIN・ポイント表示・onboarding 等）** / マスタ初期値・各種ルール設定（decay/スコア式）

> **セキュリティ caveat — settings を backup に含める場合の PIN 取扱（CWE-522 / CWE-916）**: 本設計で backup 対象に挙げる「settings の PIN」は **(a) おやカギコード（親ゲート認証 PIN）** を指す。これは **per-tenant の認証 secret** で、SSOT は `src/lib/domain/constants/oyakagi.ts`（`DEFAULT_PIN = '5086'`、pin_hash 未設定 tenant の照合値）+ `auth-service.ts`（`getSetting('pin_hash', tenantId)` / `setSetting('pin_hash', …, tenantId)`、L29 / L94）。値は settings の `pin_hash`（bcrypt hash）として tenant 単位に保持される。settings を source として export に含めると、この `pin_hash` が backup ファイルに同梱され、流出時に hash が露出する。おやカギ PIN は 4 桁数値（既定 5086）で entropy が低く、hash 流出 = 10^4 全数 offline brute force が現実的（CWE-522 insufficiently-protected credentials / CWE-916 low-entropy 値への hash 使用）。よって settings を backup する設計では、PIN フィールド（`pin_hash`）は (a) backup から除外し復元後に再設定させる、(b) もしくは別パスフレーズで暗号化して格納する、のいずれかとし、無防備な同梱を避ける。実装着手時（#3329 export 拡張）にこの方針を確定すること。
>
> **混同回避 — おやカギ PIN ≠ CloudExport DL PIN**: 上記 (a) おやカギ PIN とは別に、`cloud_exports.pin_code`（`schema.ts` L942、**グローバル unique**）/ `keys.ts findByPin`（L982-988）が存在するが、これは **(b) CloudExport 共有ダウンロード用の PIN**（NUC→cloud backup を S3 配布する際の受領コード、低頻度 download 経路、`keys.ts` L976-989）であり、親ゲート認証 secret とは別機構である。本 backup 網羅性の PIN 流出懸念は (a) おやカギ PIN（settings の `pin_hash`）が対象であって、(b) CloudExport DL PIN ではない。`findByPin` / `cloud_exports.pin_code` は (b) の経路であり、おやカギ PIN の SSOT ではない点に注意。

### 派生（projection = source + ルールから再計算、backup は snapshot のみ任意）
statuses / statusHistory / pointBalance / loginBonus の streak(consecutiveDays) / activityMastery / dailyBattle 結果 / enemyCollection / dailyMissions（期限切れ含む、現状 export は Phase 2 まで空配列）

> childAvatarItems は機能未実装（繰延）。実体導入時に source / 派生のいずれかへ分類する。

### 派生再計算の必要条件（忠実性 caveat）
1. **decay（ステータス減少）**: 経過時間 + decay 設定が必要（活動だけでは不足）。
2. **残高**: 活動付与 − 交換 + bonus ± 手動。pointLedger 全体が source。
3. **ルール版管理**: スコア/減衰式が時期変動するなら temporal versioning（現行ルール再計算では過去値が変わる）。
4. **性能**: 現在値は materialized cache、復元/必要時に rebuild。

## 4. 再設計の指針（#3327 + #3329 + #3328 を一体設計）

1. **source / 派生の分類を SSOT 化**（本書 §3 を `keys.ts` or 設計書に正規化）。新実体追加時に「source か派生か」を必須宣言。
2. **export**: source 実体を全網羅（#3329）。派生は明示的除外（option C）。「keys.ts family 実体 ⊆ export schema ∪ 明示除外」を機械検証。
3. **import**: source 実体を全復元 + 正しい child 紐付け（活動を per-child instance として復元し、`master.activities` flatten/dedup による binding 喪失を解消）+ 依存順序の維持（子→活動→ログ…、現状の `importFamilyData` は既に子先行だが per-child binding が欠落、§1 訂正参照）。失敗は warning に埋めず集計して部分失敗を明示。復元後に派生を **再計算（projection rebuild）**。
4. **atomicity**: replace は import-then-swap（#3326）。
5. **完全性テスト**: source 全種別の round-trip（export→clear→import→再計算→一致）+ 「evaluations が import されず欠落」「活動の per-child binding が flatten で喪失」「specialRewards 部分失敗」を赤テストで固定（#3328、failing-test-first）。
6. **timestamp 忠実性**: statusHistory 等の recordedAt を import 時刻で上書きしない（または派生化で解消）。
7. **フル event-sourcing 化**（status 等を完全 projection 化）は大きめ refactor のため別 design issue で Pre-PMF 判断（ADR-0010）。本再設計は最低限「分類 SSOT + source 全網羅 + 派生は除外/再計算」を満たす。

## 5. 復旧（incident 対応）

- NUC backup ZIP(26KB) は無傷で全 source を保持 = 唯一の正。
- 本番 t-82c17558 は子・ポイント・履歴のみの半端状態。**#3327/#3329 修正前の再 import は不可**（同じく欠落 + replace は既存を消す）。
- 修正後にクリーン再移行。移行前に現状 AWS データを別途 export 退避（ただし退避自体が網羅漏れの影響を受ける点に注意 → source 全網羅修正が前提）。
