# Research 06: マーケットプレイス 4 type 完全実装 — 業界 prior art 比較 + 根本原因 5 軸研究

> **methodology**: `docs/reference/deep-research-request-methodology.md` §4.2 「中規模 (Issue Tree + Rust RFC Alternatives + Prior art 抜粋)」
>
> **対象 EPIC**: #2135 (マーケットプレイス 4 type 完全実装 EPIC、見かけだけ機能解消、reward-set / event-checklist / rule-preset の import + アプリ反映)
>
> **対象子 Issue**: #2136 (MP-1 reward-set) / #2137 (MP-2 event-checklist) / #2138 (MP-3 rule-preset) / #2139 (MP-4 Push-3 拡張) / #2140 (MP-5 setup wizard β)
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-15 (commit 化: 2026-05-18、EPIC AC1)
>
> **補足 doc**: `06b-research-marketplace-completion-supplement.md` (実装エビデンス + DB シングルテーブル設計検討)

---

## 1. 調査目的

PO 報告 (2026-05-15):

> マーケットプレイスにある reward-set / event-checklist / rule-preset を import しようとしても反映されない。activity-pack だけ動いている。

の構造的根本解消 + ADR-0013 (LP truth) 違反疑い解消を目的に、5 子 Issue 統括 EPIC #2135 を起票するための事前調査。

軸:

- **軸 A**: 4 type の実装状況精査 (見かけだけ機能の特定)
- **軸 B**: 中途半端切り上げの構造的要因
- **軸 C**: 業界 prior art (Habitica / Beeminder / Streaks / クックパッド / みてね / ベネッセ)
- **軸 D**: 各 type の完全実装方針 (DB スキーマ / Service / UI)
- **軸 E**: 起票単位 (EPIC + 5 子 Issue / 3 子 Issue 統合 / 撤去)

---

## 2. 軸 A: 4 type の実装状況精査

### 2.1 type 別実装ステータス

| type | 一覧 (Marketplace `/marketplace`) | 詳細 (`/marketplace/[type]/[itemId]`) | import (apply service) | アプリ反映 (DB Insert + UI 表示) | 判定 |
|---|---|---|---|---|---|
| **activity-pack** | ✓ | ✓ | ✓ (`activity-import-service.ts`) | ✓ (activities テーブル + `/admin/activities` 表示) | **完全実装** |
| **reward-set** | ✓ | ✓ | ✗ | ✗ | **見かけだけ機能** |
| **event-checklist** (実装 type 名: `checklist`) | ✓ | ✓ | ✗ | ✗ | **見かけだけ機能** |
| **rule-preset** | ✓ | ✓ | ✗ | ✗ | **見かけだけ機能** |

> **注**: Issue 本文では「event-checklist」表記、実装 type 名は `checklist` (`src/lib/domain/marketplace-item.ts:15`)。本書ではどちらも同じ概念を指す。

### 2.2 影響 preset 数

- activity-pack: 既存 13 件 (full 実装で動作中)
- reward-set: 既存 5 件 (見かけだけ)
- event-checklist: 既存 3 件 (見かけだけ)
- rule-preset: 既存 5 件 (見かけだけ)
- **合計**: 23 件の preset が「マーケットプレイスに表示されているのに取込不可能」状態

### 2.3 軸 A 結論

3 type (reward-set / event-checklist / rule-preset) の 13 preset が「見かけだけ機能」状態。ADR-0013 (LP truth) 違反疑いを構成。

---

## 3. 軸 B: 中途半端切り上げの構造的要因 (4 要因)

### 3.1 B-1: AC 抽象度

| 項目 | 内容 |
|---|---|
| 過去 Issue | #585 「マーケットプレイス基盤整備」 G6 「4 type import 要件化」 |
| 問題 | 1 行で 4 type 統括、各 type の Service / UI / DB スキーマ独立 AC が不在 |
| 教訓 | type ごとに AC を分割粒度担保 (MP-4 #2139 で対応) |

### 3.2 B-2: Scope 限定の盲点

| 項目 | 内容 |
|---|---|
| 過去 PR | #1167 「activity-pack 詳細 CTA 追加」 |
| 問題 | activity-pack のみ scope 限定、reward-set / event-checklist / rule-preset の follow-up Issue 起票なし |
| 教訓 | Scope 限定 PR は必ず scope 外 part の follow-up Issue 番号を本文に記載 |

### 3.3 B-3: EPIC 検収項目漏れ

| 項目 | 内容 |
|---|---|
| 過去 Issue | #1162 「マーケットプレイス品質改修 EPIC」 |
| 問題 | 検収 AC で「4 type が動作確認できる」が一覧表示のみで判定された、import 動作確認の AC 不在 |
| 教訓 | EPIC 検収 AC で「機能完成度の機械検証可能粒度」を必須化 (MP-4 #2139 で 4 層 checklist 化) |

### 3.4 B-4: 「移行」と「実装」混同

| 項目 | 内容 |
|---|---|
| 過去 PR | #1758 「checklist routine 系撤回」 |
| 問題 | 旧 routine 系を撤回した際に新 checklist 系の「実装完了」を「移行完了」と混同、import service が未実装のまま close |
| 教訓 | リファクタ PR は「旧機構撤回」と「新機構実装」を必ず別 PR / 別 Issue で扱う |

### 3.5 軸 B 結論

4 要因 (AC 抽象度 + Scope 限定盲点 + EPIC 検収漏れ + 移行 vs 実装 混同) の連動。MP-4 (#2139) で「機能完成度 4 層 checklist」を Push-3 (#2117) に拡張、再発防止する。

---

## 4. 軸 C: 業界 prior art (3 type 別)

### 4.1 reward-set (ごほうびセット)

| OSS / プロダクト | 機構 | 採用要素 |
|---|---|---|
| Habitica | カスタムごほうび一覧で一括追加 | 一括追加 UI |
| Beeminder | コミットメント達成時のごほうび設定 | 達成連動の自動付与 |
| クックパッド プレミアム特典 | プレミアム機能のごほうび化 | ごほうび分類 (物品 / 体験 / 特権) |

**採用**: 「一括追加 UI」(MP-1 #2136 で実装) + 既存 `rewards` テーブル拡張 (DB シングルテーブル設計、ADR-0012 archive 整合)

### 4.2 event-checklist (チェックリスト)

| OSS / プロダクト | 機構 | 採用要素 |
|---|---|---|
| Streaks (iOS) | 行動定着のためのチェックリスト | 朝晩 / 平日休日のタイミング指定 |
| Octalysis フレームワーク | 行動ゲーミフィケーション | core drive 2 (Development & Accomplishment) |
| みてね 子供成長記録 | 家族共有の checklist | 家族 SSOT |

**採用**: 「一括追加 UI + タイミング指定 (morning/evening/weekend/daily/weekly)」(MP-2 #2137 で実装) + 既存 `checklist_templates` テーブル拡張

### 4.3 rule-preset (とくべつルール)

| OSS / プロダクト | 機構 | 採用要素 |
|---|---|---|
| RescueTime | ルールベース時間管理 | exchange / bonus / penalty / special の 4 ruleType |
| ベネッセ こどもちゃれんじ | ルール / 約束ごと | 子供向け文脈の表現 |
| AWS DynamoDB Multi-Tenancy | tenant 単位のルールセット | DB シングルテーブル設計 (ADR-0012 archive) |

**採用**: 4 ruleType (exchange / bonus / penalty / special) + 既存 `rules` テーブル拡張 + ADR-0012 penalty / special 細則表追加 (MP-3 #2138 で実装)

---

## 5. 軸 D: 各 type の完全実装方針

### 5.1 D-1: reward-set 完全実装 (MP-1 #2136)

- **DB**: 既存 `rewards` テーブルに insert (DB シングルテーブル、新規テーブル不要)
- **Service**: `src/lib/server/services/reward-set-import-service.ts` 新規作成
- **UI**: `/admin/rewards` に「マーケットプレイスから一括追加」CTA + マーケットプレイス詳細ページに「適用」ボタン
- **labels SSOT**: `MARKETPLACE_LABELS` に「一括追加」確立済 (L5384/5456/5461)

### 5.2 D-2: event-checklist 完全実装 (MP-2 #2137)

- **DB**: 既存 `checklist_templates` テーブルに insert
- **Service**: `src/lib/server/services/checklist-template-import-service.ts` 新規作成
- **UI**: `/admin/checklists` に「マーケットプレイスから一括追加」CTA + マーケットプレイス詳細 CTA

### 5.3 D-3: rule-preset 完全実装 (MP-3 #2138)

- **DB**: 既存 `rules` テーブルに insert (ruleType カラム拡張)
- **Service**: `src/lib/server/services/rule-preset-import-service.ts` 新規作成
- **UI**: `/admin/rules` に「マーケットプレイスから一括追加」CTA + ADR-0012 penalty / special 細則表追加 (anti-engagement 整合)

### 5.4 D-4: 再発防止 (MP-4 #2139)

- Push-3 (#2117) の `auxiliary-feature-ux-checklist` を marketplace 特化に拡張、4 層 (表示層 / import 層 / アプリ反映層 / setup 連携層) を AC 必須化

### 5.5 D-5: 統合 E2E + setup wizard β (MP-5 #2140)

- setup wizard を 1 step (全 type 一括) から 3 step 分割 (activity-pack / reward-set + event-checklist / rule-preset) に分割
- 4 type 統合 E2E テストで「一括追加 → アプリ反映」までを検証

---

## 6. 軸 E: 起票単位 (3 候補比較)

### 6.1 E-α: EPIC + 5 子 Issue (採用)

| 項目 | 内容 |
|---|---|
| メリット | 各 type を独立 Issue 化、AC 明確、PR 単位明確 |
| デメリット | 5 Issue 管理コスト |
| 採用判定 | **採用、EPIC #2135 + MP-1〜5 (#2136-2140) で起票** |

### 6.2 E-β: EPIC + 3 子 Issue (3 type を 1 PR に統合) (棄却)

| 項目 | 内容 |
|---|---|
| メリット | PR 統合で起票コスト最小 |
| デメリット | dogfood 機会損失 (3 type のうち 1 type ずつ release してフィードバック取得すべき) |
| 採用判定 | **棄却** |

### 6.3 E-γ: 撤去 / Coming Soon 化 (PO 不採用)

| 項目 | 内容 |
|---|---|
| メリット | scope 最小 |
| デメリット | PO 提示「使えるようにしたい」と矛盾、ADR-0013 違反疑い解消にもならない |
| 採用判定 | **PO 不採用** |

### 6.4 軸 E 結論

E-α (EPIC + 5 子 Issue) を採用。

---

## 7. 統合採用結論

| 軸 | 採用候補 | 担当 Issue | 実装 PR |
|---|---|---|---|
| A 実装状況精査 | 3 type 「見かけだけ機能」 | EPIC #2135 で対策統括 | — |
| B 根本原因 | 4 要因連動 | MP-4 (#2139) で再発防止 | PR #2151 |
| C 業界 prior art | Habitica / Beeminder / Streaks / クックパッド / みてね / ベネッセ | MP-1/2/3 で適用 | PR #2149/#2150/#2152 |
| D 完全実装方針 | DB シングルテーブル拡張 + Service + UI | MP-1/2/3 | PR #2149/#2150/#2152 |
| E 起票単位 | EPIC + 5 子 Issue (α) | EPIC #2135 + MP-1〜5 | PR #2149-2153 |

---

## 8. ADR / Pre-PMF 整合確認

### 8.1 ADR-0010 (Pre-PMF Bucket)

| 項目 | バケット | 根拠 |
|---|---|---|
| 3 type 完全実装 | Bucket A (P1 ペルソナ不安解消 + 20 名/月達成阻害解消) | ADR-0013 違反疑いは訴求信頼性毀損、Retention 改善 |
| MP-4 再発防止 | Bucket A (機能完成度の構造的担保) | MP-4 完了で同型再発防止 |
| MP-5 統合 E2E | Bucket B (品質強化) | dogfood 観察期間 1 ヶ月で評価 |

### 8.2 ADR-0012 (Anti-engagement)

- rule-preset の penalty / special 細則表追加が必要 (MP-3 #2138 で実装)
- 「滞在時間 = 価値毀損」原則整合、ペナルティ系 rule で子供を引き留めない設計

### 8.3 ADR-0013 (LP truth)

- マーケットプレイス UI 訴求 4 type のうち 3 type が見かけだけ → 違反疑い
- MP-1/2/3 完成で 4 type すべて完全実装 → 違反疑い解消

### 8.4 ADR-0014 (OSS 先調査)

- Habitica / Beeminder / Streaks / RescueTime / Octalysis / クックパッド / みてね / ベネッセ / AWS DynamoDB Multi-Tenancy の 9 件 prior art 確認済 (軸 C § 4)
- 独自実装ゼロ、業界 prior art パターンを採用

### 8.5 ADR archive 0012 (DynamoDB シングルテーブル)

- 4 type の Insert 先は既存 `rewards` / `checklist_templates` / `rules` テーブル (新規テーブル不要)
- DB シングルテーブル新エンティティ追加パターン (docs/design/08-データベース設計書.md §7) 整合

---

## 9. 関連 Issue / PR / 実装エビデンス

### 9.1 関連 Issue (closed)

| Issue | 状態 | PR |
|---|---|---|
| #2135 (EPIC) | open (本書 AC1 で commit、子 Issue 5 件 closed で AC2 達成) | — |
| #2136 (MP-1 reward-set) | closed (PR #2149) | PR #2149 |
| #2137 (MP-2 event-checklist) | closed (PR #2150) | PR #2150 |
| #2138 (MP-3 rule-preset) | closed (PR #2152) | PR #2152 |
| #2139 (MP-4 Push-3 拡張) | closed (PR #2151) | PR #2151 |
| #2140 (MP-5 setup wizard β) | closed (PR #2153) | PR #2153 |

### 9.2 過去 Issue (closed)

| Issue | 完了内容 | 未完了 (本 EPIC scope) |
|---|---|---|
| #585 (closed) | マーケットプレイス基盤 G1-G7 | G6 抽象度、3 type の見かけだけ機能解消 |
| #1162 (closed) | 品質改修 EPIC | 検収項目漏れ、import 動作確認 AC 不在 |
| #1167 (closed) | activity-pack 詳細 CTA | 他 3 type の follow-up 起票漏れ |
| #1758 (closed) | checklist routine 系撤回 | 「移行」と「実装」混同 |

### 9.3 関連 ADR

- ADR-0010 / ADR-0012 / ADR-0013 / ADR-0014
- ADR archive 0012 (DynamoDB シングルテーブル)

### 9.4 関連 memory

- `feedback_quality_process.md`
- `feedback_oss_first_principle.md`
- `feedback_ssot_verification_before_proposal.md`
- `feedback_anti_engagement_principle.md`

---

## 9.5 ADR-0013 LP truth 整合性監査 (EPIC #2135 AC4、2026-05-18 commit 時)

EPIC #2135 AC4「マーケットプレイス UI 訴求 4 type が全実装と一致」を本 commit (2026-05-18) で監査:

### LP 側 (site/*.html)

- `lp-content-map.md` §「禁止用語」で **「マーケットプレイス」「マケプレ」は LP 禁止用語**
- `grep -rnE "マーケットプレイス|マケプレ" site/*.html site/help/*.html` → **0 件** (PASS)
- LP 訴求は実体ベース (「持ち物チェックリスト」「プリセット活動」「ごほうび」「ルール」) で 4 type の概念は LP に直接露出していない
- `presetActivityCountClaimedMin = 300` gate (`scripts/measure-lp-dimensions.mjs`) で「300+ プリセット活動」が実 activity 件数で裏付け確認済

### アプリ側 (`/marketplace/` route)

- `src/routes/marketplace/+page.svelte:19` で **4 type 全て一覧表示**: `'activity-pack', 'reward-set', 'checklist', 'rule-preset'`
- `src/routes/marketplace/[type]/[itemId]/+page.svelte:27-30` で **4 type 全て詳細分岐実装あり**: `isActivityPack` / `isRewardSet` / `isChecklist` / `isRulePreset`
- MP-1 reward-set 一括追加 CTA (L263) / MP-2 checklist 一括追加 state (L82) / MP-3 rule-preset 一括追加 CTA (L430) で 3 type すべて実装

### 結論

LP 訴求と実装の双方向整合 (ADR-0013 LP truth) は本 commit 時点で **PASS**。3 type の見かけだけ機能は PR #2149/#2150/#2152 で完全解消、`/marketplace/` route の 4 type 訴求と実装が一致している。

---

## 10. 次の研究課題 (本書 scope 外)

- activity-pack 既存実装の再修正 — 不要
- Marketplace UI レイアウト変更 — 別 Issue で扱う
- ADR-0012 既存細則表の修正 (penalty 行追加は MP-3 内、その他は対象外)
- 各 type の preset 追加 / 削除 (既存 23 件のみ完全実装、新規 preset は別 Issue)
- 多言語化 — Pre-PMF 過剰、PMF 確認後の再評価対象
- 過去 closed Issue の retroactive 再対応 — 本 EPIC で補完対応のため retroactive 不要

---

## 11. 改訂履歴

| 日付 | 改訂 | 理由 |
|---|---|---|
| 2026-05-15 | 初版作成 (tmp/research/) | PO 報告対応の補佐 deep research |
| 2026-05-18 | docs/reference/ に正本化 (EPIC #2135 AC1) | EPIC + 5 子 Issue all closed 後の SSOT 化、PR #2149-2153 完工エビデンス整合 |
