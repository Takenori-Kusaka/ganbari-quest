# 0004. レビュー & AC 検証品質

- **Status**: Accepted
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265
- **統合元**: 旧 ADR-0006 + ADR-0038（本 PR で削除、詳細は git 履歴）

## コンテキスト

> 旧 ADR-0006（PR レビュー指摘を文書化）と ADR-0038（AC 検証エビデンス必須化）を統合。ADR 10 枠再構成（#1262）の一環。

- **PR レビューの形骸化**: 2026-04-09 に 8 件の Draft PR を一括マージした際、コードレベルのレビュー指摘を一切出力せず全件マージ。結果として CSS ハードコード違反 3 件 / テストカバレッジ欠落 3 件 / 設計書未更新 6 件が本番デプロイされた（#613-#616, #619）。
- **AC 検証の欠落**: #1088（LP 情報設計）/ #701（活動パック）/ #572（URL リネーム）で AC 未検証のまま close → 事後発覚で再対応（#1163 等）。

構造的欠陥: Issue テンプレに AC 検証計画がない、PR テンプレに「どの AC をどう検証したか」の証跡がない、CI が AC 充足を機械検証しない。

## 決定

### 1. 全 PR レビューで指摘事項を文書化する

| Severity | 説明 | マージ条件 |
|----------|------|-----------|
| **Critical** | セキュリティ脆弱性 / データ損失 / 本番障害直結 | 修正必須・マージ不可 |
| **High** | コーディングルール違反 / テスト欠落 / 設計書未更新 | 修正必須・マージ不可 |
| **Medium** | パフォーマンス懸念 / 可読性改善 | 修正推奨・follow-up 許容 |
| **Low** | スタイル提案 / コメント追加 | 任意・マージ可 |

指摘なしの場合も `✅ Reviewed: lint rules, CSS tokens, test coverage, design doc sync / No findings.` と明記し「レビューしたが指摘なし」と「レビューしていない」を区別する。

### 2. AC 検証の 3 層機械強制

| 層 | 強制機構 |
|----|---------|
| **Issue テンプレ** | `ac-verification-plan` (required)。AC は測定可能な数値・文字列・ファイルパスで書く |
| **PR テンプレ** | 「AC 検証マップ」セクション: `\| AC 番号 \| AC 内容 \| 検証手段 \| 結果 / エビデンス \|` の全行を埋める |
| **CI** | `pr-ac-verification-check.yml`（マップ欠落検出）/ `issue-close-gate.yml`（未チェック AC 残存時に auto-reopen）/ `ac-audit-monthly.yml`（月次監査） |

初期は warn-only で導入、2 週間の実測後に block 化する。

### 3. チェック項目（全 PR）

- [ ] CSS: routes 配下に hex カラー / Tailwind デフォルト色のハードコードがない
- [ ] テスト: 新規 / 変更コードに対応するテストがある
- [ ] 設計書: DB / API / UI 変更があれば `docs/design/` が更新されている
- [ ] 型安全: `as any` / non-null assertion の不適切な使用がない
- [ ] CLAUDE.md: プロジェクトルールへの違反がない

### 4. issue-close-gate は手動 close のみを検証対象とする（#2351）

`issue-close-gate.yml` の AC 検証 gate は **手動 close** (`gh issue close` / GitHub UI) のみを検証対象とし、**PR/Commit 経由 auto-close** は skip する。理由:

- PR `closes #N` で auto-close される際、Issue body の generic Done check (`- [ ]`) は GitHub 側が自動更新しない
- 一方 PR 側の Ready for Review チェックリスト (`.claude/skills/dev-open-pr/templates/pr-body-default.md`) で **PR merge 前に既に AC 検証済み** (pre-ready PASS / CI 緑 / SS 確認 / 設計書同期)
- gate が PR auto-close でも未チェック AC を検出して reopen する旧挙動は **二重検証** であり、毎セッション数十件の reopen ループを生んでいた (本セッションだけで 20 件 × 3 周以上)

判定は `scripts/issue-close-gate-skip-judge.mjs` 純粋関数で行い、GitHub GraphQL `timelineItems(itemTypes: [CLOSED_EVENT])` で直近 ClosedEvent の closer 種別を取得:

| closer 種別 | 例 | 対応 |
|---|---|---|
| `PullRequest` | PR `closes #N` 経由 | skip (PR Ready gate で検証済み) |
| `Commit` | squash merge commit message の `closes #N` | skip (PR 経由と同等) |
| `null` | 手動 close (`gh issue close` / GitHub UI) | AC 検証 gate 通す |
| (wontfix / duplicate label) | 任意 | 従来通り skip |

unit test 11 ケース: `tests/unit/github/issue-close-gate-skip-judge.test.ts`。

### 例外手続き

PR 本文に `<!-- ac-verification-skip: <理由> -->` を記述すれば `pr-ac-verification-check.yml` を skip 可能（監査ログに記録）。

## 結果

- プロセス作業（CI 待ち、コンフリクト解消）の圧力下でもレビュー品質を犠牲にしない
- 「CI green = 品質保証」という誤解を排除
- `closes` 時の AC 未達が mergeable でなくなる（#1088 再現防止）

## 関連

- ADR-0002（Critical 修正品質ゲート）— 5 年齢モード検証 + スクリーンショット必須
- ADR-0003（Issue 起票品質）— AC が測定可能であること
- ADR-0005（テスト品質 ratchet）— カバレッジ閾値の自動 check
