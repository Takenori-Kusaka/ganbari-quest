# Runbook: 統合 PR 運用判断（NG 時 flow / drift 閾値 / 肥大時分割 / コスト概算）

> **対象**: develop → main 統合 PR（release ブランチ方式、[branch-strategy.md §3.1](../sessions/branch-strategy.md)）を回す際の運用判断。自動化機構（B-3 `integration-pr.yml` / B-4 `integration-attest.yml` / B-5 `hotfix-back-merge.yml`）が「何を出すか」を担うのに対し、本 runbook は人間（監査 role を回す session）が「どう判断するか」を担う。
> **実行主体**: audit-manager（merge / 起票 / ruleset 変更等の不可逆 action は orchestrator 専権、ADR-0056 §E / [audit-team.md §3.3](../sessions/audit-team.md)）。
> **関連 Issue / ADR**: #2952（本 runbook）/ #2871（B-3）/ #2876（B-4）/ #2951（B-5）/ EPIC #2861 設計原則 2・5 / ADR-0005（coverage ratchet）/ ADR-0010（Pre-PMF）。

---

## §1 NG 時 flow（部分 merge 可否 / 繰越 / revert・fix 判断）

統合 PR の最重厚 gate（[branch-strategy.md §4](../sessions/branch-strategy.md) 重量レーン）+ 8 領域監査（[audit-team.md §3](../sessions/audit-team.md)）で検出した finding を severity で分岐する。severity 定義は `scripts/audit/evidence-schema.mjs`（1-2=軽微 / 3-4=重大）。NG-0 の機械集約は B-4 の `integration-evidence` job が advisory（非 block）で出すが、**最終判定は本 flow に従う人間判断が正本**（ADR-0056、LLM/機械集約を hard gate にしない）。

| 検出内容 | 判断 | 手順 |
|---|---|---|
| **重量 gate（CI）が 1 件でも fail** | **merge 見送り** | fail job を run log で特定 → 原因の develop 取込 PR を fix（develop へ追加 PR）or revert。統合 PR（release/*）は frozen 標的のため、修正は develop で行い release branch に append（[branch-strategy.md §3.1](../sessions/branch-strategy.md)「append 後は再監査必須」）|
| **severity 3-4 の未解決 finding が残存** | **merge 見送り** | [audit-team.md §3.6](../sessions/audit-team.md) 棄却 flow に送る（ポリシー準拠判定 `policy-compliance` で意図的設計を filter → 真の NG のみ `issue-triage` で起票）。起票した Issue を Blocked by に紐付け、解消後の次 run へ繰越 |
| **severity 1-2 のみ（重大 NG 0 件 + CI 全緑）** | **merge 可** | severity 1-2 は backlog Issue を起票（merge をブロックしない）。統合 PR body §3 のマージ判定エビデンス表に「残 NG 0（severity 3-4）」を確認のうえ lab approve → **merge commit（`gh pr merge --merge`、squash 禁止、[branch-strategy.md §3.1](../sessions/branch-strategy.md) / audit-team.md §3.5）** |
| **adversarial 反対理由が未解消**（ADR-0056） | **merge 見送り** | 反対理由が解消されるまで起票/棄却 flow へ（[audit-team.md §3.5](../sessions/audit-team.md)）|

**繰越（carryover）原則**: 見送った統合 PR は close せず、次 run で develop の修正取込後に release branch を append（or 新しい `release/<date>` を cut し直し）て再監査する。**部分 merge（一部 develop PR だけ main へ）は行わない**（統合は release ブランチ単位の merge commit で一括取込） — 問題のある develop PR を develop 側で revert/fix し、release frozen 標的を健全化してから統合する。

---

## §2 drift アラート閾値（develop ⇔ main 乖離）

develop が main より先行し続けると、統合時の diff が肥大し監査の欠陥検出力が落ちる（§3）。乖離を 2 軸で監視する。算出は B-3 `integration-pr.yml` の diff step（`git rev-list --count origin/main..origin/develop`）+ B-5 未取込 back-merge PR（`is:open is:pr label:back-merge base:develop`）。

| 指標 | 警告閾値 | 危険閾値 | 対応 |
|---|---|---|---|
| **乖離日数**（前回統合 merge からの経過日数） | 3 日 | 5 日 | 警告: 次 cron を待たず `integration-pr.yml` を `workflow_dispatch` で手動発行 → 監査 run。危険: その日のうちに統合 run を実施 |
| **未統合 PR 数**（main 未取込で develop に積まれた PR 件数） | 10 件 | 20 件 | 警告: 統合 run を前倒し。危険: §3 の分割を検討（1 統合 PR に 20 件超は監査 1 回の認知限界超過、設計原則 2）|
| **未取込 hotfix（back-merge drift）** | 1 件（即） | — | `label:back-merge` の open PR は main の hotfix が develop 未反映 = main/develop の論理 drift。即 merge（軽量レーン）して解消。B-3 統合 PR §6 がこれを「未取込 hotfix」として読む |

- 乖離日数の機械通知は `integration-pr.yml` / `hotfix-back-merge.yml` の drift 通知（Discord `vars.DISCORD_WEBHOOK_URL` + job summary）で degrade-safe に出る。閾値判断は本 runbook、通知配管は workflow が担う。
- App 認証（`INTEGRATION_BOT_*`）未設定環境では統合 PR が自動発行されない（[branch-strategy.md §7](../sessions/branch-strategy.md)）。この間は乖離日数を手動監視し、危険閾値で手動統合 PR を発行する。

---

## §3 統合 PR 肥大時の分割手順

1 統合 PR の diff が大きすぎると監査の欠陥検出力が低下する（EPIC #2861 設計原則 2: DORA 2025「AI で PR が +154%」/ 400 行超で review 検出力が落ちる）。コードにも docs の分割ルール（[docs/CLAUDE.md](../CLAUDE.md) 50 ファイル警告 / 100 ファイル BLOCK）を準用する。

| 指標 | 警告 | 分割必須 |
|---|---|---|
| 変更行数（含有 PR 合計の純増） | 400 行 | — （行数は警告のみ。機能境界を優先）|
| 変更ファイル数 | 50 ファイル | 100 ファイル |
| 含有 PR 数 | 10 件（§2 警告と連動） | 20 件 |

**分割手順（release ブランチ方式で時系列 / 領域別に切る）**:

1. 肥大した develop を 1 本の release で統合せず、**時系列で `release/<date>-1` / `release/<date>-2` に分割**する。`release/<date>-1` は develop の途中コミット（前半の含有 PR 群まで）を凍結 cut（[branch-strategy.md §3.1](../sessions/branch-strategy.md) の cut 手順）。
2. `release/<date>-1 → main` を監査・merge → main → develop back-merge（§5 経路）→ 残りを `release/<date>-2` で cut し直して統合。
3. 領域横断で論理的に切れる場合（例: auth 系 / LP 系 / admin 系）は領域別 release も可。ただし**含有 PR の依存順を壊さない**（後段 PR を先に main へ出さない）。
4. 分割した各 release PR は独立に重量 gate + 監査を通す（frozen 標的のため監査が無効化されない）。

肥大の予防が第一（§2 で乖離を早期に潰し、cadence を上げて 1 回の統合サイズを小さく保つ）。分割は事後対処。

---

## §4 daily run コスト・triage 負荷概算（cadence 引き上げ成立性）

統合 run 1 回の wall-clock と月次コスト、ソロ PO の triage 所要を概算し、cadence 段階引き上げ（週 1-2 回 → daily → 1 日 2 回、[branch-strategy.md §9](../sessions/branch-strategy.md)）の成立性を評価する。

### 統合 PR 1 本あたりの CI wall-clock（重量レーン、[branch-strategy.md §4](../sessions/branch-strategy.md) 実測値）

| job | 所要 | 並列性 |
|---|---|---|
| `lint-and-test` | 約 199s | critical path |
| `unit-test`（×2 shard）+ merge | 約 259s | 並列 |
| `e2e-test`（×3 shard）+ merge | shard あたり最大 909s | 並列（critical path ≈ 15min）|
| `a11y` | 約 745s | 並列 |
| `e2e-cognito-dev` / `docker-build` / `e2e-demo-lambda` | 約 169 / 133 / 133s | 並列 |
| `storybook-test` | 約 106s | 並列 |
| `e2e-matrix`（4 project） | 約 4-7min | 並列 |
| `deploy-aws-staging` | 約 15min | 並列（段階導入、[staging-gate-required-checks.md](staging-gate-required-checks.md)）|

→ **critical path ≈ 15-20 分/統合 PR**（e2e shard + staging が支配的。並列のため合計時間ではない）。`integration-attest.yml`（B-4）は push[main] 後の独立 job で +1-2min、deploy を阻害しない。

### 月次コスト概算（Pre-PMF、ADR-0010 Bucket A）

| 費目 | daily（月 ~30 run）概算 | 備考 |
|---|---|---|
| GitHub Actions 分 | ubuntu-latest 約 20min × 30 = 約 600 min/月 | private repo の無料枠（2,000 min/月）内。public repo なら無料 |
| LLM API（8 領域監査 subagent + adversarial） | run あたり数十万 token × 30 | 最大の変動費。cadence を上げるほど線形増。週 2 回なら 1/4 |
| AWS staging（phase E、#2873） | idle ≈ ¥0（serverless、PO 確認済） | deploy 時のみ従量。idle 課金なし |
| attestation（GH attestations API / Sigstore） | 無料 | actions/attest は GitHub 標準枠 |

→ **daily の主コストは LLM API の audit run**。GitHub Actions 分 / AWS は Pre-PMF で無視可能。

### ソロ PO triage 所要見積

| 作業 | 所要/run | 備考 |
|---|---|---|
| 統合 PR body §3 エビデンス表 + advisory 確認 | 5-10 分 | B-4 で自動生成済、目視確認のみ |
| 8 領域 finding の severity 判定 + §1 flow 適用 | 10-20 分 | finding 0 件なら数分 |
| NG 起票（あれば）+ lab approve | 5-15 分 | NG 0 件なら approve のみ |

→ **NG 0 件の健全な run なら 15-30 分/日**。NG 多発時は §1/§3 で増える。**daily 成立条件 = 1 回の統合サイズを §2/§3 で小さく保ち、finding を低く維持すること**。サイズが大きい / NG 多発が続く間は週 1-2 回に留め、安定後に daily へ引き上げる（cadence は `integration-pr.yml` の cron 1 行で変更）。

### 監査有効性の測定方針（#2861 設計原則 5）

監査の有効性は **「起票数」では測らない**（起票数は finding の量であって品質の証明にならない）。**DORA instability（change failure rate / incidents per merged PR / mean time to restore）** で測る。統合 merge 後に main で発生した incident / hotfix 数を per-PR で追跡し、監査が「漏れた欠陥」を減らせているかを評価する。計測機構の実装は **phase G の別 Issue**（本 runbook は方針明記まで。一次根拠: [DORA State of DevOps](https://dora.dev/research/)）。
