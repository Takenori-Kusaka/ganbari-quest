---
name: Dev Open PR
description: Use when a Dev Agent (Claude Code) is about to open a PR on ganbari-quest, or when transitioning a Draft PR to Ready for Review. Initializes PR body from a kind-specific template, auto-populates fields extracted from the linked Issue (title / AC list / labels), enforces SSOT alignment with .github/PULL_REQUEST_TEMPLATE.md, and provides a 4 必須 CI gate チェックリスト for Ready 化 (AC 検証マップ / 必須セクション / `[x]` 完了 / SS 4 スロット). Replaces ad-hoc per-PR boilerplate re-invention.
---

> **親 SSOT**: [Dev Session](../../../docs/sessions/dev-session.md) / **対称 Skill**: [LP Review (PO Goal 2)](../lp-review/SKILL.md) / [Issue Triage (PO Goal 1)](../issue-triage/SKILL.md)

# Dev PR 起票ワークフロー

Dev Agent が PR を `gh pr create --draft --body-file` で起票する際の **4 ステップ手順** + Ready 化前の **4 必須 CI gate チェックリスト**。

## 構造

| ファイル | 役割 |
|---|---|
| **SKILL.md** (本ファイル) | PR 起票 4 ステップ (雛形展開 / 穴埋め / 検証 / Draft → Ready) |
| [ready-gate-checklist.md](./ready-gate-checklist.md) | Ready 化前の 4 必須 CI gate 通過チェックリスト (Wave 1 知見) |
| `templates/pr-body-{default,lp,critical-fix,refactor-ssot}.md` | kind 別 PR body 雛形 |
| `scripts/init-pr-body.mjs` | Issue から `{{ISSUE_TITLE}}` `{{AC_TABLE}}` 等を自動穴埋め |

各 PR 起票前に `node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue <num> --kind <type>` で `tmp/pr-bodies/<slug>.md` に雛形を展開してから穴埋めする。Ready 化直前に [ready-gate-checklist.md](./ready-gate-checklist.md) で 4 gate を順に確認する。

**SSOT**: ADR-0004（AC 検証）/ ADR-0030（pre-ready CLI）/ ADR-0026（force push 禁止）/ `.github/PULL_REQUEST_TEMPLATE.md`（PR template SSOT）

## 起動

```bash
# 通常 PR
node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 1863 --kind default
# → tmp/pr-bodies/1863-<slug>.md 配置

# LP 系 PR (lp-metrics 結果欄を含む)
node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 1848 --kind lp

# priority:critical bug fix (ADR-0002 5 要件欄を含む)
node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 999 --kind critical-fix

# SSOT リファクタ (移動先対応マップ欄を含む)
node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 1234 --kind refactor-ssot

# npm script ラッパー (scripts/init-pr-body.mjs 経由)
npm run dev:open-pr -- --issue 1863 --kind default
```

`--kind` 既定値は `default`。スラッグは Issue タイトルの先頭 40 文字を kebab-case 化して使う。

## ステップ 1: 雛形展開 + Issue 自動穴埋め

`init-pr-body.mjs` が以下を自動で行う:

1. `gh issue view <num> --json title,body,labels` で Issue 情報取得
2. `.claude/skills/dev-open-pr/templates/pr-body-<kind>.md` を読み込み
3. プレースホルダー置換:
   - `{{ISSUE_NUMBER}}` ← `--issue` 値
   - `{{ISSUE_TITLE}}` ← Issue タイトル
   - `{{ISSUE_LABELS}}` ← labels（`type:*` から変更タイプ checkbox を `[x]` 化）
   - `{{AC_TABLE}}` ← Issue body の `Acceptance Criteria` セクション内 `- [ ]` 行を 4 列 markdown 表に変換（検証手段 / 結果列は空欄、Agent が埋める）
4. `tmp/pr-bodies/<num>-<slug>.md` に出力（既存ファイルは上書きしない、`--force` で上書き可）

## ステップ 2: 実装後の穴埋め

Agent が実装完了後、Skill 出力の雛形に対して以下を埋める:

| セクション | 埋める内容 |
|---|---|
| 顧客価値・目的 | Issue 本文「顧客価値・目的」転記 + 期待される効果 |
| AC 検証マップ | 検証手段（コマンド / ファイルパス）+ 結果（PASS / 値） |
| 影響範囲 | 変更レイヤー checkbox + 影響画面 |
| テスト & 安全装置 | pre-ready 結果 + 追加テスト概要 |
| スクリーンショット | UI 変更時 4 スロット必須、それ以外は「該当なし（理由）」 |
| 横展開 | 並行実装ペア確認、N/A 可 |
| 配布済み env / secret | ADR-0006 該当時のみ、それ以外 N/A |

雛形の `<!-- ... -->` Markdown コメントは説明用ヒント。書き換える必要なし（コメントのまま残してよい）。

## ステップ 3: PR body 検証

```bash
# 雛形に直接ローカル検証（PR 未作成でも動く）
node scripts/check-pr-body.mjs --body-file tmp/pr-bodies/<slug>.md --skip-mergeable

# pre-ready CLI 経由（ADR-0030、PR 番号不要時は --pr 0 でも内部 skip 設計）
npm run pre-ready -- --pr <PR番号後で発番>
```

`check-pr-body.mjs` は以下を検出:
- 必須セクション欠落（PR template SSOT との完全一致）
- 禁止語混入（`予定` / `follow-up` / `PENDING` / `DEFERRED` / `別途` / `個別起票` / `TODO`）
- AC 検証マップの 4 列空セル / コメントのみセル
- Ready チェックリスト未チェック残置

検証 PASS まで雛形を更新する。Skill 雛形は **PR template SSOT に完全準拠** した状態で提供されるが、雛形時点では「AC 検証マップの検証手段 / 結果列」「Ready for Review チェックリスト」が空のため `check-pr-body.mjs` は fail する。**Agent がステップ 2 の穴埋めを完了してから検証 PASS する**設計。穴埋め完了の signal として、本検証 CLI の PASS を使用する。

## ステップ 4: Draft PR 起票 → CI 通過後 Ready 化

```bash
# gh アカウント確認 (ADR-0022 / #1728)
node scripts/check-gh-account-before-pr.mjs

# Draft PR 起票（HEREDOC 禁止 #1172、必ず --body-file）
gh pr create --draft \
  --title "<type>: #<num> <subject>" \
  --body-file tmp/pr-bodies/<num>-<slug>.md

# CI 全通過後 Ready (← 直前に ready-gate-checklist.md の 4 gate 通過を確認)
gh pr checks <PR番号> --watch
gh pr ready <PR番号>

# tmp/pr-bodies/ クリーンアップ（一時ファイル運用、#1804）
rm tmp/pr-bodies/<num>-<slug>.md
```

### Ready 化前の 4 必須 CI gate (Wave 1 知見)

`gh pr ready <num>` する直前に [ready-gate-checklist.md](./ready-gate-checklist.md) を確認:

| # | Gate | ローカル検証 |
|---|---|---|
| 1 | AC 検証マップ全行埋め | `node scripts/check-pr-body.mjs --body-file tmp/pr-bodies/<num>-<slug>.md --skip-mergeable` |
| 2 | 必須セクション 12 個 全存在 | 同上 |
| 3 | Ready チェックリスト `[x]` 完了 (虚偽禁止) | 同上 |
| 4 | UI 変更時 SS 4 スロット添付 | 修正前 × Mobile/PC + 修正後 × Mobile/PC を `docs/screenshots/pr-<num>/` または screenshots branch に配置 |

一括検証: `npm run pre-ready -- --pr <num>` (Step 6 = `check-pr-body.mjs` で gate 1+2+3 検出、Step 7 = capture が gate 4 補助)。Wave 1 で 4 Agent が同じ初回 fail を踏んだため、本チェックリストを必ず通してから Ready 化する。

## kind 別 template 選択ガイド

| kind | 用途 | 追加セクション |
|---|---|---|
| `default` | 通常の feat / refactor / docs / infra | （PR template の標準セクションのみ） |
| `lp` | `site/**` を変更する PR | `lp-metrics 結果` 欄（mobileHeight / desktopHeight / forbiddenTerms） |
| `critical-fix` | `priority:critical` の bug fix | `ADR-0002 5 要件チェック` 欄（E2E 回帰 / AC 全完了 / 提案全実装 / 5 年齢モード検証 / 直近 30 日重複変更） |
| `refactor-ssot` | SSOT 化 / ファイル移動を伴う refactor | `移動先対応マップ` 欄（旧 path → 新 path、import 更新件数） |

`--kind` を省略すると `default`。Issue label から推定する自動選択は導入しない（曖昧さによる事故回避、Agent が明示指定する）。

## SSOT alignment 原則

- **PR template (`.github/PULL_REQUEST_TEMPLATE.md`) が SSOT**。Skill 雛形は template の章立て・チェック項目を完全に踏襲する
- **template 改訂時は Skill 雛形も同 PR で更新**（`scripts/check-pr-body.mjs` が template から見出しを runtime 抽出するため、見出し追加・削除は Skill 雛形にも追従が必要）
- **kind 別追加セクションは template 共通セクションの後ろに append**（template 順序を破壊しない）

## 関連ドキュメント

| ドキュメント | 用途 |
|---|---|
| [ready-gate-checklist.md](./ready-gate-checklist.md) | **Ready 化前 4 必須 CI gate チェックリスト (Wave 1 知見)** |
| @docs/sessions/dev-session.md | Dev Session 親 SSOT（PR 作業手順） |
| @.github/PULL_REQUEST_TEMPLATE.md | PR template SSOT（雛形の見出しを完全一致させる対象） |
| @scripts/check-pr-body.mjs | PR body セルフチェック CLI（#1775 / ADR-0030） |
| @scripts/check-pr-screenshot.mjs | SS 4 スロット / ローカルパス検証 CLI（#1740 / #1741） |
| @scripts/pre-ready.mjs | pre-ready 10 step CLI（#1920 で SSOT 検証 step 3 件追加） |
| @docs/troubleshoot/screenshot_capture.md | SS 撮影 KB（SC-007 screenshots branch 運用 / SC-008 tmp gitignore） |
| @docs/decisions/0004-review-and-ac-verification.md | AC 検証マップ義務（gate 1） |
| @docs/decisions/0030-pre-ready-cli.md | pre-ready 全 Step PASS 必須 |
