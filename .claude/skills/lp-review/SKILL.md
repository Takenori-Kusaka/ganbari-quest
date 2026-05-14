---
name: LP Review
description: Use when conducting LP (Landing Page) review rounds. Initializes templates for materials/findings/integration/issue-list, spawns 3 specialist agents in parallel, and enforces SSOT for PO screenshots. Replaces ad-hoc per-round file creation.
---

> **親 SSOT**: [PO Session — Goal 2](../../../docs/sessions/po-session.md) / **関連 Skill**: [Issue Triage (Goal 1)](../issue-triage/SKILL.md)

# LP レビューワークフロー

LP (`site/**`) の re-review を行う際の 6 ステップ手順。各ラウンド開始時に `node .claude/skills/lp-review/scripts/init-round.mjs --round YYYY-MM-DD` でテンプレを `tmp/reviews/lp-YYYY-MM-DD/` に展開してから開始する。

**SSOT**: ADR-0010（Pre-PMF）/ ADR-0012（Anti-engagement）/ ADR-0013（LP truth from implementation）/ @docs/sessions/po-session.md（親 SSOT）

## 起動

```bash
node .claude/skills/lp-review/scripts/init-round.mjs --round 2026-06-01
# → tmp/reviews/lp-2026-06-01/{materials/, findings-*.md, integrated-findings.md, issue-list.md} 配置
```

## ステップ 1: PO 指摘ヒアリング

- PO スクショ（修正前 / 修正後）を `tmp/reviews/lp-YYYY-MM-DD/screenshots/` に配置
- `materials/po-direct-findings.md` を埋める（PO 指摘 ID `PO-N-1` 付与、画像物理パス + 期待状態を SSOT 化）
- **重要 SSOT 原則**: 各 Issue 本文では PO 指摘 ID と SSOT 1 行リンクのみ参照。画像物理パス・「修正前/修正後」表記の二重貼りは禁止

## ステップ 2: 前ラウンド regression trace

- `materials/regression-trace.md` を埋める
- 前ラウンドで close した PR を `gh pr list --state merged --search "label:area:lp"` で抽出
- 改悪パターン（変更が PO 期待と乖離していた箇所）を 1 行/件で記録

## ステップ 3: 3 専門 Agent spawn（parallel）

以下 3 Agent を **同時 spawn** する（複数の独立観点で並列レビュー、ADR-0010 OPEX 削減）:

| Agent | 入力 | 出力 |
|---|---|---|
| **UI/UX Reviewer** | `findings-uiux.md` 雛形 + LP 全 SS | UI/UX 22 findings (Critical / Major / Minor) |
| **Consultant Reviewer** | `findings-consultant.md` 雛形 + LP コピー | StoryBrand / LIFT / Christensen 等 17 findings |
| **PM Reviewer** | `findings-pm.md` 雛形 + 事業計画 | PM 視点 12 findings |

各 Agent は雛形冒頭の「専門 Agent 役割定義」を読んで実行。

## ステップ 4: PO 統合

- 3 findings を `integrated-findings.md` に統合
- **4 決定論点**を抽出（PO 確認必要事項）
- Issue 起票計画を立てる（kind / priority / Issue タイトル草案）

## ステップ 5: Issue 起票

Issue 起票手順詳細 → [Skill: issue-triage](../issue-triage/SKILL.md) (Pre-PMF check / HEREDOC 禁止 / OSS 先調査 / research 添付 の SSOT、#2089)。LP レビュー特有事項のみ以下:

- 各 Issue を `process_ticket.yml` (#1859) 経由で起票
- `issue-list.md` に N（finding 番号）→ #（Issue 番号）対応表を記録
- Issue 本文に「PO 指摘 SSOT 1 行リンク」を必ず含める（画像二重貼り禁止）

## ステップ 6: verify

各 Issue が以下を満たすか機械検証:
- `no-touch-zones` の A-E 節 AC が含まれているか（grep）
- `materials/po-direct-findings.md` への SSOT 1 行リンクが含まれているか
- 画像物理パス（`![](...)` 内に `tmp/reviews/.../screenshots/`）が Issue 本文に**入っていない**こと（SSOT 違反検出）

```bash
# verify 例
for issue in $(grep -oE "#[0-9]+" tmp/reviews/lp-YYYY-MM-DD/issue-list.md | sort -u); do
  body=$(gh issue view ${issue#\#} --json body -q .body)
  echo "$body" | grep -q "po-direct-findings.md#" || echo "$issue: SSOT リンク欠落"
  echo "$body" | grep -q "tmp/reviews/.*screenshots/" && echo "$issue: 画像物理パス二重貼り"
done
```

## PO スクショ SSOT 化原則

`tmp/reviews/lp-YYYY-MM-DD/materials/po-direct-findings.md` を SSOT として、各 Issue 本文は **PO 指摘 ID + SSOT 1 行リンク** のみ:

```markdown
## PO 指摘
PO-N-1（詳細: tmp/reviews/lp-YYYY-MM-DD/materials/po-direct-findings.md#po-n-1）
```

画像物理パス・「修正前/修正後」表記の二重貼りは**禁止**。SSOT 1 箇所で集中管理することで、画像パス変更時の Issue 一括更新が不要になり、認知負荷も低減する。

## no-touch-zones の固定化

過去 3 ラウンド（lp-2026-04-30 / 05-01 / 05-02）の A/B/C/D/E 節「変えるな」境界はほぼ同一。`templates/materials/no-touch-zones.md` に固定文言として配置。ラウンド固有追加項目のみ穴埋め。

## 関連ドキュメント

| ドキュメント | 用途 |
|---|---|
| @docs/sessions/po-session.md | PO Orchestrator 親 SSOT |
| @docs/decisions/0010-pre-pmf-scope-judgment.md | Pre-PMF |
| @docs/decisions/0012-anti-engagement-principle.md | Anti-engagement |
| @docs/decisions/0013-lp-truth-from-implementation.md | LP truth (Committed/Aspirational) |
| @.github/ISSUE_TEMPLATE/process_ticket.yml | Issue 起票 (#1859) |
