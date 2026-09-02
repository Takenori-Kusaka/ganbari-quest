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
| **CI** | `pr-ac-verification-check.yml`（マップ欠落検出）/ `ac-audit-monthly.yml`（月次監査）。**Issue close 時に検証する層は持たない**（§4） |

初期は warn-only で導入、2 週間の実測後に block 化する。

**2026-07-30 改訂 — 書式検査を advisory に降格し、証跡の真正性検査を hard-fail で維持する**:

| 検査 | 何を見るか | 2026-07-30 以降の扱い |
|---|---|---|
| AC マップの体裁 (`check-ac-verification-map`) | 4 列そろっているか / 空セルがないか | **advisory (warn)** — merge を止めない |
| `verify-pr-head` | PR body が「対応済み」と主張する修正が **HEAD に実在するか** | **hard-fail 維持** |
| `check-ss-blob-sha-uniqueness` | Before / After SS が同一 blob の**偽装**でないか | **hard-fail 維持** |

**AC の内容妥当性は AI レビュアが担う**。機械が守るのは「主張と実体が一致していること」だけに絞る。

根拠: 書式検査は統合 PR #3995 を 4 日間 BLOCK した一方、実体 (57/60 check green) は満たされていた。体裁の不備で merge を止めても顧客リスクは 1 件も減らず、止まった分だけ他の修正の到達が遅れる。逆に「body の主張が HEAD に存在しない」「SS が同一画像の使い回し」は、レビュー全体の前提を崩すため機械で止める価値がある (ADR-0061 原則 2 の適用対象限定と同じ線引き)。

### 3. チェック項目（全 PR）

- [ ] CSS: routes 配下に hex カラー / Tailwind デフォルト色のハードコードがない
- [ ] テスト: 新規 / 変更コードに対応するテストがある
- [ ] 設計書: DB / API / UI 変更があれば `docs/design/` が更新されている
- [ ] 型安全: `as any` / non-null assertion の不適切な使用がない
- [ ] CLAUDE.md: プロジェクトルールへの違反がない

### 4. Issue close 時に AC を検証する機械 gate は置かない（#2351 → #4322 で撤去、#4624）

**close 経路によらず、Issue を close したあとに AC を検証して auto-reopen する CI は存在しない。** AC 検証は §2 の 2 層（Issue テンプレ / PR テンプレ + `pr-ac-verification-check.yml`）と、**close する人のレビュー**で担保する。手動 close (`gh issue close` / GitHub UI) は機械的に止まらないので、**AC 未達のまま close できてしまう**ことを前提に運用する。

close 時 gate を持たない理由:

- PR `closes #N` の auto-close では、Issue body の generic Done check (`- [ ]`) を GitHub 側が更新しない。**未チェック AC の残存は「未達」ではなく「GitHub が触らないだけ」**であり、それを根拠に reopen すると常に誤判定する
- PR 側の Ready チェックリスト (`.claude/skills/dev-open-pr/templates/pr-body-default.md`) で merge 前に AC 検証済み（pre-ready PASS / CI 緑 / SS 確認 / 設計書同期）。close 時の再検証は**二重検証**
- 実測として、未チェック AC を検出して reopen する旧 gate は毎セッション数十件の reopen ループを生んでいた（#2351 観測時点で 20 件 × 3 周以上）

#2351 は close 経路（`ClosedEvent.closer` 種別）を判定して auto-close を skip する形で reopen ループを止めたが、**残った検証対象は手動 close だけ**であり、その手動 close も上記のとおり PR 層で検証済みか、そもそも AC の中身を機械が読めないかのどちらかだった。gate 自体の価値が無くなったため #4322 で workflow ごと撤去し、判定純粋関数も #4624 で削除した（`.github/CLAUDE.md` §Issue close 時の AC 検証 が現行の運用 SSOT）。

### 例外手続き

PR 本文に `<!-- ac-verification-skip: <理由> -->` を記述すれば `pr-ac-verification-check.yml` を skip 可能（監査ログに記録）。

## 結果

- プロセス作業（CI 待ち、コンフリクト解消）の圧力下でもレビュー品質を犠牲にしない
- 「CI green = 品質保証」という誤解を排除
- AC の主張と実体の不一致（`verify-pr-head` / `check-ss-blob-sha-uniqueness`）は PR 層で機械的に止まる（#1088 再現防止）。**AC の中身が未達のまま close されることは機械では止まらない**（§4）

## 関連

- ADR-0002（Critical 修正品質ゲート）— 5 年齢モード検証 + スクリーンショット必須
- ADR-0003（Issue 起票品質）— AC が測定可能であること
- ADR-0005（テスト品質 ratchet）— カバレッジ閾値の自動 check
