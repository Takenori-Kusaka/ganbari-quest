# ADR-0022: admin bypass 禁止と ganbariquestsupport-lab QM Approve 体制の確立

- **Status**: accepted (2026-06-04 amendment 4: lab merge の 2 role 区別 + 統合 PR 作成者ルール、#2863)
- **Date**: 2026-04-25
- **Issue**: #1481

---

## 背景

PO 1 人体制のため `required_approving_review_count=1` を admin bypass で回避するマージが常態化し、QM レビュー手順が踏まれない PR が main に入り続けた。bypass merge 時の self-review comment に明示規定がなく独自フォーマット（13 観点テーブル等）が既存ルールの適用経路から外れた。CI gate はチェックリスト構造の「存在」は確認できるが、SS 品質・横展開調査・AC 達成の真正性は人間が担う必要がある。

## 決定内容

### 1. admin bypass を完全に禁止する

GitHub Repository Ruleset `PR_Merge` の `bypass_actors` を空配列（`[]`）に設定し、repo owner を含む全アクターの bypass を禁止する。

### 2. ganbariquestsupport-lab アカウントを QA 専用 approve アカウントとして運用する

- アカウント: `ganbariquestsupport-lab`（ganbari.quest.support@gmail.com で作成）、コラボレーター権限 Write
- QA セッション起動時の `gh` アクティブアカウントを ganbariquestsupport-lab に設定する
- **作成者 ≠ 承認者**: Takenori-Kusaka（Dev）が PR を作成 → ganbariquestsupport-lab（QA）が approve → squash merge の順で実行する

### 3. approve body フォーマットを `qa-session.md` 手順に統一する

`gh pr review --approve --body` の body には `docs/sessions/qa-session.md §「QM approve 前の必須実行手順」` と同等の内容（SS 実視認所見 1 行/枚 + Issue AC 全件 1 対 1 照合 + `docs/DESIGN.md §9` 禁忌確認）を必ず記述する。独自フォーマット（「13 観点テーブル」等）は適用経路から外れるため禁止する。

## 結果

admin bypass がルールセットで物理的に禁止され「QM レビュー未記録のまま main 入り」が解消される。approve body フォーマット統一で qa-session.md 手順が確実に踏まれる。CI gate（#1481 Phase 1〜4）は人間判断を補助する防衛層として機能する。

## Amendments（決定内容）

### Amendment 1 (#1728): ganbariquestsupport-lab PR 作成禁止 + active アカウントガード

`gh auth switch` で QA アカウントに切替えたまま `gh pr create` する事故経路があり role separation が機能しなくなる。決定: (1) `ganbariquestsupport-lab` での PR 作成を完全禁止（PR 作成は Takenori-Kusaka のみ）、(2) `gh pr create` 直前に `scripts/check-gh-account-before-pr.mjs` を必須実行し `Takenori-Kusaka` 以外なら停止、(3) AUTO_MODE / Agent も本スクリプト通過後にのみ `gh pr create`。pre-push hook 採否は当初不採用としたが **amendment 3 で supersede**。受入基準は #1728 / `docs/sessions/dev-session.md §PR 作業時 §5.5` 参照。

### Amendment 2 (#1809): Dependabot auto-merge は admin bypass に該当しない

GitHub の auto-merge は「approve + 全 required checks 通過時に自動 squash merge」するだけで required reviewers / status checks は引き続き enforce されるため、`bypass_actors` による admin bypass とは別物。決定: (1) auto-merge は admin bypass 非該当、(2) Dependabot PR の auto-merge は許可（運用負担削減）、(3) リポジトリ設定 `allow_auto_merge=true` は PO が owner 権限で有効化（`gh api repos/Takenori-Kusaka/ganbari-quest --method PATCH -f allow_auto_merge=true`）、(4) #1808（Dependabot exempt CI）と組合せで完全自動化。受入基準・PO 操作手順は #1809 / `.github/CLAUDE.md` Dependabot 運用方針参照。

### Amendment 3 (#1879 / #1994): PR 起票アカウント違反の 3 層機械強制機構

手順書依存（人間 / Agent の規律）は忘却・スキップが構造的に発生し、PR #1875 / #1982 で `ganbariquestsupport-lab` 起票違反が再発した。GitHub PR author は事後変更不可のため事前防止が必要。amendment 1 の「pre-push hook 不採用」を supersede し 3 層防御を導入:

- **L1 Claude Code hook** (`.claude/settings.json` PreToolUse → `scripts/claude-hook-prevent-qa-account-pr.mjs`): Claude / Agent 経由の `gh pr create` を捕捉。
- **L2 git pre-push hook** (`.husky/pre-push` → `scripts/check-gh-account-before-pr.mjs`): 手動 `git push` 直前に捕捉。OSS は husky を採用（デファクト、devDep、Pre-PMF コスト極小）。
- **L3 server side gate** (`.github/workflows/pr-author-guard.yml`): `pull_request: opened/reopened/ready_for_review` で発火、author が許可リスト外なら PR 自動 close + 違反コメント + workflow fail。Web UI / 別 client / REST 直叩き等 L1/L2 で抜けた全経路を捕捉。

L1/L2 が事前防止層、L3 が事後 close 層。`git push --no-verify` での skip は ADR-0026（`--no-verify` 禁止）で運用カバー。実装詳細・OSS 選定表・受入基準は #1879 / #1994、3 層の運用は `docs/sessions/qa-session.md §「QM が絶対にやってはいけないこと」` 参照。

### Amendment 4 (#2863): lab merge の 2 role 区別 + 統合 PR 作成者ルール

EPIC #2861 で branch モデルを develop 二層（`feature/* → develop → 統合 PR → main`）に拡張すると `ganbariquestsupport-lab` の merge が 2 role を持つ。区別を明文化しないと merge 権限の audit trail が曖昧になる。決定:

1. **2 role 区別**（同一 gh アカウントを base branch で区別）: **QM role** = `feature/* → develop` の per-PR approve + merge（毎時、決定 2 の QM Approve 体制を継承）／ **外部品質監査チーム role** = `develop → main` 統合 PR の approve + merge（1 日 1 回、CUJ 横断・客観的第三者判定）。
2. **統合 PR 作成者ルール**: `develop → main` 統合 PR は `Takenori-Kusaka` 名義が作成 → `ganbariquestsupport-lab`（監査 role）が approve + merge。決定 2 の作成者 ≠ 承認者分離を統合 PR でも維持。
3. **pr-author-guard 変更不要**: 統合 PR も `Takenori-Kusaka` 作成のため現行 guard の許可リストに合致（base 別分岐不要）。
4. **各 role の audit trail 要件**（#2768 懸念解消）: QM role は approve body に決定 3 の手順を記述。外部品質監査チーム role は ADR-0056 structured evidence に基づき、adversarial reviewer の反対理由 3 件を `tmp/adversarial-evidence/<pr>.json`（`must_object_count: 3` schema、TTL 30 分）に保存し PreToolUse hook `.claude/hooks/gate-approve.mjs`（検証ロジック `scripts/verify-adversarial-output.mjs`）が approve 前に物理検証する。

**二役の限界**: 本役割分離は論理上の 2 role であり、lab approve の実運用は同一オペレータ配下の AI session による二役で物理的に別人格ではない。この限界を明示的に認める。補償として self-report 単独信頼を禁止し（EPIC #2861 PO 判断 5 / ADR-0056）、approve 判定根拠を上記 audit trail（evidence file の物理存在）に固定する。

**効力発生条件**: 本 amendment の 2 role 区別は develop cutover（#2870）完了後に発効。cutover 前は現行運用（全 PR が main 向け、QM role が毎時 approve + merge）が継続する。

**暫定代行の終期（#2938 項目 1）**: cutover 後〜監査 run pipeline（#2867）稼働までの過渡期に QM role が統合 PR を暫定代行する規定は、終期条件（#2867 稼働）の充足により終了済み — 現在の統合 PR approve + merge は監査チーム role 専管（`docs/sessions/qa-session.md` §レビュー対象レーン）。本規定の改訂時は本 ADR / `qa-session.md` / `.claude/agents/audit-manager.md` §G の 3 doc を同時更新する。

運用詳細（cadence / レーン / 判定範囲）は `docs/sessions/branch-strategy.md §6` / `docs/sessions/audit-team.md` が SSOT。受入基準は #2863 参照。

## 関連

- #1481（PR マージ前チェックリスト CI 強制）/ #1728 / #1809 / #1879 / #1994 / #2863（各 amendment）
- ADR-0004（レビュー & AC 検証品質）/ ADR-0026（force push 禁止）/ ADR-0056（structured evidence）/ ADR-0010（Pre-PMF Bucket A）
- `docs/sessions/qa-session.md`（QM approve 手順・3 層防御運用）/ `.claude/agents/qa-session.md`（QM Approve 体制）/ `docs/sessions/branch-strategy.md §6` / `docs/sessions/audit-team.md`（2 role 運用）
