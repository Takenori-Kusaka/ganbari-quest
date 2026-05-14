---
name: Issue Triage
description: Use when creating a new GitHub Issue. Forces Pre-PMF bias check, marketing/legal/finance/customer perspectives, and root cause analysis before submission.
---

> **親 SSOT**: [PO Session — Goal 1](../../../docs/sessions/po-session.md) / **関連 Skill**: [LP Review (Goal 2)](../lp-review/SKILL.md)

# Issue 起票フェーズゲート

新しい Issue を起票する前に、以下の 7 ステップを順番に実行してください。

## ステップ 1: 根本原因の特定（ADR-0003）

- 症状ではなく原因を特定する
- 「X が壊れている」ではなく「Y の処理で Z が考慮されていないため X が発生」
- 再現手順を明記

## ステップ 1.5: SSOT namespace 重複検査（#2061、ADR-0045）

Issue body draft 内に `XXX_LABELS` / `XXX_TERMS` 形式の namespace 名が含まれる場合、
`src/lib/domain/{terms,labels}.ts` および open Issue との scope 重複を機械的に検査する。

**起票事故の前例**: PR #2041 (#1898) / PR #2044 (#1896) で同名 `LP_FAQ_TERMS` を別 scope で
2 回 export しようとして TypeScript duplicate identifier conflict が発生 (Issue #2061)。

```bash
# Issue body を tmp/issue-bodies/<slug>.md に Write tool で保存した直後に実行
node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/<slug>.md

# open Issue も同時に検索 (gh CLI 認証済みが前提)
node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/<slug>.md --check-open-issues
```

衝突検出時の対応指針 (script 出力にも含まれる):

- **A) scope 統合**: 既存 namespace を superset として採用、本 Issue を既存 Issue にマージ
  (重複側を close / `blocked_by` で関連付け)
- **B) 命名衝突回避**: 新 namespace 名を変更 (例: `LP_FAQ_TERMS` → `LP_FAQ_DISCLAIMER_TERMS`)
- **C) 意図的な拡張**: 既存 namespace に key を追加するだけなら scope 重複は誤検知。
  Issue body に「既存 `XXX_TERMS` の key 追加のみ」と明記して進める

## ステップ 2: Pre-PMF バイアスチェック（ADR-0010）

| 質問 | 回答 |
|------|------|
| 今すぐユーザーが困っていることか？ | Yes/No |
| サインアップ・課金・継続率に直結するか？ | Yes/No |
| 放置すると開発速度が 50% 以上落ちるか？ | Yes/No |

3 つ全て No → Priority: Low 以下。エンジニアバイアスで過大評価していないか再考。

## ステップ 3: マーケ/Growth 視点

- サインアップ目標（V2MOM Q2: 20名/月）への貢献度は？
- LP（site/）への影響は？
- ユーザー獲得導線に変更が必要か？

## ステップ 4: 法務/コンプライアンス視点

- COPPA 準拠に影響するか？（13歳未満の子供のデータ）
- 特商法・プライバシーポリシーの更新が必要か？
- 利用規約の変更が必要か？

## ステップ 5: 財務視点

- AWS コスト影響は？（docs/design/12-事業計画書.md Year 1 原価枠を参照）
- 新しい外部サービス（API課金など）を追加するか？
- aws ce get-* は実行禁止（$0.01/回課金）。月次レポートを参照

## ステップ 6: 仮想顧客レビュー

以下のペルソナの視点で評価:
- **3歳児の親**: この変更で子供の活動がより楽しくなるか？
- **小学生の親**: 管理画面が使いやすくなるか？
- **中学生本人**: 自分で使いたいと思うか？

## Issue テンプレート

```markdown
## 背景
[なぜこの Issue が必要か]

## 根本原因
[症状ではなく原因]

## 解決策
[具体的な対策]

## Acceptance Criteria
- [ ] [検証可能な条件 1]
- [ ] [検証可能な条件 2]

## Pre-PMF チェック結果
- 顧客価値: [Yes/No + 理由]
- 事業推進: [Yes/No + 理由]
- 技術負債: [Yes/No + 理由]
```

## Issue 起票時の Write tool 例外（#1172 / #1804）

`gh issue create` で本文を渡すときは **`--body-file` 必須**（HEREDOC 禁止 — #1172）。
そのため Write tool / `cat > ... << 'EOF'` で **一時ファイル `tmp/issue-bodies/<slug>.md` を作成することが許容される**。
これは sub-agent ハーネスの「report files / summary を書くな」一般原則の **明示的例外**。

```bash
# 1. 本文を Write tool または cat で tmp/issue-bodies/ に保存
#    例: tmp/issue-bodies/cron-secret-rotation.md
# 2. (#2061) SSOT namespace 重複検査 — body 内に XXX_LABELS / XXX_TERMS があれば実行
node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/<slug>.md --check-open-issues
# 3. 起票
gh issue create --title "..." --label "..." --body-file tmp/issue-bodies/<slug>.md
# 4. 起票成功を確認してから削除（古い draft が混ざらないように）
rm tmp/issue-bodies/<slug>.md
```

`tmp/` は `.gitignore` 配下のためコミットされない。findings / analysis の report file とは別物として扱う。
詳細は `docs/sessions/po-session.md` §「Issue 起票の技術手順（HEREDOC 禁止 — #1172）」参照。
