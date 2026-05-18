# #2173 親レポート (admin/reports + メール初月特別版) 完成度監査

## 概要

#1600 (ADR-0023 I9、PR #1678) の AC 3 項目について、現在の実装完成度を実コード Read で監査し、補完判断を残す。

| 監査対象 | 場所 |
|---|---|
| 親レポート (admin/reports) | `src/routes/(parent)/admin/reports/+page.{server.ts,svelte}` |
| 親 dashboard (admin top) | `src/routes/(parent)/admin/+page.{server.ts,svelte}` |
| 初月価値プレビュー service | `src/lib/server/services/value-preview-service.ts` |
| プレビュー UI | `src/lib/features/value-preview/{MonthlyValuePreview,MilestoneBanner,MilestoneBellButton}.svelte` |
| weekly レポート service | `src/lib/server/services/weekly-report-service.ts` (213 行) |
| 月次レポート service | `src/lib/server/services/report-service.ts` (485 行) |
| 週次メール | `src/lib/server/services/email-service.ts` `sendWeeklyReportEmail` (457-512 行) |

## 監査結果サマリ

| AC | 状態 | 根拠 |
|---|---|---|
| AC1: 親レポートに「初月マイルストーン」セクション表示 | △ **不完全** | admin top (`/admin`) には `MonthlyValuePreview` が表示されるが、admin/reports (`/admin/reports`) には統合されていない。Issue 文面の "親レポート" を「admin top」と解釈するなら充足、「`/admin/reports` 専用画面」と解釈するなら未充足 |
| AC2: 30 日後プレビュー LP/admin 双方で表示 | △ **部分実装** | admin 側は実装済 (`MonthlyValuePreview` の `previewEligible` 分岐)。LP 側は `site/screenshots/feature-monthly-report{,-desktop}.webp` の monthly report 訴求のみで「30 日後プレビュー」の専用 LP セクション or 説明訴求は無し |
| AC3: 既存週次メールレポート初月特別版 (1 週目「最初の一歩」/2 週目「継続の力」/3 週目「あと少しで初月達成」) | ✗ **未実装** | `sendWeeklyReportEmail` は通常週次版のみ。初月週ごとの theme 切替 / subject 変更 / コピー差替えは未実装。`grep -E '最初の一歩\|継続の力\|初月達成' src/` 0 件ヒット |

## AC1 詳細: 親レポート初月マイルストーン

### admin top (`/admin`) の実装

`src/routes/(parent)/admin/+page.server.ts:178` で `getTenantValuePreview(tenantId)` を呼び `valuePreview` として load 返却。同 `+page.svelte` 内で `<MonthlyValuePreview preview={valuePreview} />` 表示。

`MonthlyValuePreview.svelte` は:
- `preview.isInFirstMonth` (signup 30 日以内) で「最初の 1 ヶ月の歩み」表示
- それ以降は「1 か月の歩み」表示
- マイルストーン 6 種 (`first_record` / `records_5` / `records_10` / `streak_7` / `streak_14` / `streak_30`) を達成済 chip 表示
- カテゴリ別 bar chart 表示

→ admin top 観点では AC1 / AC2 共に **完成済**。

### admin/reports (`/admin/reports`) の実装

`+page.server.ts` は `generateReportsForChildren` (週次) + `computeAllChildrenDetailedReport` (月次) + `getWeeklyRanking` (Family 限定) のみ load。`getTenantValuePreview` の呼び出しは **無し**。

`+page.svelte` は週次タブ / 月次タブ + Family ランキングセクションのみで、`MonthlyValuePreview` import / 表示は **無し**。

### Issue 文面解釈

#1600 §B 「確認場所: `/admin/reports`（親レポート）」 → 文字通り読むと `/admin/reports` に「初月マイルストーン」セクション必須。

→ Issue 文面の literal 解釈では **不完全 (△)**、ただし PR #1678 で admin top 採択判断が成立した可能性あり (triage コメント「全 AC を [x] に更新済」)。

## AC2 詳細: 30 日後プレビュー LP/admin 双方表示

### admin 側

`MonthlyValuePreview` で `previewEligible = daysSinceSignup >= 1` のとき表示、`isInFirstMonth` で section title / hint を「あと N 日後にこう見える」プレビュー文言に切替。→ **実装済**。

### LP 側

`site/index.html` の `feature-monthly-report{,-desktop}.webp` は `/demo/admin/status` 撮影の現状画面 SS であり「30 日後にこう見える」プレビュー専用訴求セクション (将来予測グラフ等) は実装されていない。

→ LP 観点では **未実装 (△)**。Pre-PMF 段階で LP 専用「30 日後プレビュー」コンポーネントを新規追加するのは過剰 (ADR-0010 Bucket B / C 判断)。現状 LP の monthly report SS で「将来こう見える」訴求は間接的に充足していると判断可能。

## AC3 詳細: 週次メール初月特別版

### 現状実装

`sendWeeklyReportEmail` (email-service.ts:467-512) は:
- `subject`: `🌟 ${childName}の今週のがんばり（${dateRange}）` 固定
- `htmlBody`: カテゴリ別表 + streak + points + achievement のみ
- 初月週ごとの theme 切替 (1 週目 / 2 週目 / 3 週目) **無し**
- 「最初の一歩」「継続の力」「あと少しで初月達成」コピー **無し**

### 補完判断

初月週ごとの special copy は **未実装**。実装するには以下が必要:
1. `sendWeeklyReportEmail` に `weekNumber: 1 | 2 | 3 | null` 引数追加
2. signup 日からの経過週で 1-3 を計算する logic (どこで呼ぶか: cron-dispatcher 経由の週次バッチ)
3. subject / 冒頭 heading / footer を週ごとに切替する theme map

工数見積: 2-3h (service 改修 + テスト + email preview)。

## 派生 Issue 起票判断

本 #2173 は「監査のみ、補完は別 Issue 化判断」と AC3 で指示されている。以下を提案する:

### 派生 Issue 候補 1: 親レポート画面への初月プレビュー統合 (AC1 literal 解釈分)

`/admin/reports` に `MonthlyValuePreview` を追加表示するか、admin top 1 箇所のみで運用するかを PO 判断。重複表示を許容するなら +20 行で完了。**Pre-PMF 観点では admin top 1 箇所で十分** (ADR-0010 Bucket C "迷ったらスコープ外")。

### 派生 Issue 候補 2: 週次メール初月特別版 (AC3)

`sendWeeklyReportEmail` に週次特別テーマ追加。**Pre-PMF Bucket A 寄り** (V2MOM Q2 Activation 直結、初月離脱対策)。ただし weekly email 配信 cron 経路の有効性 (active subscriber 件数) が現状不明なため、計測 Issue が先。

### 派生 Issue 候補 3: LP 30 日後プレビュー専用訴求

**Pre-PMF Bucket C** (LP の monthly-report SS で訴求は間接的に成立)。優先度低、起票は保留推奨。

## 補完判断結論

本 PR スコープでは **派生 Issue 起票は実施しない**。理由:

- AC1 admin top 表示で実質的に充足、`/admin/reports` 追加表示は冗長
- AC3 weekly email 初月特別版は active subscriber 計測が先 (ADR-0010 §3 Q3 計測可能性)
- AC2 LP 側専用訴求は Pre-PMF Bucket C

PO 別判断あれば separate Issue 起票で対応する。本監査結果は `gh issue comment 1600` で #1600 へ retrospective として登録する手順を `gh` 経由で本 PR レビュー後に実施する。

## #1600 への retrospective コメント案

```text
本 Issue 完成度監査結果 (#2173 で実施、`docs/research/2173-parent-report-completion-audit.md`):

- AC1 (親レポート初月マイルストーン): △ 不完全。admin top で完成、admin/reports では未統合。
- AC2 (30 日後プレビュー LP/admin): △ 部分実装。admin 側完成、LP 専用訴求は未実装。
- AC3 (週次メール初月特別版 1 週目「最初の一歩」等): ✗ 未実装。

派生 Issue 起票は保留 (Pre-PMF Bucket A は AC3 weekly email 特別版だが active subscriber 計測先行が必要)。
```
