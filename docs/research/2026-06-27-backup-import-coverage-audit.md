# backup export / import 網羅性 監査 — 全 family 実体マトリクス (2026-06-27)

> 本書は #3329 / #3327 / #3328 の **設計の土台**。NUC→AWS 本番 import 事故（活動・履歴・ごほうび等が広範に欠落）を契機に、「アプリが保存する全 family 実体」を SSOT に、**export（backup に入るか）× import（復元されるか）** を全数監査した結果を記録する。実装着手前に、どの実体を **source（保持必須）/ 派生（再計算で復元）** とするかを確定するための基礎資料。

- 関連: #3324（timeout/UX）/ #3325（payload）/ #3326（非ACID）/ #3327（import 欠落）/ #3328（テスト完全性）/ #3329（export 網羅漏れ）/ #3330（ログイン構造）
- 証跡: 本番 table `ganbari-quest`（read-only scan）/ `export-service.ts collectForChild` / `import-service.ts importFamilyData` / `keys.ts` 全 key builder

## 1. 事故サマリ（実証）

`kokorokagami+test1@gmail.com`（tenant t-82c17558）が NUC backup(26KB) を replace import → 子・ポイント・履歴は復元されたが、活動101→0 / 活動ログ362→0 / 評価22→0 / ごほうび9→1 と**約半数の種別が欠落**。Lambda は error 無しで 28.86s 完了（warnings に埋もれ「成功」扱い）。根本は (a) import 順序バグ（活動→子で子未存在 throw 握り潰し #3327）+ (b) export/import の網羅漏れ（#3329）+ (c) 非ACID（#3326）。

## 2. 全 family 実体 × export × import マトリクス

凡例: ✓=対応 / ✗=未対応 / △=部分・要確認

| 実体 (keys.ts) | ユーザー概念 | export | import | 判定・備考 |
|---|---|---|---|---|
| children | 子供 | ✓ | ✓ | OK |
| activities (CHILDACT) | 活動 | ✓ | ✗(実質) | **import 順序バグで全 throw（#3327）** |
| activityLogs | 活動記録 | ✓ | △ | 活動0の連鎖で全 skip（#3327） |
| pointLedger | ポイント台帳 | ✓ | ✓ | OK（交換/spend 含むか要確認）|
| statuses | ステータス | ✓ | ✓ | OK（**派生候補**）|
| statusHistory | ステータス履歴 | ✓ | △ | 件数OKだが recordedAt が import 時刻に書換の疑い（**派生候補**）|
| loginBonuses | ログインボーナス | ✓ | ✓ | OK（構造見直し #3330 / streak は**派生候補**）|
| evaluations | 評価 | ✓ | **✗** | **import 関数が存在しない（#3327）** |
| specialRewards | 特別ごほうび | ✓ | △ | 9→1 部分失敗（#3327） |
| checklistTemplates | チェックリスト | ✓ | ✓ | OK |
| checklistLogs | チェックリスト記録 | ✓ | ✓ | OK |
| childAchievements | 実績(子) | △(schema) | **✗** | import 未実装（**派生候補**: マイルストーンから）|
| childTitles | 称号(子) | △(schema) | **✗** | import 未実装（**派生候補**）|
| childAvatarItems | アバター所持 | △(schema) | **✗** | import 未実装 |
| dailyMissions | デイリーミッション | △(schema) | **✗** | import 未実装（**派生/期限切れ候補**）|
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
- export ✓ だが import ✗ or △（**import 側の欠落**, #3327）: activities / activityLogs / evaluations / specialRewards / childAchievements / childTitles / childAvatarItems / dailyMissions
- export ✗（**export 側の網羅漏れ**, #3329）: rewardRedemption / childChallenge / stampCard / dailyBattle / enemyCollection / certificate / parentMessage / siblingCheer / activityPref / activityMastery / settings / pointBalance / characterImage / checklistAssignment / checklistOverride

## 3. source / 派生 分類（再設計の根幹）

PO 指摘（ステータスは活動結果の projection）を踏まえ、backup 対象を分離する。**source は backup 必須、派生は復元時に再計算**（event-sourcing / CQRS）。

### source（イベント = 真実、backup 必須）
children / activities（定義）/ activityLogs / pointLedger（**交換 redemption / bonus / 手動調整を含む**）/ rewardRedemption / childChallenge / evaluations / checklist(template/item/assignment/log/override) / parentMessage / siblingCheer / certificate（授与記録）/ stampCard 設定 / dailyMission 定義 / activityPref / **settings（PIN・ポイント表示・onboarding 等）** / マスタ初期値・各種ルール設定（decay/スコア式）

### 派生（projection = source + ルールから再計算、backup は snapshot のみ任意）
statuses / statusHistory / pointBalance / loginBonus の streak(consecutiveDays) / activityMastery / dailyBattle 結果 / enemyCollection / childAchievements / childTitles / dailyMissions（期限切れ含む）

### 派生再計算の必要条件（忠実性 caveat）
1. **decay（ステータス減少）**: 経過時間 + decay 設定が必要（活動だけでは不足）。
2. **残高**: 活動付与 − 交換 + bonus ± 手動。pointLedger 全体が source。
3. **ルール版管理**: スコア/減衰式が時期変動するなら temporal versioning（現行ルール再計算では過去値が変わる）。
4. **性能**: 現在値は materialized cache、復元/必要時に rebuild。

## 4. 再設計の指針（#3327 + #3329 + #3328 を一体設計）

1. **source / 派生の分類を SSOT 化**（本書 §3 を `keys.ts` or 設計書に正規化）。新実体追加時に「source か派生か」を必須宣言。
2. **export**: source 実体を全網羅（#3329）。派生は明示的除外（option C）。「keys.ts family 実体 ⊆ export schema ∪ 明示除外」を機械検証。
3. **import**: source 実体を全復元 + 正しい依存順序（子→活動→ログ…）+ 正しい child 紐付け。失敗は warning に埋めず集計して部分失敗を明示。復元後に派生を **再計算（projection rebuild）**。
4. **atomicity**: replace は import-then-swap（#3326）。
5. **完全性テスト**: source 全種別の round-trip（export→clear→import→再計算→一致）+ 「子未存在 replace で活動喪失」を赤テストで固定（#3328、failing-test-first）。
6. **timestamp 忠実性**: statusHistory 等の recordedAt を import 時刻で上書きしない（または派生化で解消）。
7. **フル event-sourcing 化**（status 等を完全 projection 化）は大きめ refactor のため別 design issue で Pre-PMF 判断（ADR-0010）。本再設計は最低限「分類 SSOT + source 全網羅 + 派生は除外/再計算」を満たす。

## 5. 復旧（incident 対応）

- NUC backup ZIP(26KB) は無傷で全 source を保持 = 唯一の正。
- 本番 t-82c17558 は子・ポイント・履歴のみの半端状態。**#3327/#3329 修正前の再 import は不可**（同じく欠落 + replace は既存を消す）。
- 修正後にクリーン再移行。移行前に現状 AWS データを別途 export 退避（ただし退避自体が網羅漏れの影響を受ける点に注意 → source 全網羅修正が前提）。
