---
name: Issue Triage
description: Use when creating a new GitHub Issue. Forces Pre-PMF bias check, marketing/legal/finance/customer perspectives, and root cause analysis before submission.
---

> **親 SSOT**: [PO Session — Goal 1](../../../docs/sessions/po-session.md) / **関連 Skill**: [LP Review (Goal 2)](../lp-review/SKILL.md)
>
> **本 SKILL の位置付け (Issue #2089)**: Issue 起票運用の **SSOT**。Pre-PMF check / HEREDOC 禁止 / OSS 先調査 / research 添付 の 4 領域は本 SKILL に集約し、他文書 (`docs/sessions/po-session.md` / `.github/CLAUDE.md` / `.claude/skills/lp-review/SKILL.md`) からは link 参照のみとする。ADR-0003 / ADR-0010 / ADR-0014 は背景・根拠の reference として残置 (本 SKILL の各セクションから refer)。

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

## Pre-PMF check

Issue 起票時の Pre-PMF バイアスチェック (ADR-0010 §3 を SSOT として 4 質問版に統一、#2089)。
旧 3 質問版 (本 SKILL に過去存在) は本 §で退役。

### 4 質問チェックリスト (ADR-0010 §3 準拠)

1. **ペルソナ紐付け**: どのペルソナ（P1 / P2）のどの課題を解決するか明記したか
2. **V2MOM 紐付け**: V2MOM の Method（M1〜M4）に紐づけたか
3. **20 名/月 到達自問**: この機能がなくても Pre-PMF サインアップ 20 名/月に到達できるか
   - 到達できる → `priority:medium` 以下（どれほど欲しくても high 以上を付けない）
   - 到達できない → `priority:high` 以上 + 本文に「なぜ到達できないか」の根拠
4. **Growth/Marketing 混入**: 直近に Growth / Marketing / Onboarding 系 Issue を 1 本以上起票したか
   （連続する新機能 Issue はバイアスの兆候）

根拠なしの `priority:high` は、レビュワーが `medium` 以下に降格する。

### 3 バケット判断 (ADR-0010 §1)

| バケット | 内容 | 例 |
|---------|------|-----|
| **A: 実装 + 訴求** | 顧客獲得インパクト明確 + LP 訴求有効 | 自動スリープ、使用時間可視化、年齢移行対応 |
| **B: LP 訴求のみ** | 既存機能で代替可、LP で安心感を提供 | 撤退コスト説明、サービス終了時データ扱い説明 |
| **C: 沈黙** | LP 掲載で新規不安誘発リスク > 便益 / YAGNI | 虚偽申告検知アルゴリズム、汎用監査ログ基盤、ML 検出 |

デフォルトは **沈黙（C）**。A / B に上げるには明確な顧客獲得インパクトの根拠を要する。

### 免除 (ADR-0010 §6)

- `priority:critical` の bug fix（緊急対応）
- 法務・セキュリティ・コンプライアンス対応（選択の余地なし）
- `type:fix` の既存機能保守

詳細・破棄する過剰設計リスト・PMF 後再評価トリガは ADR-0010 を参照。

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

## OSS 先調査

独自実装が 10 行以上に達しそうな Issue を起票する場合、起票前に **OSS / 確立パターンを最低 2 件**調査する義務がある (ADR-0014 / `docs/decisions/README.md` §「OSS 先調査ルール (#1350)」)。本 §は補佐責務として SKILL に手順を集約。

**ADR-0014 supersede 判定 (#2089)**: ADR-0014 (labels / i18n 機構選定) は本 SKILL の **OSS 先調査の reference 実装例** として残置し、supersede しない。理由: ADR-0014 は具体的 OSS (Paraglide / svelte-i18n / 独自) を 2 件以上比較した実例として歴史的価値があり、本 SKILL から refer することで「比較表の書き方」テンプレートとして機能する。

### 調査手順 (補佐の責務)

1. **npm / GitHub で既存 OSS を 2 件以上探す** — 採用実績 (stars / downloads) / 最終コミット / ライセンス / bundle size
2. **確立パターン (GoF / DDD / Repository 等) の該当有無を確認**
3. **見つからない場合は「探した範囲」を Issue 本文に明記** — どのキーワードで探したか、なぜ該当がなかったか
4. **独自実装が 10 行超えそうなら、先に OSS を探す** (Dev セッション agent ルール、`docs/sessions/dev-session.md`)

### Pre-PMF OSS 導入コスト判断 (ADR-0010 §7)

| OSS 導入タイプ | Pre-PMF 判断 | 例 |
|---------------|------------|-----|
| **軽量・単一責務** (zod / valibot / Toast 系) | 採用推奨 (A / B) | バリデーション・日時フォーマット・i18n runtime |
| **広範 framework 導入** (CMS / 大規模 BaaS) | 沈黙 (C) — ADR 先行必須 | Contentful / Sanity / Strapi |
| **OSS が存在しない領域** | 「探した範囲」を本文に明記 → 独自実装許容 | プロダクト固有ドメインロジック |

「OSS を見もしないまま独自実装」は構造的に禁止。bundle size / 学習コスト / 長期保守性を 3 点セットで評価し、Pre-PMF で過剰な OSS (例: 大規模 BaaS) は採用せず、軽量 OSS > 独自実装の順に優先する。

### Issue 本文への記載パターン

```markdown
## OSS / 確立パターン調査結果

### 選択肢 A: <OSS 名> (npm: <package>, ★<stars>, 最終 commit <date>)
- メリット: ...
- デメリット: ...
- Pre-PMF コスト: 導入工数 / 学習コスト / bundle size / 長期保守性

### 選択肢 B: <OSS 名 or 確立パターン>
- ...

### 選択肢 C: 独自実装 (採用 / 不採用)
- A/B を退けた具体的理由を明記
```

ADR 起票テンプレ (`docs/decisions/README.md` §テンプレート) も同パターンで「選択肢 A / B / C」を強制している (#1350)。

## research 添付

Issue 起票時の Deep Research 添付責務 (#2088 で po-session.md タスク 4 に追加予定 / 本 SKILL に集約)。
PO 補佐 (Claude Code) が起票時に競合・OSS・design pattern の deep research を実行し、調査レポートを Issue 本文 + `docs/reference/` に添付する。

### Deep Research 価値判定の決定木 (3 段階)

| 規模 | 該当例 | 推奨フォーマット |
|------|--------|---------------|
| **軽量** | UI 微修正・カルーセル切替等 | 1-line Pyramid Statement + 3 options 列挙 |
| **中規模** | 新機能・新 OSS 導入等 | Issue Tree + Rust RFC Alternatives + Prior art 抜粋 |
| **大規模** | アーキ変更・障害対応・compliance | Rust RFC full 8 章 + Spike escalation 経路 |

判定根拠の方法論 reference: `docs/reference/deep-research-request-methodology.md` (#2088 で配置予定、未配置時は本 SKILL の本セクションが運用上の SSOT)。

### 研究実行手順

1. **規模判定** → 上記決定木で 3 段階のどれかに分類
2. **実行ツール選択**:
   - 軽量: 補佐の通常リサーチで完結（WebSearch 数回）
   - 中規模: `deep-research-agent` skill / Plan Agent 経由
   - 大規模: `deep-research-agent` + Spike escalation (PO 承認)
3. **出力先ルール**:
   - **Issue 本文 inline 要約 300-500 字** (「OSS / 確立パターン調査結果」セクションに統合可)
   - **詳細レポート**: `docs/reference/NN-research-<topic>.md` (NN は通し番号、命名規則 #2088 で確定予定)
   - **方法論 reference (連番外)**: `docs/reference/deep-research-request-methodology.md`

### PO 確認 4 段階

| 段階 | 確認内容 |
|------|---------|
| フェーズ開始 | research scope (軽量 / 中規模 / 大規模) を PO に提示 |
| prompt 確定前 | research prompt 草案を PO に提示し承認取得 |
| 結果提出時 | research 結果サマリ (300-500 字) を PO に提示 |
| 起票前 | Issue body + research file path を PO に提示し起票許可取得 |

詳細プロセス・補佐降格背景は #2088 / memory `feedback_role_demotion_to_po_assistant.md` 参照。

## ステップ 7: Issue テンプレート

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
- ペルソナ紐付け: [P1/P2 + 課題]
- V2MOM 紐付け: [M1-M4]
- 20 名/月 到達自問: [Yes/No + 理由]
- Growth/Marketing 混入: [直近起票件数]

## OSS / 確立パターン調査結果
[10 行超の独自実装を含む場合は必須、§「OSS 先調査」テンプレ参照]

## Deep Research 添付 (補佐起票時必須、#2088 / 本 SKILL §research 添付)
- 規模: [軽量 / 中規模 / 大規模]
- 詳細レポート: [docs/reference/NN-research-<topic>.md or 「なし」]
```

## HEREDOC 禁止 / `--body-file` 運用

`gh issue create` で本文を渡すときは **`--body-file` 必須** (#1172、bash の EOF 解釈失敗事故あり)。
そのため Write tool / `cat > ... << 'EOF'` で **一時ファイル `tmp/issue-bodies/<slug>.md` を作成することが許容される** (#1804、本 SKILL の例外規定が SSOT)。
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

### PR body での運用も同パターン (#1804)

PR 本文も同様に `gh pr create --body-file tmp/pr-bodies/<slug>.md` 経由。詳細は `.claude/skills/dev-open-pr/SKILL.md` 参照。
