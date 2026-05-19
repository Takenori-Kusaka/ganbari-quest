# retention 押し漏れ網羅調査結果 (Issue #2278 / EPIC #2266)

**作成日**: 2026-05-19
**起因 PO 指摘**: 「他にも保管期限を同様に管理するデータ群があるはず。抜け漏れが気になる」

---

## 1. 既存 retention 削除対象（ADR-0028 archive 参照）

`src/lib/server/services/retention-cleanup-service.ts` で物理削除される 3 テーブル:

| テーブル | 種別 | プラン適用 |
|---|---|---|
| `activity_logs` | event (子供の活動記録) | free 90日 / standard 365日 / family ∞ |
| `point_ledger` | event (ポイント増減ログ) | 同上 |
| `login_bonuses` | event (ログイン日次ボーナス) | 同上 |

`docs/design/19-プライシング戦略書.md` line 77 + `plan-features-audit.md` line 27 がプラン別 SSOT。

---

## 2. 全子供関連テーブル分類 (49 テーブルを (a) catalog / (b) event / (c) judgment-call に分類)

### 2.a catalog/master テーブル — retention 対象外

これらは「カタログ」「マスター」「親が設定する定義」であり、子供の活動履歴ではない。
プラン別 retention を適用すると親の設定を勝手に削除することになり不適切。

| テーブル | 種別 | 判断根拠 |
|---|---|---|
| `categories` | master (5 軸 + カスタムカテゴリ定義) | 親が定義した活動分類。retention 対象外 |
| `children` | master (子供登録情報) | 削除すると全関連データ参照不能 |
| `activities` | master (活動定義) | 親設定の活動マスター |
| `statuses` | master (現在ステータス) | レベル/経験値の現在値、過去履歴ではない |
| `evaluations` | master (称号定義) | 親 + システム定義 |
| `restDays` | master (休息日設定) | 親設定の予定情報 |
| `characterImages` | master (キャラクター画像) | 親設定の表示画像 |
| `achievements` | master (実績定義) | システム定義の達成可能リスト |
| `specialRewards` | **重要判断**: マスター扱い | **PO 判断**: ごほうび CRUD catalog (#2268)、retention 対象外 |
| `checklistTemplates` | master (持ち物リスト雛形) | 親定義のチェックリスト雛形 |
| `checklistTemplateItems` | master (雛形項目) | 同上 |
| `childActivityPreferences` | master (子供の活動好み設定) | 親設定の表示/ピン |
| `stampMasters` | master (スタンプ画像定義) | システム/親定義 |
| `seasonEvents` | master (シーズンイベント定義) | テナント共通定義 |
| `siblingChallenges` | master (きょうだいチャレンジ定義) | 親設定 |
| `pushSubscriptions` | master (Push 通知購読) | 親管理 |
| `cancellationReasons` | master (解約理由マスター) | システム定義 |
| `graduationConsent` | master (卒業同意状態) | 重要法的記録、retention 対象外 |
| `viewerTokens` | master (家族閲覧トークン) | 親管理 |
| `tenantEvents` / `tenantEventProgress` | master + progress (テナント定義イベント) | 親管理 |
| `marketBenchmarks` | master (システム公開ベンチマーク) | システム定義 |
| `settings` | master (テナント設定) | 親設定 |
| `autoChallenges` | progress (週次自動チャレンジ集計) | event だが集計 progress、retention は判断保留 (β) |
| `trialHistory` | history (トライアル変遷ログ) | billing 整合、retention 対象外 |
| `cloudExports` | master (クラウドエクスポート設定) | 親設定 |

### 2.b event/transaction テーブル — retention 対象（押し漏れ含む）

これらは「子供の活動の累積履歴」で、プラン別保持期間ルールが適用されるべき。

| テーブル | 種別 | 現状 | 押し漏れ |
|---|---|---|---|
| `activity_logs` | event | ✅ 削除済 | — |
| `point_ledger` | event | ✅ 削除済 | — |
| `login_bonuses` | event | ✅ 削除済 | — |
| `statusHistory` | event (経験値変動履歴) | ❌ 未対応 | **新規押し漏れ** |
| `childAchievements` | event (実績獲得履歴) | ❌ 未対応 | **新規押し漏れ** (要 PO 判断: 称号は長期保持期待される可能性) |
| `rewardRedemptionRequests` | event (ごほうび申請履歴) | ❌ 未対応 | **新規押し漏れ** (本 EPIC 主因) |
| `checklistLogs` | event (持ち物チェック履歴) | ❌ 未対応 | **新規押し漏れ** |
| `checklistOverrides` | event (持ち物 override) | ❌ 未対応 | **新規押し漏れ** |
| `dailyMissions` | event (デイリーミッション履歴) | ❌ 未対応 | **新規押し漏れ** |
| `stampCards` | event (週次スタンプカード) | ❌ 未対応 | **新規押し漏れ** |
| `stampEntries` | event (スタンプ獲得履歴) | ❌ 未対応 | **新規押し漏れ** |
| `activityMastery` | event (活動マスタリー積み上げ) | ❌ 未対応 | **新規押し漏れ** |
| `parentMessages` | event (応援/メッセージ履歴、 #2267 で reward_notice 統合) | ❌ 未対応 | **新規押し漏れ** (本 EPIC 主因) |
| `childEventProgress` | event (シーズンイベント進捗) | ❌ 未対応 | **新規押し漏れ** |
| `siblingChallengeProgress` | event (きょうだいチャレンジ進捗) | ❌ 未対応 | **新規押し漏れ** |
| `siblingCheers` | event (きょうだい応援履歴) | ❌ 未対応 | **新規押し漏れ** |
| `notificationLogs` | event (通知送信ログ) | ❌ 未対応 | **新規押し漏れ** |
| `reportDailySummaries` | event (日次レポート集計、daily 単位) | ❌ 未対応 | **新規押し漏れ** |
| `certificates` | event/master (証書発行記録) | ❌ 未対応 | **要 PO 判断**: 証書は法的な保護対象として長期保持期待される可能性 |
| `dailyBattles` | event (日次バトル履歴) | ❌ 未対応 | **新規押し漏れ** |
| `enemyCollection` | event (敵コレクション獲得履歴) | ❌ 未対応 | **新規押し漏れ** |
| `usageLogs` | event (利用ログ) | ❌ 未対応 | **新規押し漏れ** |

### 2.c judgment-call — PO 判断要

| テーブル | 種別 | 判断要点 |
|---|---|---|
| `childCustomVoices` | event/master (子供カスタム音声) | 子供の創作データ。アバター/メッセージ素材のため retention 慎重 (削除で UX 毀損可能性) |
| `childAchievements` | event (実績獲得履歴) | 「卒業時に振り返れる成長記録」として長期保持期待される可能性 (Pre-PMF/PO 判断) |
| `certificates` | event (証書) | 法的記録扱い、retention 対象外推奨 |
| `graduationConsent` | master (卒業同意) | 法的記録、retention 対象外 |

---

## 3. 押し漏れ判定: 最も重要な対象 6 件

PO 「抜け漏れが気になる」を最も的確に解消する対象を抽出 (Pre-PMF / ADR-0028 priority 重視):

| 優先度 | テーブル | 押し漏れ深刻度 | 根拠 |
|---|---|---|---|
| **🔴 P0** | `parent_messages` | 高 | 応援 P 履歴 (本 EPIC で活用)、長期蓄積で free プランの DB サイズ膨張 |
| **🔴 P0** | `reward_redemption_requests` | 高 | 申請履歴の蓄積、resolved 後の長期保持は実用上不要 |
| 🟠 P1 | `notificationLogs` | 中 | 通知ログ蓄積、長期 retention に技術的意味なし |
| 🟠 P1 | `usageLogs` | 中 | アクセスログ、retention 必須 |
| 🟡 P2 | `stampEntries` + `stampCards` | 中 | 週次データ集計、古いものは消去対象 |
| 🟡 P2 | `checklistLogs` + `checklistOverrides` | 中 | 日次データ、古いもの蓄積 |
| ⚪ S | `childCustomVoices` | 要 PO 判断 | 子供創作データ、削除で UX 毀損可能性 |

---

## 4. master vs event 役割分離 (AN-5 補強候補 #3)

`special_rewards` の retention 対象外判断は、本 EPIC の「ごほうび CRUD = catalog」役割明確化 (PR #2293 / #2292) に整合する:

- **catalog (master)**: 親 / システムが定義する設定。retention で削除すると親設定毀損 → **対象外**
- **event (transaction)**: 子供の活動結果。保持期間ルール適用対象 → **対象**

PO 確認事項:
1. `childCustomVoices` (子供作成データ) は event か master か → 確認要
2. `childAchievements` (実績獲得) は event か永続記録か → 確認要
3. `certificates` (証書) は永続記録扱い (法的記録) → 既存仕様維持で対象外推奨

---

## 5. ADR-0028 拡張 推奨案 (案 α: un-archive + 拡張)

ADR-0028 が archive 配下にあるが内容は active。本 EPIC で押し漏れ網羅後に:

1. **un-archive**: `docs/decisions/archive/0028-retention-physical-delete.md` → `docs/decisions/0028-retention-physical-delete.md`
2. **拡張**: 対象テーブル一覧を 3 → 上記 P0/P1 で確定した N テーブルに拡張
3. **service 拡張**: `retention-cleanup-service.ts` の関数を P0/P1 テーブル分追加 (フォロー Issue 別建て推奨、scope L)

ただし PO 確定方針 (本 EPIC = 抜け漏れ調査と SSOT 完成のみ、実装は別 PR) に従い、
本 PR では:
- 調査結果ファイル (本ファイル) を tmp/research/ に commit
- ADR-0028 を un-archive (ADR README 更新 + ファイル移動)
- 設計書同期 (19/plan-features-audit) で対象テーブル拡張を計画
- **service 拡張 / e2e 追加は別フォロー Issue で対応** (scope L のため)

---

## 6. PO 合意点（本 EPIC closeout 時の整理）

PO 合意必要な事項:
- [ ] `childCustomVoices` を retention 対象とするか (子供創作データ削除の影響評価)
- [ ] `childAchievements` を retention 対象とするか (実績記録の長期保持期待)
- [ ] `certificates` を retention 対象外確定とするか (法的記録)
- [ ] P0/P1 テーブル削除実装を別フォロー Issue で起票してよいか

---

## 7. AN-5 #2180 補強候補 #5 (retention 押し漏れ検知)

新規子供関連テーブル追加時、ADR-0028 retention 削除対象に追加されているか + プラン別 SSOT (`historyRetentionDays`) との整合確認を機能完成度 checklist に追加候補。

検知方法案:
- "check-retention-coverage.mjs" (新設候補、実装は別フォロー Issue): schema.ts の `childId` を持つテーブルが retention-cleanup-service.ts の対象に含まれているかチェック
- baseline pin で既知の対象外 (master/judgment-call) を許容、新規追加で 1 件 fail
