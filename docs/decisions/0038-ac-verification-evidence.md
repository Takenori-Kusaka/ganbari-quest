# 0038. AC 検証エビデンス必須化 (Issue close gate + PR AC 検証マップ)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-18 |
| 起票者 | Takenori Kusaka |
| 関連 Issue | #1165 |

> **番号に関する注記**: 本 ADR は #1165 本文で「ADR-0036」として予告されたが、起票後に ADR-0036 (`marketplace-public-access.md`) / ADR-0037 (`labels-ssot-principle.md`) が先に採番されたため、空き番号 **0038** を採用した。Issue 本文の文字列は参考情報として扱う。

## コンテキスト

Issue クローズ時に Acceptance Criteria (AC) が検証されず、「実装した（つもり）」で Done 扱いされる事案が再発している。

### 再発の証跡

- **#1088** (2026-04-17 closed) — LP 情報設計リストラクチャ。Mobile ≤ 15,000px / 禁止用語ゼロ の AC が検証されず closed。2026-04-18 時点の Mobile 実測値で残存が発覚 → #1163 で再対応が必要になった。
- **#701** (2026-04-12 closed) — HP 活動パック年齢/性別プリセット拡充。UI 男女フィルタが AC から漏れ、UI に反映されないまま closed。
- **#572** — 後方互換リネーム。AC に「旧 URL redirect」が無く、リリース後に 404 が発生 (ADR-0001 の遠因)。

### 構造的欠陥

1. **Issue テンプレ**に AC 検証手段フィールドが存在しない → 人間の善意依存
2. **PR テンプレ**に「どの AC をどう検証したか」の証跡セクションが無い → スクリーンショット添付のみで pass する
3. **CI** は AC 充足を機械検証しない → `pr-ui-check.yml` はスクリーンショットの存在しか見ない
4. **セッション運用**に AC 照合ステップが明文化されていない

ADR-0010 (Issue 完了品質基準) は存在するが機械強制されないためザル状態。

## 検討した選択肢

### 選択肢 A: ADR 追加のみ (人間の規律に依存)

- メリット: 導入コスト ゼロ
- デメリット: ADR-0010 と同じ轍を踏む。#1088 / #701 / #572 で既に証明された失敗パターン

### 選択肢 B: CI による機械強制 (採用)

- メリット: PO 1 人体制でもルール遵守が保証される。再発コスト（再 open + 再実装）を未然に削減
- デメリット: false positive を出すと開発速度を落とす → 初期は **warn-only** で導入、実測後に block 化

### 選択肢 C: 全 Issue への遡及適用

- メリット: 過去チケットの品質も底上げ
- デメリット: 1000 件超の Issue への再チェックは現実的でない → 新規クローズにのみ適用

## 決定

**選択肢 B** を採用する。AC 検証を以下の 3 層で機械強制する:

### 層 1: Issue テンプレ (起票時点で検証計画を義務化)

- `.github/ISSUE_TEMPLATE/dev_ticket.yml` に新フィールド `ac-verification-plan` (required)
- `.github/ISSUE_TEMPLATE/feature_request.yml` に `goals` (AC) と `ac-verification-plan` (required)
- AC は **測定可能な数値・文字列・ファイルパス** で書くこと。「〜が改善される」等の抽象表現は不可

### 層 2: PR テンプレ (PR が AC 検証エビデンスを必ず持つ)

- `.github/PULL_REQUEST_TEMPLATE.md` に新セクション **「AC 検証マップ (ADR-0038)」**
- マークダウン表形式: `| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |`
- 「AC は自己確認用で全部 [x] を狙うものではありません」のあとに **「ただし AC 検証マップは必ず全行を埋めること」** を追記

### 層 3: CI (機械検証)

1. **`.github/workflows/pr-ac-verification-check.yml`** — PR 本文から「AC 検証マップ」を抽出し、`closes #N` Issue の AC 行数と一致するか検証。マップ内の「結果 / エビデンス」列の空欄を検出
2. **`.github/workflows/issue-close-gate.yml`** — Issue クローズ時に AC 未チェック (`- [ ]`) が残っていたら自動 reopen + `quality:ac-incomplete` ラベル付与
3. **`.github/workflows/ac-audit-monthly.yml`** — 月次 cron で直近 30 日の close Issue を監査し、未チェック率が閾値超過なら Epic Issue を自動起票

**初期リリースでは全ワークフローを warn-only**（`continue-on-error: true` または `exit 0` + `::warning::`）で開始し、2 週間の実測後に block 化する。

### 例外手続き

PR 本文に明示的に `<!-- ac-verification-skip: <理由> -->` を記述すれば `pr-ac-verification-check.yml` を skip できる。ただし監査ログに記録される。

## 結果

### 変わること

- Issue 起票時に「検証計画」が強制される → 「動作確認します」のような曖昧 AC が減る
- PR 本文に AC → 検証手段 → エビデンスの 1:1:1 表が必須 → Reviewer が照合しやすくなる
- Issue クローズが機械判定される → #1088 再現防止

### トレードオフ

- 既存 Issue テンプレが肥大化 (+2 フィールド)
- 月次 audit Issue が自動増加 → `quality:audit-pending` ラベルで隔離
- false positive 対応の運用コスト → 初期 warn-only で許容

### 補強する ADR

- ADR-0010 (Issue 完了品質基準) — 機械強制化
- ADR-0018 (Issue 起票は根本原因特定) — AC 検証計画を必須化
- ADR-0021 (デプロイ検証ゲート) — 本番確認と AC 検証を混同しないため並存

本 ADR をもって #1088 / #701 / #572 のような「AC 検証を経ずに close する」事案は mergeable でなくなる。
