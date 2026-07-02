# Staging ダミーデータセット要件分析

| 項目 | 内容 |
|------|------|
| 作成日 | 2026-06-28 |
| 関連 Issue | #2999 (PII を staging で使わない) / #2873 (AWS staging) / #2872 (NUC staging) / #2874 (統合 PR 最重厚テスト) |
| 関連 ADR | ADR-0010 (Pre-PMF scope) / ADR-0011 (baby = 親準備モード) / ADR-0048 (Multi-Lambda Demo) / ADR-0055 (per-child 主軸 + family master) / ADR-0052 (Marketplace 5 type) |
| 種別 | 調査 (実装はしない) |

---

## §1 背景と問い

### 現状の問題 (#2999)

staging 環境は現在、**本番 DB を snapshot して使っている**。これはコード上も確認できる:

- `docs/research/2026-06-11-audit-infra-gap-list.md` §7.1 / L172-173: `deploy-nuc-staging.yml` が `scripts/snapshot-prod-db.cjs` で「**本番 DB snapshot → staging container 起動の migration-forward step**」を実装している。
- この snapshot には実在の子供のニックネーム・活動履歴・誕生日 (`children.nickname` / `children.birthDate` / `activityLogs` 等) が含まれ、これらは PII である。

PO 方針: **個人情報を staging で使わず、合成 (synthetic) ダミーデータセットを作る**。NUC staging (#2872) / AWS staging (#2873) の両方で同一ダミーを使う。

### 問い

> ダミーデータセットとして、**ビジネスプラン三種 (free / standard / premium) 以外に何がいるか** を網羅的に洗い出したい。

本書は実装の事実 (schema / debug-plan / demo-data / age-tier 等) から、ダミーデータが網羅すべき次元を導出し、§2 でこの問いに直接回答する。

---

## §2 ダミーデータが網羅すべき次元

### 2.1 次元一覧 (コードベース根拠付き)

| # | 次元 | 取りうる値 | 根拠ファイル | staging で必要な理由 |
|---|------|-----------|-------------|---------------------|
| D1 | **年齢モード (UiMode)** | `baby` / `preschool` / `elementary` / `junior` / `senior` (5) | `src/lib/domain/validation/age-tier.ts` L16-55 (`AGE_TIER_CONFIG`) | tapSize (44-120px) / fontScale (1.0-1.5) / 漢字↔ひらがな / baby=親準備モード が全部違う。5 mode 全部を 1 画面ずつ確認しないと UI 回帰を検出できない (DESIGN.md §8 / visual regression 3 層) |
| D2 | **テーマ (theme)** | `pink` / `blue` / `green` / `orange` / `purple` (5) | `src/lib/domain/labels.ts` L478-484 (`THEME_LABELS`) / `children.theme` | 子供画面の配色が theme 駆動。全 5 色を一通り表示で確認したい |
| D3 | **性別バリアント (gender)** | `male` / `female` / `neutral` | demo-data.ts L88-185 (M/F ミックス 5 人) / marketplace activity-pack `kinder-boy` / `kinder-girl` 等 | 活動プリセットに gender variant がある (boy/girl/neutral)。デモ家族も M/F 混在で構成済 |
| D4 | **プラン tier** | `free` / `standard` / `family`(=premium) | `src/lib/server/debug-plan.ts` L16,32 / `tests/helpers/plan-fixtures.ts` | **問いの「三種」本体**。feature gate / paywall / 上限表示の検証に必須 |
| D5 | **サブスク plan ID (粒度)** | `monthly` / `yearly` / `family-monthly` / `family-yearly` / `lifetime` | `src/lib/domain/constants/subscription-plan.ts` L11-16 | 月額/年額/ライフタイムで請求・解約 UI が分岐。tier(D4) より細かい |
| D6 | **トライアル状態** | `active` / `expired` / `not-started` × tier `standard`/`family` | `debug-plan.ts` L19,33-34 (`DebugTrial`) / `trial_history` table (schema.ts L968) / plan-fixtures.ts `seedTrialActive`/`seedTrialExpired` | トライアルバナー・期限切れ後 archive・再開始拒否の検証 |
| D7 | **ライセンス状態** | `none` / `active` (`AUTH_LICENSE_STATUS`) | `cognito-dev.ts` L71-91 / debug-plan.ts L52-56 | plan tier 解決の入力。free=none / 有料=active |
| D8 | **ロール (role)** | `owner` / `parent` / `child` + ops group + federated(Google) | `cognito-dev.ts` `DEV_USERS` L41-125 | 認可境界。owner/parent/child で見える画面が違う。ops=運用ダッシュボード、federated=Google ログイン (PIN reset 分岐) |
| D9 | **子供人数 (兄弟有無)** | 1 人 / 複数人 (兄弟) | demo-data.ts (5 人家族) / `siblingCheers` (schema.ts L815) / `childChallenges` | きょうだい応援スタンプ / 兄弟間 copy 取込 / sibling celebration は複数子でないと検証不能 |
| D10 | **データ scope (ADR-0055)** | per-child instance / family master + assignments | `childActivities` (per-child, schema.ts L103) / `checklistTemplates` + `checklistTemplateAssignments` (family master, L445/L483) | activity/reward は per-child、checklist は family master + 配信。両モデルの代表データが要る |
| D11 | **marketplace 取込状態** | 未取込 / 取込済 (`source_preset_id` 有無) | `marketplace-item.ts` L20-25 (5 type) / global-setup.ts L226 (`source_preset_id`) / `data/marketplace/index.ts` (33 preset) | 「取込前の空 admin」と「取込後の一覧」両方の画面を見たい。取込 CUJ の受領先 |
| D12 | **marketplace item type** | `activity-pack` / `reward-set` / `checklist` / `rule-preset` / `challenge-set` (5、陳列は 3) | `marketplace-item.ts` L208-214 / `data/marketplace/index.ts` L178-190 | type 別の取込導線・カードを確認 (陳列 3 type + 非陳列 2 type) |
| D13 | **活動属性** | priority `must`/`optional` / `isMainQuest` 0/1 | demo-data.ts (must/main quest 混在) / global-setup.ts L217-224 | 「今日のおやくそく」バー (must) / メインクエスト演出は該当属性のデータが要る |
| D14 | **ごほうび** | reward category (6) / shopCategory `physical`/`money`/`privilege` / 交換申請 status | `specialRewards` (schema.ts L382) / `marketplace-item.ts` L99-110 (`shopCategory`) / `rewardRedemptionRequests` status (L409, `pending_parent_approval`/承認/却下) | ごほうびショップ陳列・交換・親承認フローの全 status |
| D15 | **スタンプカード** | rarity `N`/`R`/`SR`/`UR` / card status `collecting`/redeemable | `stampMasters` (schema.ts L621) / `stampCards`/`stampEntries` (L635/L659) / global-setup.ts L635-652 | スタンプ収集 UI / レアリティ別表示 |
| D15b | **バトル / 図鑑** | daily_battle status / enemy_collection | `dailyBattles` (schema.ts L1007) / `enemyCollection` (L1033) | RPG バトル画面 (LP machine-tour ④)。child 別の戦績 |
| D16 | **成長・実績** | status (5 カテゴリ × level) / achievements / certificates / 卒業 consent | `statuses` (schema.ts L196) / `childAchievements` (L357) / `certificates` (L910) / `graduationConsent` (L1104) | レーダーチャート (status 画面 / 月次レポート) / バッジ / 卒業ジャーニー |
| D17 | **活動履歴の深さ** | 0 件 / 数件 / 14日分リッチ | demo-data.ts L1502+ (14日分) / global-setup.ts L951-1006 | レーダーチャート・MilestoneBanner・月次レポートは履歴が十分ないと「空」描画になる |
| D18 | **空状態 (empty state)** | 子供 0 人 / 活動 0 件 / フィルタ結果 0 | `UnifiedEmptyState.svelte` (DESIGN.md §5) | genuine-empty / filter-empty の 3 状態 (CX-DoR #11) を staging で確認したい |
| D19 | **archive 状態** | `is_archived` 0/1 (children/activities/checklist) | schema.ts (children L23 等) / global-setup.ts L49-63 | プラン downgrade 時の archive 表示。NULL 混在行も含む (tests/CLAUDE.md スキーマ要件) |
| D20 | **親子コミュニケーション** | parent message / sibling cheer | `parentMessages` (schema.ts L724) / `siblingCheers` (L815) | 応援メッセージ (LP versus-row4) / きょうだいスタンプ |
| D21 | **設定 (settings)** | focus_mode / decay / pin / welcome 抑制 等 | `settings` (schema.ts L275) / global-setup.ts L332-485 | ステータス減少設定 (LP soft-features) / フォーカスモード / ダイアログ抑制 |

> 注: 上記は staging で「機能を一通り見る」ための代表次元。schema.ts 全 44 テーブル (categories / children / activities / childActivities / activityLogs / pointLedger / statuses / statusHistory / evaluations / marketBenchmarks / settings / restDays / characterImages / loginBonuses / achievements / childAchievements / specialRewards / rewardRedemptionRequests / checklistTemplates / checklistTemplateAssignments / checklistTemplateItems / checklistLogs / checklistOverrides / dailyMissions / childActivityPreferences / stampMasters / stampCards / stampEntries / activityMastery / childCustomVoices / parentMessages / childChallenges / siblingCheers / pushSubscriptions / notificationLogs / reportDailySummaries / certificates / cloudExports / trialHistory / viewerTokens / dailyBattles / enemyCollection / usageLogs / cancellationReasons / graduationConsent / stripeWebhookEvents) のうち、運用専用 (stripeWebhookEvents / notificationLogs / pushSubscriptions / cloudExports / viewerTokens / usageLogs) は staging のダミー基本セットでは省略可 (機能画面の主役ではない)。

### 2.2 「ビジネスプラン三種以外に何がいるか」への直接回答

プラン三種 (D4) **以外に** ダミーデータが網羅すべきもの:

- **5 年齢モード × 各 1 人以上の子供** (D1) — baby/preschool/elementary/junior/senior。これが最大の追加次元。
- **5 テーマ色 + 男女ミックス** (D2/D3) — 配色とジェンダーバリアント。
- **トライアル状態 3 種 × tier 2 種** (D6) — active / expired / not-started。プランとは独立軸。
- **ライセンス状態 none/active** (D7) と **plan ID 粒度 (月/年/ライフタイム)** (D5) — tier より細かい課金状態。
- **ロール 3 種 + ops + federated(Google)** (D8) — 認可境界・認証画面 (cognito staging で必須)。
- **単独子 / 兄弟あり 両構成** (D9) — きょうだい機能 (応援・copy・celebration)。
- **per-child データ と family master+配信 の両モデル** (D10) — ADR-0055。
- **marketplace 取込「前 / 後」両状態 × 5 type** (D11/D12) — 空 admin と取込済一覧。
- **活動 must/optional + main quest** (D13)、**ごほうび交換申請 pending/承認/却下 + shopCategory** (D14)。
- **スタンプ rarity N/R/SR/UR + バトル/図鑑戦績** (D15/D15b)。
- **成長データ (status 5 軸 level / 実績 / 卒業 consent) と 履歴の深さ (0/数件/14日)** (D16/D17)。
- **空状態 (子供0/活動0/フィルタ0)** (D18) と **archive 済データ (NULL 混在含む)** (D19)。
- **親子・きょうだいコミュニケーション** (D20) と **設定群 (focus/decay/抑制フラグ)** (D21)。

---

## §3 既存資産の再利用可否

| 資産 | 現状作っているもの | staging ダミーへの転用可否 | ギャップ |
|------|------------------|--------------------------|---------|
| `src/lib/server/demo/demo-data.ts` | **がんばり家 5 人** (901-906): 5 age mode 全網羅 + 5 theme + M/F ミックス。activities 80+ / per-child activities / 14日分 activity logs / status / stamp / battle / certificate / cheer 等を**決定的かつ PII-free** に保持 (実名回避済、L18-26) | **◎ staging ダミーの基盤として最有力**。既に「個人情報を使わない synthetic データ」の要件を満たし、demo Lambda (ADR-0048) で本番ルートを描画する実績あり | **単一 tenant (`demo`) のみ**。プラン/トライアル/ロールの**複数 tenant マトリクス (D4-D8) を表現できない**。空状態 tenant (D18) も無い |
| `tests/helpers/plan-fixtures.ts` | `makeFree/Standard/FamilyContext` (AuthContext 値ファクトリ) + `seedTrialActive/Expired` (trial_history 行挿入) | **○ プラン/トライアル軸 (D4/D6/D7) の seed ロジックを転用可** | AuthContext は**メモリ上の値**。ローカル SQLite には `licenses`/`tenants` テーブルが無く、E2E local モードは常に `plan=family` を返す (ファイル冒頭設計メモ)。staging が cognito モードなら別途 tenant 属性が要る |
| `src/lib/server/auth/providers/cognito-dev.ts` `DEV_USERS` | owner/parent/child/free/standard/family/trial-expired/google/ops の **9 ユーザ + tenant 分離** | **◎ ロール/プラン別 tenant マトリクス (D4/D8) の設計図そのもの**。各 tenant を分離しデータ干渉を防ぐ構造 | dev/COGNITO_DEV_MODE 専用。各 tenant に**実データ (子供/活動) が紐づいていない** (認証検証用の空 tenant)。staging では各 tenant に demo-data 相当を投入する必要 |
| `tests/e2e/global-setup.ts` | 5 人テスト子供 (5 mode) + status + checklist + stamp + 14日 logs を**冪等 seed** | **○ seed ロジック (status/checklist/stamp/per-child activity 複写) を流用可** | E2E 専用で大量の inline migration を含み肥大。`licenses`/`tenants` 非対応。staging 用に切り出すには整理が必要 |
| `src/lib/server/db/seed.ts` | 活動マスタ 158 件 (学習指導要領準拠) を投入 | **○ 活動マスタ・カテゴリの基礎 seed として再利用** | マスタのみ。子供/履歴/プラン状態は別途 |
| `src/lib/data/marketplace/*` (33 preset) | activity-pack 12 / reward-set 10 / checklist 3 / rule-preset 9 (build-time bundled) | **◎ そのまま利用** (取込元カタログ。取込済/未取込状態 D11 の生成に使う) | 変更不要 |

**結論**: demo-data.ts (PII-free 5 人家族) + DEV_USERS (tenant マトリクス設計) + plan-fixtures (プラン/トライアル seed) の 3 つを組み合わせれば、faker 等の新規 OSS なしでダミーセットを構成できる。最大ギャップは「**複数 tenant にそれぞれ demo-data 相当を紐づける**」配線。

---

## §4 推奨する最小ダミーデータセット仕様

Pre-PMF (ADR-0010) の「最小有効セット」原則で、過不足なく全次元を 1 回ずつ踏む構成。**tenant を 4 つ**に分け、main tenant に demo-data の 5 人家族を充てる。

### Tenant A — 「フル機能ファミリー」(premium/family プラン)
- **目的**: 全機能リッチ表示 (5 mode / 全演出 / 兄弟機能 / 月次レポート)。LP/visual regression の主役。
- **子供 5 人** = demo-data.ts の がんばり家をそのまま流用:
  - baby M (blue) / preschool F (pink) / elementary M (green) / junior F (purple) / senior M (orange) — **D1×D2×D3 を 5 人で全網羅**
- **各エンティティ代表件数** (demo-data 準拠):
  - 活動: per-child 3-6 件 (must 1 / main quest 1 含む) + マスタ 80+ 件
  - activity log: 子供あたり 5-14 日分 (レーダー/MilestoneBanner/月次レポート用、D17)
  - status: 5 カテゴリ × level 差
  - ごほうび: 5-8 件 (shopCategory 3 系統) + 交換申請 pending/承認/却下 各 1 (D14)
  - checklist: family master 1-2 + 全員 or 一部 assignment (D10)
  - stamp card: collecting 1 + 各 rarity 1 件以上 (D15)
  - battle/enemy: child 別戦績数件 (D15b)
  - certificate / graduation consent: senior child に 1 件 (D16)
  - parent message / sibling cheer: 各 1-2 件 (D20)
  - marketplace 取込済: activity-pack/reward-set/checklist を各 1 取込 (`source_preset_id` 付き、D11)
- **プラン**: family-monthly (active license)

### Tenant B — 「無料プラン」(free)
- **目的**: free gate / paywall / 上限到達表示の検証。
- **子供 1-2 人** (例: elementary 1 人) — 上限近辺 / 機能制限の見え方。
- 活動・履歴は少なめ (free の実態に近い)。marketplace **未取込** (空 admin → empty state D18)。
- **プラン**: free (license=none, trial=not-started)。

### Tenant C — 「トライアル」(2 サブ tenant 推奨)
- C1: **trial active** (standard tier) — トライアルバナー表示。子供 1-2 人。
- C2: **trial expired** — 期限切れ後 archive 表示 + 再開始拒否 (D6/D19)。archive 済データ含む。

### Tenant D — 「空 / 初期セットアップ」
- **目的**: 子供 0 人 / 活動 0 件の genuine-empty 全画面 (D18) + 初回オンボーディング導線。
- データほぼ無し。

### 認証画面用 (cognito staging のみ)
- ops group ユーザ (運用ダッシュボード) / federated(Google) ユーザ (PIN reset 分岐) を DEV_USERS 同型で用意 (D8)。
- ローカル/anonymous staging では D8 のロール差は出ないため不要 (DEBUG_PLAN で代替)。

> **合計目安**: 子供 約 9-10 人 / tenant 4-5 / 活動マスタ 158 + per-child instance 数十 / activity log 数百行 / ごほうび・checklist・stamp・battle・certificate 各数件。決定性 (固定 id / 固定日付 NOW) を demo-data と同じく維持する。

---

## §5 実装方針の選択肢

### 選択肢 A — 既存 demo-data.ts を staging ダミーに拡張・転用
- **概要**: demo-data.ts (PII-free 5 人家族) を SSOT とし、staging seed から読み込む。demo Lambda が既にこの経路を使っている。
- **メリット**: 追加コードほぼゼロ / 既に決定的 & PII-free / visual regression baseline と整合 / 「demo と staging で同一ダミー」が自然。
- **デメリット**: 単一 tenant 前提。プラン/トライアル/ロールのマトリクス (D4-D8) を表現できない。
- **Pre-PMF コスト**: 最小。

### 選択肢 B — 専用 staging seed script を新設 (A を内包)
- **概要**: demo-data.ts (Tenant A の中身) + plan-fixtures の seed ロジック + DEV_USERS の tenant 設計を組み合わせ、Tenant A-D を投入する薄い seed script (`scripts/seed-staging.ts` 等) を 1 本作る。
- **メリット**: 複数 tenant マトリクスを表現可能 (§4 を完全カバー)。既存資産を呼ぶだけの薄いラッパで済む。NUC(SQLite)/AWS(DynamoDB) 両方に同じ入力データを流せる。
- **デメリット**: 新規 script 1 本 (使い捨て禁止 #1442 に注意 — 汎用 seed として位置づける)。
- **Pre-PMF コスト**: 中 (既存資産の組み合わせのため低め)。

### 選択肢 C — faker 系 OSS でランダム生成
- **概要**: `@faker-js/faker` 等でランダムな子供名・履歴を量産。
- **メリット**: 大量・多様なデータを自動生成。
- **デメリット**: **非決定的** → visual regression / E2E が flake (ADR-0053 pixelmatch と相性最悪)。Pre-PMF で過剰 (ADR-0010)。日本語の自然な子供名・年齢整合・per-child/family master 整合を faker で担保するのはかえって難しい。bundle/学習コスト増。
- **Pre-PMF コスト**: 高 (不採用)。

### 推奨: **A を基盤に B (薄い専用 seed)**

demo-data.ts を Tenant A の SSOT として再利用し、Tenant B-D (プラン/トライアル/空) を plan-fixtures + DEV_USERS のパターンで足す薄い seed script を 1 本用意する。**C (faker) は Pre-PMF では不採用** — 決定性が visual regression / E2E の前提であり、業界の synthetic test data プラクティス (PII 不使用 / 代表性 / 決定性 / 関連整合性) も「固定 fixture」で十分満たせる。faker が要るのは負荷試験で大量データが要る規模になってから。

---

## §6 残論点 / PO 確認事項

1. **staging の AUTH_MODE は何か?** — cognito (本番同型、tenant 属性あり) か / local・anonymous か。これで D4-D8 のプラン/トライアル/ロール軸を「実データ tenant」で持つ必要があるか、`DEBUG_PLAN` env 切替で足りるかが決まる。#2873 (AWS) は cognito 想定、#2872 (NUC) は local 想定の可能性。
2. **AWS staging (DynamoDB) と NUC staging (SQLite) で同一ダミーを流す配線**: demo-data.ts は両 backend の demo repo (`src/lib/server/db/demo/*`) で参照される。seed script は両 backend に対応させるか、demo repo 経由で read-only 提供するか。
3. **staging は書き込み可能 (mutation テスト用) か read-only (demo 同様) か**: demo は write を no-op 化する。staging で実際に取込/記録/交換を試すなら writable seed が要る。
4. **履歴の深さ**: 月次レポート/レーダー/MilestoneBanner が「空」に見えない最小 log 件数を確定 (demo は 14 日 / global-setup は 5-7 日)。
5. **実名回避ポリシーの明文化**: demo-data は既に実名回避済 (がんばり家)。staging ダミーも同じ命名規則を踏襲する旨を確定 (MEMORY: 実子供名禁止)。
6. **既存 `snapshot-prod-db.cjs` 経路 (#2999 の問題) の置換タイミング**: ダミー seed 完成後に NUC staging の本番 snapshot step を撤去するか。

---

## 付録: 参照ファイル (絶対パス)

- `C:\Users\kokor\ganbari-quest\src\lib\domain\validation\age-tier.ts` (D1)
- `C:\Users\kokor\ganbari-quest\src\lib\domain\labels.ts` L478-484 (D2 theme)
- `C:\Users\kokor\ganbari-quest\src\lib\server\debug-plan.ts` (D4/D6/D7)
- `C:\Users\kokor\ganbari-quest\src\lib\domain\constants\subscription-plan.ts` (D5)
- `C:\Users\kokor\ganbari-quest\src\lib\server\auth\providers\cognito-dev.ts` (D8 DEV_USERS)
- `C:\Users\kokor\ganbari-quest\tests\helpers\plan-fixtures.ts` (プラン/トライアル seed)
- `C:\Users\kokor\ganbari-quest\src\lib\server\demo\demo-data.ts` (Tenant A 基盤)
- `C:\Users\kokor\ganbari-quest\tests\e2e\global-setup.ts` (seed ロジック流用元)
- `C:\Users\kokor\ganbari-quest\src\lib\server\db\schema.ts` (全 44 テーブル)
- `C:\Users\kokor\ganbari-quest\src\lib\domain\marketplace-item.ts` / `src\lib\data\marketplace\index.ts` (D11/D12)
