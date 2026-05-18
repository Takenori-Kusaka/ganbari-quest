# Forbidden Escape Language SSOT (PR body / commit message / Issue body)

> **Warning**: このドキュメントは現在の実装と乖離しており陳腐化（Deprecated）しています。



> 関連 ADR: [ADR-0047 Demo / 本番 UI Contract SSOT](0047-demo-prod-ui-contract-ssot.md) §決定 Q8
> 関連 memory: `feedback_no_escape_to_haribote_implementation.md` / `feedback_demo_prod_ui_unification_blocker.md`
> 関連 Issue: #2097 (6 回目の demo/本番統合要求 + 深層調査 §6 Q8)

## 目的

過去 7 回 (Issue #531 / #561 / #562 / #563 / #566 / #2069 / PR #2099) で発生した **shim / haribote 完了報告** の構造的原因は、Dev / Reviewer Agent が「Tier N で統合」「POC scope」「等価性維持」等の **逃げ語** で issue close / PR merge を正当化してきたこと。

本 SSOT は禁止語リストを文書として格上げし、Phase 5 で `scripts/check-no-escape-language.mjs` による機械検証を CI 組込する。本 SSOT 自体は Phase 1 完了時点で参照可能 (機械検証は Phase 5 で起動)。

## 禁止語リスト (12 語、深層調査 §6 Q8 確定版)

PR body / commit message / Issue body / comment / コードコメント 等の **対人説明テキスト** で本リストの語を検出した場合、**機械的に PR fail / Issue close 拒否**する。

### カテゴリ 1: scope / Tier / POC 逃げ語

| # | 語 | 過去の使用例 | 禁止理由 |
|---|---|---|---|
| 1 | **「Tier N で統合」**「Tier 3 で統合」「次 Tier」 | #566 / #2069 R2 | "Tier" を口実に統合を無期限延伸、未着手放置の温床 |
| 2 | **「POC scope」**「POC の範囲」「POC 範囲外」 | #2069 R5 / PR #2099 | "POC" を口実に並行ファイル残存を正当化 |
| 3 | **「scope 外」**「PR scope 外」「本 PR scope に非該当」 | #561 / #562 / 多数 | 大きすぎる scope の問題を別 Issue 化して放置 |

### カテゴリ 2: 等価性 / 足場系逃げ語

| # | 語 | 過去の使用例 | 禁止理由 |
|---|---|---|---|
| 4 | **「等価性維持」**「UI 等価性 SS 維持」「ピクセル等価」 | #563 / PR #2099 | SS 一致を「実体不一致でも視覚一致なら OK」と読み替えて shim 維持 |
| 5 | **「足場として」**「足場機構」「足場 PR」 | #566 / #2069 R3 | "足場" の本体実装に到達しないまま完了報告 |
| 6 | **「逆輸入回避」** | PR #2099 R-MAJ-1 | demo 改善を本番に逆輸入することを避けて demo 側のみ修正 |
| 7 | **「demo 寄せ統合」**「demo に揃える」 | PR #2099 | 本番機能を退行させる方向の統合 (PO 直接禁止) |
| 8 | **「snapshot patch」**「snapshot 切出し」「snapshot 修正」 | #2097 PO 指摘 | UI snapshot を切出して patch する haribote パターン |

### カテゴリ 3: 時間先送り逃げ語

| # | 語 | 過去の使用例 | 禁止理由 |
|---|---|---|---|
| 9 | **「とりあえず」**「とりあえず動く」「とりあえず最小」 | 多数 | 「動く」を品質として誤認、根本対策放棄 |
| 10 | **「一旦」**「一旦置く」「一旦最小」 | 多数 | 同上 |
| 11 | **「次フェーズで」**「次 phase で」「次 PR で」 (Issue / PR 紐付け明示なしの場合) | 多数 | 起票なしの先送りは永久放置の温床 |
| 12 | **「demo と本番の UI 差分は許容範囲」** | 7 回連続 | 「許容範囲」の contract 不在を隠蔽する逃げ語、divergence 検出を構造的に阻む |

## 救済策 (深層調査 §6 Q8 確定、PO Q13 承認済)

禁止語を **真に使う必要がある場合**は以下を必須:

1. **ADR を新規起票**して禁止語使用の正当性を技術文書として残す (例: 「scope 外」と書くなら scope 限定の意思決定 ADR が同 PR にある)
2. **または** GitHub Issue を新規起票し、以下 3 項目を Issue body に明記:
   - **due date** (YYYY-MM-DD で具体的日付。「将来」「いずれ」禁止)
   - **責任 owner** (assignee 必須、`@<github-handle>` 形式)
   - **完了判定基準** (機械検証可能な条件、例: ファイル削除確認 grep / E2E test PASS)
3. **PR body の §レビュー依頼事項** に「禁止語使用 → 救済策: Issue #NNNN (due YYYY-MM-DD, owner @xxx)」を必ず明記

救済策なしで禁止語を使うと、Phase 5 で実装する `scripts/check-no-escape-language.mjs` が PR fail させる。

## 検出範囲 (Phase 5 で実装、Phase 1 では文書 SSOT のみ)

`scripts/check-no-escape-language.mjs` が以下を検査:

- PR body (`gh pr view --json body`)
- 全 commit message (`git log <base>..<head> --format=%B`)
- 当該 PR が close する Issue body (`gh issue view --json body`)
- 当該 PR が変更する `.md` ファイル新規行 (歴史的 markdown は除外、新規追加コミット差分のみ)

**コード内コメント** (`.svelte` / `.ts` / `.js`) は対象外 (false positive 多発を回避、メインの逃避ベクターは対人説明テキスト)。

## Phase 1 で本 SSOT が達成する効果

- 禁止語が **文書として明示**されたため、Phase 1 完了直後から Reviewer (人間 / Agent) が PR レビュー時にチェックリストとして使える
- Phase 2-5 の各 PR レビューで「ADR-0047 + 禁止語 SSOT 整合」を AC 検証マップに含めることで、機械検証なしでも禁止語使用が議論の俎上に上がる
- Phase 5 で機械検証 (`check-no-escape-language.mjs`) を CI gate に追加 → 構造的阻止に昇格

## 関連 SSOT

- 失敗 memory (ユーザーローカル、チーム共有不可):
  - `feedback_no_escape_to_haribote_implementation.md` — 困難時の はりぼて実装逃避禁止 (本 SSOT の母体)
  - `feedback_demo_prod_ui_unification_blocker.md` — 7 回失敗パターン分析
- ADR:
  - ADR-0047 (本 SSOT の意思決定背景)
  - ADR-0001 (設計書 SSOT) — 仕様が書かれていなければ存在しない
  - ADR-0003 (Issue 品質) — 根本原因 + 構造的解決
  - ADR-0046 (Service Interface + Context DI) — 本 SSOT が守ろうとしている既存基盤

## 改訂履歴

- 2026-05-14: Phase 1 (Issue #2097) で初版作成。禁止語 12 語、救済策、検出範囲 (Phase 5 で機械検証起動) を確定
