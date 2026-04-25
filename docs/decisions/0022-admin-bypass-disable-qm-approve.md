# ADR-0022: admin bypass 禁止と ganbariquestsupport-lab QM Approve 体制の確立

- **Status**: accepted
- **Date**: 2026-04-25
- **Issue**: #1481

---

## 背景

PO 1 人体制のため `required_approving_review_count=1` を admin bypass で回避するマージが常態化していた。
この運用には以下の構造的問題があった:

1. **ルール回避の常態化**: bypass merge が例外的なフローのはずが通常運用になり、QM レビュー手順が踏まれない PR が main に入り続けた
2. **フォーマットドリフト**: admin bypass 時の self-review comment に関する明示的な規定がなく、`qa-session.md §「QM approve 前の必須実行手順」` とは異なる独自フォーマット（13 観点テーブル等）が使われ始め、既存ルールの適用経路から外れた（#1481 Issue 内 QA 分析補足 Phase 0 参照）
3. **CI gate の限界**: CI はチェックリスト構造や AC マップの「存在」は確認できるが、スクリーンショット内容の品質・横展開調査の実施・AC 達成の真正性は人間が担う必要がある

## 決定内容

### 1. admin bypass を完全に禁止する

GitHub Repository Ruleset `PR_Merge` の `bypass_actors` を空配列（`[]`）に設定し、repo owner を含む全アクターの bypass を禁止する。

### 2. ganbariquestsupport-lab アカウントを QA 専用 approve アカウントとして運用する

- アカウント: `ganbariquestsupport-lab`（ganbari.quest.support@gmail.com で作成）
- コラボレーター権限: Write
- QA セッション起動時の `gh` アクティブアカウントを ganbariquestsupport-lab に設定する
- Takenori-Kusaka（Dev）が PR を作成 → ganbariquestsupport-lab（QA）が approve → squash merge の順で実行する

### 3. approve body フォーマットを `qa-session.md` 手順に統一する

`gh pr review --approve --body` の body には `docs/sessions/qa-session.md §「QM approve 前の必須実行手順」` と同等の内容を必ず記述する:

- SS 実視認所見（1 画像につき 1 行以上）
- Issue AC 照合結果（全 AC を 1 対 1 で突合）
- `docs/DESIGN.md §9` 禁忌事項確認

独自フォーマット（「13 観点テーブル」等）は既存ルールの適用経路から外れるため禁止する。

## 結果

- admin bypass がルールセットで物理的に禁止されることで、bypass 時の「QM レビューが記録されないまま main に入る」問題が解消される
- approve body フォーマットの統一により、`qa-session.md` の手順が確実に踏まれる
- CI gate（#1481 Phase 1〜4）は人間の判断を補助する防衛層として引き続き機能する

## 関連

- #1481 — PR マージ前チェックリスト CI 強制 + PR テンプレート QM 観点拡充
- ADR-0004 — レビュー & AC 検証品質
- `docs/sessions/qa-session.md` §「QM が絶対にやってはいけないこと」
- `.claude/agents/qa-session.md` §「QM Approve 体制（ganbariquestsupport-lab）」
