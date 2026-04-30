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

---

## Amendment 1 (#1728, 2026-04-30): ganbariquestsupport-lab PR 作成禁止 + Takenori-Kusaka PR 作成ガード

### 背景

ADR-0022 本文（決定 2）で「Takenori-Kusaka が PR 作成 → ganbariquestsupport-lab が approve」の役割分担を定めたが、**`gh auth switch` で QA アカウントに切り替えたまま `gh pr create` を実行してしまう事故**が発生する経路があった（QA 後に Dev に戻し忘れ → 次の PR 作成タイミングで誤発火）。

ganbariquestsupport-lab で PR を作成すると以下の問題が起きる:

- そのアカウントは Write 権限のため通る → 後で「自分の PR は自分で approve できない」制約に当たり、Dev に手戻り
- PR 作成者と Dev 履歴の対応が崩れ、`gh pr list --author Takenori-Kusaka` 等の集計が破綻
- ADR-0022 が定めた role separation が事実上機能しない

### 決定（追加）

1. **`ganbariquestsupport-lab` での PR 作成を完全禁止**する（手順は本 ADR 本文「決定 2」に従い、PR 作成は Takenori-Kusaka のみ）
2. **PR 作成前の active アカウント確認スクリプトを必須化**する: `scripts/check-gh-account-before-pr.mjs` を `gh pr create` の直前に必ず実行する。`Takenori-Kusaka` 以外なら exit 1 で停止し、人間が `gh auth switch` で切替えてから再開する
3. AUTO_MODE / Agent / Claude セッションでの自動 PR 作成は、本スクリプトを通過した後にのみ `gh pr create` を呼ぶ前提で運用する（`docs/sessions/dev-session.md §PR 作業時 §5.5` に明記）
4. Pre-commit / Pre-push hook での同等チェックは **本 amendment では採用しない**。理由:
   - hooks は ganbariquestsupport-lab が `gh pr review --approve` のために行う **正当な commit / push（例: KB 追記）も誤検知して止めうる**
   - PR 作成は `gh pr create` 単一コマンドなので、その手前の単一スクリプトガードで十分（hook は粒度が粗すぎる）
   - 採用すると hook bypass (`--no-verify`) を Dev が常用するインセンティブを生み、ADR-0006 禁止 5 項目との運用衝突リスクがある
   - 将来再評価する場合: 本 amendment を上書きする新 amendment / 後続 ADR を起票する

### 受入基準（#1728 AC）

- [x] `docs/sessions/dev-session.md` に「PR 作成は必ず Takenori-Kusaka アカウント。ganbariquestsupport-lab は QA レビュー専用」明文化（§PR 作業時 §5.5）
- [x] `docs/sessions/qa-session.md` の「QM が絶対にやってはいけないこと」に「ganbariquestsupport-lab で PR 作成しない」を追加
- [x] `scripts/check-gh-account-before-pr.mjs` を新設し、`gh auth status` の active アカウントが `Takenori-Kusaka` でない場合 exit 1 で停止する
- [x] `docs/sessions/dev-session.md §PR 作業時 §5.5` で `gh pr create` 直前にスクリプト実行を必須化
- [x] Pre-push hook 採否を本 amendment 内で判断（**不採用** — 理由は上記 4）
