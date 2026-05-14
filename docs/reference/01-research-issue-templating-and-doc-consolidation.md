# Research 01: Issue Template 強制パターン / research 添付方式 / 既存 6 文書統廃合の比較研究

> **methodology**: `docs/reference/deep-research-request-methodology.md` §4.2 「中規模 (Issue Tree + Rust RFC Alternatives + Prior art 抜粋)」
>
> **対象 Issue**: #2088 (S-1) / #2089 (S-2) / #2090 (Issue Template yml 改修)
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-14

---

## 1. 調査目的

PO 補佐 (Claude Code) が今後 Issue 起票時に競合・OSS・design pattern の deep research を実行し、調査レポートを Issue 本文 + `docs/reference/` に添付して実装者に詳細設計指導を提供する責務を `docs/sessions/po-session.md` に明文化する。本研究は以下 3 軸の選択肢を比較し、Issue A (S-1 採用) の根拠を残す。

- **軸 A**: Issue Template での「research 添付」の強制方式
- **軸 B**: research 結果の出力先と添付方式
- **軸 C**: 既存 6 文書 (issue-triage SKILL / lp-review SKILL / .github/CLAUDE.md / ADR-0003 / ADR-0010 / ADR-0014) の統廃合戦略

---

## 2. 軸 A: Issue Template での研究強制パターン (7 候補比較)

### 2.1 候補 A1: GitHub Issue Forms `required: true`

| 項目 | 内容 |
|---|---|
| 概要 | `.github/ISSUE_TEMPLATE/*.yml` の textarea / dropdown に `validations.required: true` を指定し、起票時に研究セクション入力を強制 |
| 1 次ソース | GitHub Docs: "Syntax for issue forms" ( https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema ) |
| 採用実績 | actions/runner / kubernetes/kubernetes 等で多用 |
| メリット | 機械強制 / 起票時に検知 / UI でユーザーフレンドリー |
| デメリット | 複雑な branching 不可 / Markdown 構造の自由度低い |
| Pre-PMF コスト | 低 (既存 dev_ticket.yml / process_ticket.yml に追加するだけ) |
| 採用判定 | **採用 (Issue C #2090 で実装)** |

### 2.2 候補 A2: Pull Request Template の checkbox 義務化

| 項目 | 内容 |
|---|---|
| 概要 | PR template に「Issue research 添付済み」checkbox を追加し、PR レビューで強制 |
| 採用実績 | npm, vercel/next.js 等 |
| メリット | PR 段で検知 (Issue 起票時の負荷分散) |
| デメリット | 起票時の漏れを Dev 着手まで検出できない (1-2 週間タイムラグ) |
| 採用判定 | **棄却** (起票時 gate が本 Issue の目的) |

### 2.3 候補 A3: GitHub Action で Issue body lint

| 項目 | 内容 |
|---|---|
| 概要 | `actions/github-script` + 正規表現で「Research weight: 軽量/中規模/大規模」必須行を検証 |
| 採用実績 | tj-actions/branch-names 等で類似実装あり |
| メリット | Forms と組み合わせれば二重 gate |
| デメリット | Pre-PMF で CI コスト追加 (#1350 OSS 調査負荷増) |
| 採用判定 | **棄却** (Forms 単独で十分) |

### 2.4 候補 A4: Rust RFC Alternatives セクション抜粋

| 項目 | 内容 |
|---|---|
| 概要 | rust-lang/rfcs の `Alternatives` / `Prior art` セクションを Issue Template に転用 |
| 1 次ソース | rust-lang/rfcs README.md / 0000-template.md |
| 採用実績 | Rust language design / Tauri / Bun 等が踏襲 |
| メリット | 棄却理由を残す文化が強制される (ADR-0014 OSS 先調査と整合) |
| デメリット | 軽量 Issue に過剰 |
| 採用判定 | **採用 (中規模・大規模に限定、軸 A1 と併用)** |

### 2.5 候補 A5: Shape Up "No-gos" セクション

| 項目 | 内容 |
|---|---|
| 概要 | 37signals Shape Up の "No-gos" (意図的に対応しない範囲) を起票時に明記 |
| 1 次ソース | "Shape Up" by Ryan Singer (basecamp.com/shapeup) |
| 採用実績 | Basecamp / Notion 等 |
| メリット | scope creep を起票時に防ぐ |
| デメリット | Issue 本文に「No-gos」セクション追加 (見通し悪化) |
| 採用判定 | **採用 (process_ticket.yml に「意図的に対応しない範囲」セクション追加)** |

### 2.6 候補 A6: Anthropic Constitutional AI prompt engineering

| 項目 | 内容 |
|---|---|
| 概要 | Claude prompt に Constitutional AI 原則を埋め込み、起票時の self-critique を強制 |
| 1 次ソース | Anthropic "Constitutional AI: Harmlessness from AI Feedback" (Bai et al. 2022) |
| 採用実績 | Claude 内部 + Anthropic API ユーザ |
| メリット | LLM の自己批判で品質担保 |
| デメリット | 機械強制ではなく LLM 任せ (再現性低い) |
| 採用判定 | **棄却** (Issue Template の機械強制で十分) |

### 2.7 候補 A7: Google Design Doc Review Process

| 項目 | 内容 |
|---|---|
| 概要 | "Reviewed by" / "Approved by" フィールドを Issue Template に強制 |
| 1 次ソース | "Design Docs at Google" by Malte Ubl / "Software Engineering at Google" (Winters et al. 2020) Ch.10 |
| 採用実績 | Google internal / TensorFlow RFC 等 |
| メリット | 起票時に PO サインオフ強制 |
| デメリット | 個人開発 (Pre-PMF) で reviewer 不在問題 |
| 採用判定 | **部分採用** (PO 補佐 = 補佐 / PO = 承認者 の 2 段階に限定) |

### 2.8 軸 A 採用組み合わせ

**首位推奨**: A1 (Forms required) + A4 (Alternatives + Prior art 抜粋) + A5 (No-gos) の 3 件併用。Issue C (#2090) で yml 改修時に同時実装。

---

## 3. 軸 B: research 結果の出力先と添付方式 (4 候補比較)

### 3.1 候補 B1: `docs/reference/` link 方式

| 項目 | 内容 |
|---|---|
| 概要 | research 詳細を `docs/reference/NN-research-<topic>.md` に保存し、Issue 本文末尾に relative link を貼る |
| 採用実績 | Linux kernel / Rust / Kubernetes 等 (KEP, KAIP) |
| メリット | Issue UI が軽い / git history 残る / ADR 10 枠制約に抵触なし / DRY |
| デメリット | Issue だけ見ると詳細不明 (link クリック前提) |
| Pre-PMF コスト | 低 (markdown ファイル追加のみ) |
| 採用判定 | **首位採用 (本 SSOT、Issue A)** |

### 3.2 候補 B2: Issue body 全文埋め込み

| 項目 | 内容 |
|---|---|
| 概要 | research 全文 (1-3 万字) を Issue body に直接書く |
| 採用実績 | TC39 proposals / WHATWG 等 (1 件 1 万字超ザラ) |
| メリット | Issue だけで完結 / 検索性高い |
| デメリット | Issue UI が重い / 改訂時 commit 履歴残らない |
| 採用判定 | **棄却** (Pre-PMF で 1 万字 Issue は GitHub UI 描画限界) |

### 3.3 候補 B3: 新 ADR として起票

| 項目 | 内容 |
|---|---|
| 概要 | research 結果を直接 ADR (docs/decisions/NNNN-*.md) として起票 |
| 採用実績 | architecture-decision-record (ThoughtWorks) / Spotify 等 |
| メリット | 意思決定の最終形が一発で残る |
| デメリット | ADR 10 枠上限 (`docs/decisions/README.md` §「ボリューム上限ルール」) に抵触。Pre-PMF で枠を pre-research で消費するのは過剰 |
| 採用判定 | **棄却** (中規模・軽量 research には過剰、大規模のみ ADR 化検討) |

### 3.4 候補 B4: GitHub Wiki / Discussions

| 項目 | 内容 |
|---|---|
| 概要 | Wiki / Discussions で research を管理 |
| 採用実績 | OBS Studio / Bevy 等 |
| メリット | Issue から分離 |
| デメリット | git 履歴外 / PR レビューで diff 取れない / Pre-PMF で 2 surface 増加 |
| 採用判定 | **棄却** (`docs/reference/` で十分、git 履歴重要) |

### 3.5 軸 B 採用

**首位推奨**: B1 (`docs/reference/NN-research-*.md` link 方式)。本 reference ファイル自身が B1 採用の implementation。

---

## 4. 軸 C: 既存 6 文書統廃合戦略 (3 案比較)

### 4.1 既存 6 文書の責務マッピング

| # | 文書 | 現状の責務 | 本 Issue との重複 |
|---|------|----------|----------------|
| 1 | `.claude/skills/issue-triage/SKILL.md` | 7 ステップフェーズゲート | OSS 先調査 (Step 2) と部分重複 |
| 2 | `.claude/skills/lp-review/SKILL.md` | LP レビュー 3 専門 Agent + PO 統合 | LP 特化、重複なし |
| 3 | `.github/CLAUDE.md` | Issue ラベル / phase / blocked_by | 重複なし |
| 4 | `docs/decisions/0003-issue-quality-standard.md` | 根本原因 + AC 全境界条件 | 起票時の調査責務未定義 |
| 5 | `docs/decisions/0010-pre-pmf-scope-judgment.md` | Pre-PMF scope 判断 3 bucket | 過剰研究コスト判断と関連 |
| 6 | `docs/decisions/0014-labels-i18n-mechanism.md` | OSS 先調査 2 件比較 | 機械強制実装は本 Issue C で |

### 4.2 案 C-1: S-1 即時 (現状維持 + po-session.md 1 セクション追加)

| 項目 | 内容 |
|---|---|
| 概要 | `docs/sessions/po-session.md` に「タスク 4」を追加するのみ。6 文書には触らない |
| 採用実績 | 漸進的改善 (Kaizen / Conway's Law 整合) |
| メリット | 低リスク / 既存運用に影響なし / dogfood 観察期間を確保できる |
| デメリット | 重複が一時的に残る (ADR-0014 OSS 先調査 vs 本 Issue のタスク 4) |
| 採用判定 | **首位採用 (Issue A、本 PR)** |

### 4.3 案 C-2: S-2 (6 文書統廃合、issue-triage SKILL に集約)

| 項目 | 内容 |
|---|---|
| 概要 | po-session.md タスク 4 を `.claude/skills/issue-triage/SKILL.md` に統合 + ADR-0014 を archive 送り |
| 採用実績 | Single Responsibility Principle / SSOT 強化 |
| メリット | 重複ゼロ / 補佐は SKILL を 1 つ読めば良い |
| デメリット | 6 文書同時改修 = 高リスク。dogfood 観察前にやると修正コスト膨大 |
| 採用判定 | **3-6 ヶ月後再評価 (Issue B #2089 で扱う)** |

### 4.4 案 C-3: ADR-0014 を本研究で supersede

| 項目 | 内容 |
|---|---|
| 概要 | ADR-0014 (OSS 先調査) を本研究の新方針で supersede |
| メリット | ADR 数削減 |
| デメリット | ADR-0014 は機械強制 (`check-namespace-duplicate.mjs` 等) と整合する技術選定 SSOT で、本 Issue の運用責務とは責務が異なる。supersede すると機械強制側の参照が不安定化 |
| 採用判定 | **棄却** (ADR-0014 と本 SSOT は補完関係) |

### 4.5 軸 C 採用

**首位推奨**: C-1 即時 (S-1 = Issue A 本 PR) + C-2 を 3-6 ヶ月後再評価 (S-2 = Issue B #2089)。

---

## 5. ADR との整合

### 5.1 ADR-0014 (labels / i18n 機構選定)

- **整合点**: ADR-0014 は OSS 2 件先調査ルールの **個別事例 (labels.ts)**。本 SSOT はその汎用化として「Issue 起票時の研究方法論」を提供
- **supersede 関係**: なし。ADR-0014 は技術選定 SSOT、本 SSOT は運用方法論 SSOT。両者は orthogonal

### 5.2 ADR-0010 (Pre-PMF scope 判断)

- **整合点**: 本 SSOT §4 「軽量 / 中規模 / 大規模」は ADR-0010 の Bucket A / B / C と平行概念
- **連動**: 大規模 research は ADR-0010 Bucket A (Critical) との照合を要する。Pre-PMF で過剰防衛設計 (汎用監査ログ / WAF 等) は本 SSOT の研究対象外

### 5.3 ADR-0003 (Issue 品質)

- **整合点**: 本 SSOT は ADR-0003 §3 「根本原因」+ §4 「構造的解決」を起票前 deep research で補強する役割
- **拡張**: ADR-0003 §4 内部 refactor exempt (2026-05-07 #1985 / #1986) と整合。refactor:internal-no-doc-impact は軽量 weight で十分

---

## 6. 採用しなかった代替案 (Rust RFC §6 Rationale and alternatives 準拠)

### 6.1 deep-research-agent (Claude Code agent) で全 Issue を自動 research

- **棄却理由**: agent 自主探索の偏り (Phase 1 §1.2 PO 補佐降格の根本原因の 1 つ) を再生産する。PO の意図確認 4 段階を経ない自動化は危険
- **将来採用**: PO 確認 4 段階を勘案する agent prompt 設計が完成すれば再検討

### 6.2 Perplexity Pro / OpenAI Deep Research / Gemini Deep Research の有料利用

- **棄却理由**: Pre-PMF で月 $20-60 課金は ADR-0010 Bucket C (Nice-to-have) 相当。Claude Code 内の WebSearch + Plan Agent で 80% カバー可
- **将来採用**: 大規模 research で 1 件あたり 8 時間超になった場合に従量課金で検討

### 6.3 GitHub Copilot Issue Creation Workspace

- **棄却理由**: Copilot Workspace (preview, 2024) は GitHub Enterprise 機能で個人開発 Pre-PMF では未契約
- **将来採用**: なし (Claude Code で代替可能)

---

## 7. Prior art (類似プロジェクトの起票時調査文化)

### 7.1 Rust language RFCs (rust-lang/rfcs)

- **学び**: Alternatives / Prior art セクションが定型化 → 棄却理由が残る
- **本 SSOT への反映**: §3 軸 A4 採用

### 7.2 Python PEPs (python/peps)

- **学び**: "Rejected Ideas" セクションが PEP 1 で定義 → 過去の議論を辿れる
- **本 SSOT への反映**: §6 採用しなかった代替案セクション

### 7.3 Kubernetes Enhancement Proposals (KEP)

- **学び**: 各 KEP に "Alternatives considered" 必須 + Production Readiness Review
- **本 SSOT への反映**: §4 大規模に Rust RFC 8 章採用 (KEP に近い)

### 7.4 Tauri / Bun の Discussions 文化

- **学び**: GitHub Discussions で事前研究 → Issue 起票
- **本 SSOT への反映**: 棄却 (軸 B4)。`docs/reference/` で git 履歴管理する方が Pre-PMF にフィット

---

## 8. Unresolved questions (Spike escalation 対象)

### 8.1 dogfood 観察期間 (本 SSOT 運用開始後 5 件)

- 観察対象: weight 判定の妥当性 / Issue 本文 inline 要約の十分性 / reference link 参照率
- 観察結果に応じて Issue B (S-2 統廃合) の優先度を上下

### 8.2 軽量 research の最低スレッショルド

- 「カルーセル 1 行修正」と「ボタン文言 1 語修正」を同じ軽量で扱うか、後者は research 不要かを dogfood で判断

### 8.3 retroactive 適用範囲

- 既存 open Issue (約 50 件) に本 SSOT を retroactive 適用するか、新規起票のみ適用するか
- PO 判断: **新規起票のみ** (本 Issue #2088 PO 確認 #4 で確定)

---

## 9. Acceptance Criteria への対応マッピング

| AC | 対応セクション | 検証手段 |
|---|------------|--------|
| AC1 | `docs/reference/deep-research-request-methodology.md` 新規作成 | `test -f && wc -l ≥ 100` |
| AC2 | 本ファイル (`01-research-issue-templating-and-doc-consolidation.md`) 新規作成 | `test -f && wc -l ≥ 280` |
| AC3 | `docs/sessions/po-session.md` タスク 4 追加 (§4 価値判定 3 段階 + §6 PO 確認 4 段階) | `grep` |
| AC4 | po-session.md 末尾の relative link | `grep` 2 件 |
| AC5 | `tmp/research/*.md` 削除 (既に存在しないので no-op) | `! test -e` |
| AC6 | 役割境界 SSOT 表に Deep Research 行追加 | `grep` |

---

## 10. 関連ドキュメント

| ドキュメント | 用途 |
|---|---|
| `docs/reference/deep-research-request-methodology.md` | 方法論 SSOT (本 reference の前提) |
| `docs/sessions/po-session.md` §タスク 4 | 本 SSOT の運用手順 |
| `docs/decisions/0003-issue-quality-standard.md` | Issue 品質 ADR |
| `docs/decisions/0010-pre-pmf-scope-judgment.md` | Pre-PMF scope ADR |
| `docs/decisions/0014-labels-i18n-mechanism.md` | OSS 先調査の代表事例 ADR |
| `.claude/skills/issue-triage/SKILL.md` | 起票フェーズゲート (Issue B で本 SSOT を統合予定) |
| `.github/ISSUE_TEMPLATE/process_ticket.yml` | Issue C (#2090) で No-gos / weight 追加予定 |

---

## 11. 出典 (1 次ソース 13 件)

| # | ソース | URL / 文献情報 |
|---|------|--------------|
| 1 | GitHub Issue Forms syntax | https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema |
| 2 | Rust RFCs README + 0000-template | https://github.com/rust-lang/rfcs |
| 3 | Python PEP 1 (PEP Purpose and Guidelines) | https://peps.python.org/pep-0001/ |
| 4 | Kubernetes Enhancement Proposals | https://github.com/kubernetes/enhancements |
| 5 | Anthropic Constitutional AI (Bai et al. 2022) | https://arxiv.org/abs/2212.08073 |
| 6 | "Software Engineering at Google" (Winters et al. 2020) Ch.10 | O'Reilly Media, ISBN 978-1492082798 |
| 7 | "Design Docs at Google" (Malte Ubl 2019) | https://www.industrialempathy.com/posts/design-docs-at-google/ |
| 8 | Cochrane Handbook (PICO 由来) | https://training.cochrane.org/handbook |
| 9 | Cooke et al. 2012 (SPIDER) | Qual Health Res 22(10):1435-1443 |
| 10 | "The Pyramid Principle" (Minto 1973) | ISBN 978-0273710516 |
| 11 | "Working Backwards" (Bryar & Carr 2021) | ISBN 978-1250267597 |
| 12 | "Shape Up" (Ryan Singer 2019) | https://basecamp.com/shapeup |
| 13 | "Extreme Programming Explained" (Kent Beck 1999) | ISBN 978-0321278654 |
