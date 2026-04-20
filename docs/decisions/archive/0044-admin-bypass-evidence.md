# ADR-0044: admin bypass merge 証跡記録運用

> **archived (2026-04-20)**: no longer active-primary, kept for historical reference (#1262 sub-B)


- **Status**: Accepted
- **Date**: 2026-04-20
- **Issue**: #1201
- **Related**: ADR-0005（Critical 修正の品質ゲート）, ADR-0038（AC 検証エビデンス必須化）

## Context

PO 1 人体制（#964 Postmortem）の下で、`required_approving_review_count=1` を admin 権限で
素通りさせる admin bypass merge が常態化している。直近の UI-heavy PR 6 件
（#1143 / #1144 / #1156 / #1176 / #1177 / #1178）は **すべて reviewDecision が空**（admin bypass）で
マージされた。

結果として以下が起きている:

- 事後レビュー（#1201 契機）で初めて発見される品質問題の残留
  - 例: #1156 の demo banner 写り込み、#1144 の work lost
- 「いつ / 誰が / どの観点で OK を出したか」が PR から追えない
- ADR-0038（AC 検証エビデンス必須化）の精神に反する

admin bypass を廃止するのは PO 1 人体制では非現実的（1 PR ごとに 1 営業日の遅延）。
**admin bypass を許容しつつ、証跡を PR 本体に強制する** 運用が妥当。

## Decision

admin bypass merge を行うときは、**PR 本文または merge 前コメントに Self-Review 証跡
セクションを必ず記載する**。

### 証跡テンプレート（必須項目）

```markdown
## Self-Review 証跡 (admin bypass)

### 確認した観点
- [ ] Issue AC 全項目突合
- [ ] UI/UX 禁忌事項（DESIGN.md §9）セルフチェック
- [ ] 並行実装ペア同期確認
- [ ] テスト同梱
- [ ] 設計書同期
- [ ] セキュリティ・プライバシー影響無し

### 添付スクリーンショット
（主要変更画面の before/after or 該当なしの理由）

### 実機確認ログ
（`npm run dev:cognito` 手動検証ログ 等）
```

### 強制機構

1. **`scripts/check-admin-bypass-evidence.mjs`** — GitHub Actions から merge 後 1 時間以内に起動
   し、直近 merge された PR の `reviewDecision` が空の場合、PR 本文に「Self-Review 証跡」
   セクションが含まれているかを検証する。
2. **不備時の bot コメント** — セクションが無い PR には `github-actions[bot]` が追記要求
   コメントを投稿する（block はしない。既成事実の merge を取り消すことは運用上困難なため、
   **事後追記を促す**）。
3. **月次レポート** — cron で admin bypass merge PR 数 / 証跡欠落数を集計し `/ops` ダッシュボード
   に掲示する。過剰運用（月 10 件超）は PR size 削減 / AI レビュアの優先依頼等、別対策の起点。

### 免除対象

- Dependabot / renovate 等の bot 作成 PR
- `docs/` のみを変更した 50 行未満の typo 修正 PR
- hot fix（`priority:critical` かつ `type:fix`）は事後追記 OK（merge を遅らせない）

## Consequences

### 正の影響

- レビュー観点が PR 本体に残り、事後レビュー / 遡及調査が可能になる
- 月次レポートで admin bypass の頻度が可視化され、運用改善の判断材料になる
- ADR-0038 の AC 検証エビデンス精神と一貫する

### 負の影響

- admin bypass merge 時に PR 本文編集のオーバーヘッド（推定 2-5 分）が発生
- 証跡欠落を機械的にブロックできない（既成事実の merge を revert する運用は現実的でない）
  → bot コメントで事後追記を促す運用に留める

### 関連 ADR との関係

- **ADR-0005**（Critical 修正の品質ゲート）: 5 条件のうち「Acceptance Criteria を全項目完了」
  「スクリーンショット添付」と本 ADR の証跡項目が重なる。Critical 修正時は ADR-0005 が優先
  （より厳格）、それ以外の admin bypass は本 ADR でカバー。
- **ADR-0038**（AC 検証エビデンス必須化）: Issue close 時の AC verification map と並列の
  運用層。PR merge 時点の証跡が本 ADR、Issue close 時の証跡が ADR-0038。

## References

- Issue #1201（本 ADR の契機）
- Issue #964 / Postmortem #962（PR review 必須化の経緯）
- 事後レビュー対象: #1143 / #1144 / #1156 / #1176 / #1177 / #1178
