# Research 06b: マーケットプレイス 4 type 完全実装 — 実装エビデンス + DB シングルテーブル詳細設計

> **methodology**: `docs/reference/deep-research-request-methodology.md` §4.3 「補足調査 (実装エビデンス + 設計詳細)」
>
> **対象 EPIC**: #2135 (マーケットプレイス 4 type 完全実装 EPIC)
>
> **本書の位置づけ**: `06-research-marketplace-completion.md` (本研究) の補足として、実装エビデンス + DB シングルテーブル設計検討 + ADR-0012 penalty/special 細則表 + setup wizard β の詳細を提供
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-15 (commit 化: 2026-05-18、EPIC AC1)

---

## 1. 実装エビデンス精査 (4 type)

### 1.1 activity-pack (完全実装、reference 用)

| 層 | 実装 | エビデンス |
|---|---|---|
| domain | `MarketplaceItem<'activity-pack'>` 型定義 | `src/lib/domain/marketplace-item.ts:122` |
| Service | `activity-import-service.ts` | `src/lib/server/services/activity-import-service.ts` |
| API | `POST /api/marketplace/[type]/[itemId]/apply` | `src/routes/api/marketplace/[type]/[itemId]/apply/+server.ts` |
| UI 一覧 | `/admin/activities` に「マーケットプレイスから一括追加」 CTA | `src/routes/(parent)/admin/activities/+page.svelte` |
| UI 詳細 | `/marketplace/[type]/[itemId]` に「適用」ボタン | `src/routes/marketplace/[type]/[itemId]/+page.svelte` |
| DB | `activities` テーブル INSERT | `src/lib/server/db/schema.ts` `activities` |
| E2E | `tests/e2e/marketplace-checklist-import.spec.ts` ほか | 動作確認済 |

### 1.2 reward-set (PR #2149 で完全実装、MP-1 #2136)

| 層 | 実装方針 | 実装後エビデンス |
|---|---|---|
| domain | 既存 `MarketplaceItem<'reward-set'>` 型定義あり | `src/lib/domain/marketplace-item.ts:123` |
| Service | **新規**: `reward-set-import-service.ts` | `src/lib/server/services/reward-set-import-service.ts` (PR #2149) |
| API | 既存 `apply/+server.ts` を `reward-set` ハンドリング追加 | dispatch 拡張 |
| UI 一覧 | `/admin/rewards` に CTA 追加 | `src/routes/(parent)/admin/rewards/+page.svelte` |
| UI 詳細 | `/marketplace/[type]/[itemId]` の `type === 'reward-set'` 分岐追加 | 同上 +page.svelte |
| DB | 既存 `rewards` テーブル INSERT | `src/lib/server/db/schema.ts` `rewards` |
| 一括追加 UI | `MARKETPLACE_LABELS` `bulkAdd` 確立済 (L5384) | labels.ts SSOT |

### 1.3 event-checklist (実装 type 名: `checklist`、PR #2150 で完全実装、MP-2 #2137)

| 層 | 実装方針 | 実装後エビデンス |
|---|---|---|
| domain | 既存 `MarketplaceItem<'checklist'>` 型定義あり | `src/lib/domain/marketplace-item.ts:124` |
| Service | **新規**: `checklist-template-import-service.ts` | `src/lib/server/services/checklist-template-import-service.ts` (PR #2150) |
| API | dispatch 拡張 | apply/+server.ts |
| UI 一覧 | `/admin/checklists` に CTA 追加 | `src/routes/(parent)/admin/checklists/+page.svelte` |
| UI 詳細 | `/marketplace/[type]/[itemId]` `type === 'checklist'` 分岐 | +page.svelte |
| DB | 既存 `checklist_templates` テーブル INSERT | `src/lib/server/db/schema.ts` `checklistTemplates` |
| Payload | `ChecklistPayload.timing: 'morning' | 'evening' | 'weekend' | 'daily' | 'weekly'` | marketplace-item.ts:100 |

### 1.4 rule-preset (PR #2152 で完全実装、MP-3 #2138)

| 層 | 実装方針 | 実装後エビデンス |
|---|---|---|
| domain | 既存 `MarketplaceItem<'rule-preset'>` 型定義あり | `src/lib/domain/marketplace-item.ts:125` |
| Service | **新規**: `rule-preset-import-service.ts` | `src/lib/server/services/rule-preset-import-service.ts` (PR #2152) |
| API | dispatch 拡張 | apply/+server.ts |
| UI 一覧 | `/admin/rules` に CTA 追加 | `src/routes/(parent)/admin/rules/+page.svelte` |
| UI 詳細 | `/marketplace/[type]/[itemId]` `type === 'rule-preset'` 分岐 | +page.svelte |
| DB | 既存 `rules` テーブル INSERT (ruleType カラム拡張) | `src/lib/server/db/schema.ts` `rules` |
| Payload | `RulePresetPayload.ruleType: 'exchange' | 'bonus' | 'penalty' | 'special'` | marketplace-item.ts:109 |
| ADR-0012 細則 | penalty / special 細則表追加 | `docs/decisions/0012-anti-engagement-principle.md` (PR #2152 で追記) |

---

## 2. DB シングルテーブル設計検討 (ADR archive 0012 整合)

### 2.1 設計原則

`docs/design/08-データベース設計書.md` §7 (シングルテーブル新エンティティ追加パターン) + ADR archive 0012 (DynamoDB シングルテーブル) 整合:

- 新規テーブル追加禁止 (Pre-PMF 過剰)
- 既存テーブルに `PK = TENANT#<tenantId>` + `SK = <ENTITY>#<id>` パターンで Insert
- `entity_type` カラムで type 識別

### 2.2 4 type の Insert 先

| type | Insert 先テーブル | PK / SK |
|---|---|---|
| activity-pack | `activities` | `PK = TENANT#<tid>`, `SK = ACTIVITY#<id>` |
| reward-set | `rewards` | `PK = TENANT#<tid>`, `SK = REWARD#<id>` |
| event-checklist | `checklist_templates` | `PK = TENANT#<tid>`, `SK = CHECKLIST_TEMPLATE#<id>` |
| rule-preset | `rules` | `PK = TENANT#<tid>`, `SK = RULE#<id>` |

新規テーブル不要、既存スキーマ範囲内で完結。

### 2.3 Import 時の重複防止

- 各 import service は `tenantId × marketplaceItemId` のハッシュで idempotent key 生成
- 同 Item を 2 回 import しても DB に重複 INSERT されない (`ON CONFLICT DO NOTHING` 相当)

---

## 3. ADR-0012 penalty / special 細則表 (MP-3 #2138 で追加)

### 3.1 採用判断

PO 確定 (2026-05-15): rule-preset の 4 ruleType のうち `penalty` (ポイント減算) / `special` (特殊ルール) は子供向け anti-engagement 観点で慎重な細則が必要。

### 3.2 細則表 (ADR-0012 追加箇所)

| ruleType | 用途 | anti-engagement guard |
|---|---|---|
| exchange | ポイント交換 (ごほうび購入時) | 既存通り、ガード不要 |
| bonus | ボーナスポイント付与 (達成時) | 達成連動のみ、ランダム付与禁止 (#1593 整合) |
| **penalty** | ポイント減算 (約束破り時) | **1 日 1 回のみ、減算上限 = 1 日獲得ポイントの 50%**、滞在時間延伸禁止 |
| **special** | 特殊ルール (誕生日 / 季節イベント) | **年 3 回まで、滞在時間延伸禁止、サプライズ濫用禁止** |

### 3.3 ADR-0012 への反映箇所

`docs/decisions/0012-anti-engagement-principle.md` §「機能別細則表」に penalty / special 行を追加 (PR #2152 で commit)。

---

## 4. Setup Wizard β (3 step 分割、MP-5 #2140)

### 4.1 旧 wizard (1 step、撤廃)

| Step | 内容 |
|---|---|
| 1 (旧) | 全 4 type を一括選択 → 一括適用 |

### 4.2 新 wizard β (3 step、採用)

| Step | 内容 |
|---|---|
| 1 | activity-pack 選択 (基本活動) |
| 2 | reward-set + event-checklist 選択 (報酬 + 持ち物) |
| 3 | rule-preset 選択 (特別ルール、optional) |

### 4.3 採用根拠

- 1 step では情報量過多、ペルソナ (IT リテラシー低い親) が認知負荷で離脱
- 3 step 分割で意思決定の粒度を段階化、最後の Step 3 は optional 化
- Octalysis フレームワーク core drive 7 (Unpredictability & Curiosity) を回避、Anti-engagement 整合

---

## 5. 統合 E2E (MP-5 #2140)

### 5.1 E2E テストカバレッジ

`tests/e2e/marketplace-*.spec.ts` で 4 type それぞれを単体動作確認:

| spec | type | カバレッジ |
|---|---|---|
| `marketplace-checklist-import.spec.ts` | activity-pack / event-checklist | 既存 |
| `marketplace-reward-set-import.spec.ts` | reward-set | PR #2149 で追加 |
| `marketplace-rule-preset-import.spec.ts` | rule-preset | PR #2152 で追加 |
| `marketplace-filter.spec.ts` | フィルタ機能 | 既存 |

### 5.2 統合 E2E 配線確認 (smoke スタイル)

PR #2153 (#2140 MP-5) で setup wizard β + 4 type 統合 E2E を smoke 配線確認スタイル (anti-pattern check 整合) で実装。

---

## 6. labels SSOT 整合確認 (ADR-0045)

### 6.1 既存 labels 確立済

| labels.ts SSOT | 確立箇所 | 用途 |
|---|---|---|
| `MARKETPLACE_LABELS.bulkAdd` | L5384 | 「一括追加」(reward-set / event-checklist / rule-preset 共通) |
| `MARKETPLACE_LABELS.applyDetail` | L5456 | マーケットプレイス詳細「適用」 |
| `MARKETPLACE_LABELS.fromMarketplace` | L5461 | 「マーケットプレイスから」 |

### 6.2 新規 labels 追加

PR #2149-2152 で type 別 CTA / 説明文を `MARKETPLACE_LABELS` 配下に追加。各 PR は ADR-0045 整合 (atom 直書き禁止、template literal 経由) を遵守。

---

## 7. 改訂履歴

| 日付 | 改訂 | 理由 |
|---|---|---|
| 2026-05-15 | 初版作成 (tmp/research/) | PO 報告対応の補佐 deep research 補足 |
| 2026-05-18 | docs/reference/ に正本化 (EPIC #2135 AC1) | EPIC + 5 子 Issue all closed 後の SSOT 化、PR #2149-2153 完工エビデンス整合 |
