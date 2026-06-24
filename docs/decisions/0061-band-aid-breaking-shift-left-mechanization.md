# 0061. band-aid サイクル打破 + shift-left の機械強制 (failing-test-first / same-class-N→guard / push-down-pyramid / fitness function)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-06-20 |
| 起票者 | Claude (補佐、PO 判断適用) |
| 関連 Issue | #3152 (本 ADR) / #3104・#3132 (反復 blocker 実例) / #3134・#3164 (fitness function 初適用) |
| 関連 ADR | ADR-0003 (Issue root-cause) / ADR-0005 (test ratchet) / ADR-0006 (assertion erosion) / ADR-0007 (静的解析 tier) / ADR-0060 (完了 10 項目検証) |

## コンテキスト

export/import クラスタで 2 サイクル連続して blocker が発生した (#3104 → #3132)。日本語名・points 値域という **別 instance を都度パッチ**した結果、「1 つ直すと次が露見するモグラ叩き」になった。さらに #3163 のように **重量 e2e でしか露見せず develop 軽量レーンをすり抜ける**回帰も繰り返した (#3134 の admin 正準契約 blind spot も同型)。

これらは個別の見落としではなく、**再発防止が「人の注意」依存で、不変条件が高レベル (e2e) にしか表明されていない**構造的失敗である。同じ class のバグが安価な PR-time check に降りていないため、統合監査まで露見しない。本 ADR は band-aid を断ち、不変条件を test pyramid の下位 (unit / lint / fitness function) に push down する規律を**機械強制**で institutionalize する。

## 検討した選択肢 (OSS / 確立パターン最低 2 件 — #1350)

### 選択肢 A: ADR + 既存 skill/gate/lint 拡張で機械強制 (採用)
- 概要: failing-test-first (martinfowler.com/bliki/SelfTestingCode) / defect clustering (ISTQB 原則 #4) / push-down-the-pyramid (martinfowler.com/articles/practical-test-pyramid) / architectural fitness function (thoughtworks / archunit.org) を、既存の pr-review skill・Issue Template・eslint-plugin-local・vitest に encode する。
- メリット: ツール費ほぼゼロ。既存資産 (#3134/#3164 の fitness function 前例、eslint-plugin-local、svelte/no-inline-styles) の延長で属人性を排除。
- デメリット: ルールの遵守は gate の網羅性に依存 (段階導入が必要)。

### 選択肢 B: 完全な SLO / error-budget tooling + 正式 postmortem ceremony + Pact broker
- 概要: SRE workbook の error-budget-policy / fishbone workshop / contract testing を本格導入。
- デメリット: Pre-PMF 個人開発に過剰 (ADR-0010 §3)。原則のみ転用し tooling は不採用。

## 決定

以下 4 原則を機械強制する (詳細な encode 先は §結果)。

1. **failing-test-first**: 全バグ修正は「まず失敗するテストを書き、それが green になることで修正を証明する」。bug 報告 Issue / dev チケットに `根本原因 (5 Whys → root class)` を必須記入し、PR は「再現テスト → 修正」の順を pr-review checklist で確認する。
2. **same-class-N-times → 機械 guard 必須**: 同一バグ class が 2 回以上再発したら、次の修正は**別 instance パッチでは Done にせず**、CI gate / lint / property test / fitness function で class 全体を lock する (defect clustering、ADR-0060 と整合)。
3. **push-down-the-pyramid**: 重量レーン (Playwright / 統合監査) が失敗するたび「同じ条件を unit / lint で捕捉できたか」を問い、可能なら下位層に降ろしてから green 化する (ADR-0007 2 層 cadence の運用明文化)。
4. **構造不変条件の fitness function 化**: CLAUDE.md の散文構造ルール (`+server.ts` から ORM 直呼び禁止 / routes に DB 直 access 禁止 / Base token を routes で直接使用禁止 / admin 正準契約 #3134) を、人手 review でなく lint / fitness function (eslint-plugin-local / dependency-cruiser / vitest FS 走査) に encode して stage-1 PR gate 化する。

**Pre-PMF scope (ADR-0010)**: 原則の institutionalize と既存資産拡張のみ。SLO / error-budget / 正式 postmortem / Pact broker は no-go。

## 結果

| 原則 | encode 先 | 段階 |
|---|---|---|
| failing-test-first | `.claude/skills/pr-review/SKILL.md` C項 + Issue Template `根本原因` 必須欄 | 本 ADR PR (Phase 1) |
| same-class-N→guard | 本 ADR + pr-review skill 判定節 | Phase 1 |
| push-down-pyramid | pr-review skill C項 + ADR-0007 整合注記 | Phase 1 |
| fitness function 化 | #3134/#3164 (admin 正準) 済 + 残り構造ルールの dependency-cruiser/eslint encode | **Phase 2 (#3152 後続、follow-up Issue で段階導入)** |
| deps 供給線 shift-left (#3191) | `ci.yml deps-supply-chain-check` = `check-dependabot-target-branch.mjs` (dependabot main 直行封鎖 regression guard) + `native-dep-smoke.mjs` (better-sqlite3/bcrypt/sharp の native binding crash を軽量レーンで捕捉) + audit-team.md §3.5.1 (deps diff scope) | #3191 (#3190 SIGSEGV 再発防止) |

- **トレードオフ**: Phase 1 は process / 軽量 gate のみで即効性は限定的。構造ルールの完全機械化 (Phase 2) は dependency-cruiser 導入 or eslint-plugin-local 拡張を伴うため段階導入する (本 ADR で原則を fix し、適用は #3134/#3164 を起点に拡張)。
- **10 枠ルール (README)**: 本 ADR 追加に伴う 1-in-1-out は ADR-0060 と同様、2026-06 最終週の月 1 棚卸で archive 候補 (proposed 据置 / 重複) と併せて消化する。
