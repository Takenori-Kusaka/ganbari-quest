# ADR-0049: プラン別履歴保持期間ポリシー — 物理削除の対象テーブル拡張（旧 ADR-0028 un-archived + 拡張）

> **un-archived (2026-05-19)**: rewards-cheer-shop EPIC #2266 で対象テーブル拡張のため active 化。旧 ADR-0028 (archive) の内容を継承。

> **拡張内容** (#2278): 旧 ADR-0028 削除対象 3 テーブル (`activity_logs` / `point_ledger` / `login_bonuses`) に加え、押し漏れ調査 (`docs/research/2278-retention-audit-result.md`) で抽出した P0/P1 対象テーブル (`parent_messages` / `reward_redemption_requests` 等) を retention 削除対象に拡張する方針を確立。実 service 拡張 + e2e は別フォロー Issue で実施 (scope L のため)。

| 項目 | 内容 |
|------|------|
| ステータス | accepted (旧 ADR-0028 の論理継承、archive → active 化、拡張対象表は §拡張 で記載) |
| 日付 | 2026-04-11 (initial as ADR-0028) / 2026-05-19 (拡張 + renumber to ADR-0049) |
| 起票者 | Takenori-Kusaka |
| 関連 Issue | #717（priority:critical）, #729（priority:high）, #2278 (EPIC #2266 押し漏れ調査) |
| 関連 ADR | **旧 ADR-0028 (継承)**, ADR-0022（課金データライフサイクル）, ADR-0024（プラン解決）, ADR-0025（License ↔ Subscription） |

## 2026-05-19 拡張 (#2278 / EPIC #2266)

### 拡張背景

PO 報告 (2026-05-19): 「他にも保管期限を同様に管理するデータ群があるはず。抜け漏れが気になる」

`docs/research/2278-retention-audit-result.md` の網羅調査で、子供関連 DB テーブルの大半 (49 テーブル中 22 テーブル) が ADR-0028 削除対象に含まれていない押し漏れが判明。本拡張で対象テーブルを段階的に追加する方針を SSOT 化。

### 拡張削除対象テーブル (P0/P1 優先順)

| 優先度 | テーブル | 押し漏れ深刻度 | 種別 |
|---|---|---|---|
| P0 | `parent_messages` | 高 (応援 P 履歴蓄積) | event |
| P0 | `reward_redemption_requests` | 高 (申請履歴蓄積) | event |
| P1 | `notificationLogs` | 中 (通知ログ累積) | event |
| P1 | `usageLogs` | 中 (アクセスログ累積) | event |
| P2 | `stampEntries` + `stampCards` | 中 (週次データ蓄積) | event |
| P2 | `checklistLogs` + `checklistOverrides` | 中 (日次データ蓄積) | event |

### Master テーブル (retention 対象外確定)

PO 確定方針: `special_rewards` 等の親設定 catalog は retention 対象外。

| テーブル | 理由 |
|---|---|
| `special_rewards` | ごほうび CRUD catalog (#2268)、親設定の削除は UX 毀損 |
| `checklistTemplates` / `Items` | 親設定の持ち物リスト雛形 |
| `achievements` | システム定義の達成可能リスト |
| `graduationConsent` | 法的記録、retention 対象外 |
| `certificates` | 永続記録扱い (法的記録) |
| `children` | master、削除すると参照不能 |

### 判断保留 (PO 合意要)

| テーブル | 判断要点 |
|---|---|
| `childCustomVoices` | 子供創作データ、削除で UX 毀損可能性 |
| `childAchievements` | 実績獲得履歴、長期保持期待される可能性 (卒業時振り返り) |

### Service 拡張方針 (フォロー Issue)

`retention-cleanup-service.ts` の関数を P0/P1 テーブル分追加する実装は scope L のため本 PR 外、別フォロー Issue (P3) で実施:

- P0 (`parent_messages` / `reward_redemption_requests`) の retention 削除関数追加
- P1 (`notificationLogs` / `usageLogs`) の retention 削除関数追加
- e2e (`retention-cleanup-extended.spec.ts`) で free/standard/family 3 ケース確認
- 既存 3 テーブル regression なし確認

### AN-5 #2180 補強候補 #5 連携

新規子供関連テーブル追加時、本 ADR の retention 削除対象に追加されているか + プラン別 SSOT (`historyRetentionDays`) との整合確認を機能完成度 checklist に追加候補。検知方法案: `scripts/check-retention-coverage.mjs` (新設候補) で schema.ts の `childId` を持つテーブルが retention-cleanup-service.ts の対象に含まれているか baseline pin チェック。

---

## 元 ADR-0028 内容 (継承)


## コンテキスト

ADR-0027 は「retention は表示フィルタ（物理削除なし）」を正仕様としていた。
しかしその後、以下の問題が報告された:

### 1. 価格ページの約束との実態乖離（#717, #729）

`src/routes/pricing/+page.svelte` および `site/pricing.html` で次のように明示している:

| プラン | 保管期間 |
|--------|---------|
| free | 90 日 |
| standard | 1 年 |
| family | 無制限 |

ところが実装は `applyRetentionFilter()` による **表示フィルタだけ** で、
DB 上のレコードは永続的に残っている。
これは公開ページの約束に反しており **消費者向けの虚偽表示** に抵触しうる。

### 2. GDPR / COPPA / DPIA との整合性

子供の活動ログ・ポイント履歴・ログインボーナスは **子供の個人情報** に該当する。
GDPR Art. 5(1)(e) の「保存制限原則（Storage Limitation）」は
「処理目的に必要な期間を超えてデータを識別可能な形で保管してはならない」と定めており、
pricing で 90 日と宣言しておきながら 500 日前のデータを保持し続けるのは整合しない。

### 3. ストレージコスト（副次的）

DynamoDB 課金は単価が小さいとはいえ、全テナント永続保持は **将来の PMF 後に指数関数的に増える**。
今のうちに削除パイプラインを通しておかないと、ユーザーが増えてから実装する方が技術的負債になる。

## 決定事項

**retention は「表示フィルタ + 物理削除」の二層構造に変更する。ADR-0027 を supersede する。**

### 1. 表示フィルタは残す（防御線の外側）

ADR-0027 で定義された `applyRetentionFilter` / `hasArchivedData` / `ArchiveBanner` の
UX 層はそのまま残す。理由:

- 削除バッチは日次実行のため、削除直前の 0〜24 時間は DB に残っている
- downgrade 直後は削除バッチが走る前に表示を絞るべき
- 集計テーブルへの retention 適用禁止ルールは維持（次項で再確認）

### 2. 物理削除 cron を新設（真実の削除）

`src/lib/server/services/retention-cleanup-service.ts` を新設し、
`/api/cron/retention-cleanup/+server.ts` から日次呼び出す:

1. 全テナントを走査
2. 各テナントの現在プランを `resolveFullPlanTier(tenantId, licenseStatus, planId)` で解決
   - トライアル中はトライアルティアが優先される（ADR-0024）
   - `family` （`historyRetentionDays === null`）はスキップ
3. `getHistoryCutoffDate(tier)` で cutoff 日（YYYY-MM-DD）を算出
4. そのテナントの各 child について以下 3 テーブルから `recorded_date < cutoffDate` を物理削除
   - `activity_logs`
   - `point_ledger`
   - `login_bonuses`
5. テナントごとに try/catch — 1 テナントの失敗が他に波及しないこと
6. 結果 `{tenantsProcessed, childrenProcessed, *Deleted, errors}` を構造化ログに出力

### 3. 削除対象と非削除対象

| 物理削除する | 理由 |
|-------------|------|
| `activity_logs` | 活動ログ本体。pricing の約束の核心 |
| `point_ledger` | ポイント履歴。**ただし `BALANCE` 集計は削除しない** |
| `login_bonuses` | ログインボーナス履歴 |

| 物理削除しない | 理由 |
|---------------|------|
| `point_ledger` の BALANCE アイテム | 現在の総ポイントは "がんばりの証"。消すと UX 破壊。#729 の設計: ポイントは消えず過去明細だけが消える |
| `report_daily_summaries` / 集計テーブル | 月次レポート（有料機能）は全期間の集計を前提に動作する（ADR-0027 から継承） |
| `children` / `activities` / `settings` 等のマスタ | データの意味を破壊する |
| `child_achievements` / `special_rewards` | 現時点では retention 範囲外（将来再検討） |
| `stamp_cards` / `stamp_entries` | 同上 |

### 4. ポイント残高の非削除設計

ユーザー体験上最も繊細な点: point_ledger を削除しても **現在残高は変わらない**。

- point_ledger は過去の明細（個別取引）
- BALANCE は現時点の総残高（`ADD` 演算で更新）
- retention 削除で台帳エントリが消えても BALANCE は変わらない
- 結果: 「90 日前にもらったポイントの明細」は消えるが、そのポイントは今も使える

これは pricing の「90 日履歴保持」の解釈として一貫している: 保持されるのは "履歴" であって "ポイントそのもの" ではない。

### 5. 認証とスケジュール

- エンドポイント `/api/cron/retention-cleanup/+server.ts`
- 認証: `CRON_SECRET` Bearer token（#820 / ADR-0033 で `/ops` ダッシュボードから概念分離。
  移行期間中は `OPS_SECRET_KEY` も後方互換フォールバックとして受け入れる）
- `CRON_SECRET` / `OPS_SECRET_KEY` のいずれも未設定なら 404 を返してエンドポイントの存在を秘匿
- dry-run モード: `POST { "dryRun": true }` で削除実行せず件数のみ返す
- GET は dry-run 固定（ヘルスチェック用途）
- CDK での EventBridge スケジュール定義は **本 PR では実施しない**（後続チケット）:
  - 現在の Lambda Web Adapter は ALB/API Gateway イベントを期待しており、EventBridge から直接呼ぶにはイベント変換が必要
  - 当面は OPS ダッシュボードから手動で dry-run → 本実行する運用
  - 自動スケジュール化は別 Issue で起票

### 6. 集計値は保持期間の影響を受けない（ADR-0027 から継承）

`report_daily_summaries` への物理削除は**行わない**。集計は "がんばりの証" として恒久保持。
retention cleanup service も集計テーブルには一切触れない。

### 7. downgrade 時の UX

- 削除バッチは日次なので、downgrade 直後〜24 時間以内は DB にデータが残っている
- この間は `applyRetentionFilter` が読み取り側で表示を絞る
- 次回の retention cleanup バッチで物理削除される
- 再 upgrade しても消えたデータは**戻ってこない**（ADR-0027 からの後退点、ユーザーへの明示が必要）
- 削除前の予告メール通知は別 Issue（#729 AC に含まれる）

## 根拠

### A. pricing の約束 > 「データ復元可能性」の UX

ADR-0027 は「downgrade → upgrade 時に過去データが蘇る体験」を優先していたが、
pricing page の明示的な約束（90 日/1 年/無制限）を実装で履行しないことは次の問題を生む:

- 消費者向けの虚偽表示リスク（景表法・EU 消費者保護指令）
- DPIA の "保管期間宣言" と実態の乖離（GDPR Art. 5(1)(e) 違反）
- family プランの差別化の空洞化

これらは「再 upgrade で蘇る体験」より優先度が高い。

### B. 子供のデータは消すべき

COPPA / GDPR は子供のデータに特に厳しい保存制限を要求する。
「明細は消えるがポイントは残る」という折衷案は、ポイント残高を維持しつつ
pricing の約束を守る現実的な解として成立する。

### C. 防御の多層化

表示フィルタを残すことで、削除バッチが失敗しても読み取り側では保持期間外データが見えない。
物理削除だけにすると、バッチが 1 日失敗した日に保持期間外のデータが見えてしまう。

## 影響範囲

### 設計書

- `docs/design/08-データベース設計書.md` §6.5 を全面書き換え（本 PR でコミット）
- `docs/design/17a-データ保護影響評価書.md` にデータライフサイクルセクション追加（本 PR でコミット）

### 実装（本 PR）

- `src/lib/server/services/retention-cleanup-service.ts` 新設
- `src/lib/server/db/interfaces/{activity,point,login-bonus}-repo.interface.ts` に `deleteXxxBeforeDate` 追加
- `src/lib/server/db/sqlite/{activity,point,login-bonus}-repo.ts` に SQLite 実装
- `src/lib/server/db/dynamodb/{activity,point,login-bonus}-repo.ts` に DynamoDB 実装（Query + BatchWrite）
- `src/routes/api/cron/retention-cleanup/+server.ts` 新設
- `tests/unit/services/retention-cleanup-service.test.ts` 新設（10 ケース）

### 実装（後続チケット）

- CDK EventBridge スケジュール定義
- 削除予告メール（Stripe-style の 14 日前通知）
- dry-run 結果の Discord 通知

## 代替案と却下理由

### A. ADR-0027 のまま「表示フィルタだけ」を維持する

**却下理由:** pricing の約束を実装で履行できない。景表法・GDPR Art. 5(1)(e) との整合が取れない。

### B. 物理削除のみ（表示フィルタ廃止）

**却下理由:** バッチが 1 日失敗すると保持期間外データが UI に露出する。多層防御の観点で非推奨。

### C. downgrade 時の即時削除（バッチなし）

**却下理由:** 課金サイクルの境界（ADR-0025）と整合を取るのが難しく、Stripe webhook 失敗時にデータが残る。日次バッチの方が idempotent で堅牢。

### D. retention を「soft delete フラグ」に変更

**却下理由:** ADR-0027 代替案 C と同じ理由 — unnecessary complexity。日付比較だけで済む現行実装の延長で十分。

## フォローアップ

- [ ] CDK EventBridge Rule で本エンドポイントを日次呼び出す（Lambda Web Adapter 経由）
- [ ] 削除予告メール（14 日前）の実装 — #729 AC 項目
- [ ] dry-run 結果を Discord `#unmonitored-system` チャンネルに通知
- [ ] pricing page の文言を「90 日経過後にデータは自動削除されます」と明示（法務レビュー）
- [ ] ユーザーへの仕様変更通知（再 upgrade で過去データが戻らない点）

## 関連

- #717: pricing page の「90 日保管」の実態乖離（priority:critical）
- #729: 実削除 cron 不在の根本対策（priority:high）
- ADR-0027: 本 ADR に上書きされる前の表示フィルタ限定ポリシー
- ADR-0022: 課金サイクルとデータライフサイクルの整合性
- ADR-0024: プラン解決 (resolvePlanTier) の責務分離パターン
