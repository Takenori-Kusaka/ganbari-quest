# ブランチ戦略 SSOT — develop 二層 + gate 二層

> **このファイルの位置づけ**: がんばりクエストの git ブランチ運用・CI gate 振り分け・merge 責任分担の SSOT。
> 検討経緯（3 案比較・採用判断）は [docs/rationale/11-branch-strategy-rationale.md](../rationale/11-branch-strategy-rationale.md) を参照。
>
> **関連 Issue**: #2858 ｜ **関連 ADR**: ADR-0007（2 層 cadence）/ ADR-0022（QM Approve 体制・Branch Ruleset）/ ADR-0002（Critical 品質ゲート）/ ADR-0030（pre-ready CLI）/ ADR-0010（Pre-PMF）

## §1 設計背景

main = 即本番 deploy の不変条件下で「開発速度」と「品質」を両立する構造が必要になった。

- **全 PR で full gate を回すと開発速度が落ちる**: 個別 PR ごとに e2e×3 shard（最大 909s）+ a11y（745s）+ unit×2（259s）+ docker / storybook / visual regression を毎回回すと、1 PR あたり 13〜16 分の CI 待ちが発生する。Pre-PMF のソロ開発では CI 待ち時間が最重要資源（開発者の集中・スループット）を直接削る。
- **テストなしで main に merge すると品質が落ちる**: `main` への push は `deploy.yml` / `deploy-nuc.yml` / `pages.yml` を即トリガーし本番 / NUC / LP へ反映される（不変条件）。gate を軽くしたまま main に直接 merge すると、未検証コードがそのまま本番に出る。
- **この設計がない場合に困ること**: 「速度を取って gate を緩める」と本番品質が崩れ、「品質を取って全 PR full gate」だと開発が止まる。二者択一を避けるには、**個別 PR は軽量 gate で速く回し、本番反映の直前（develop → main）に full gate を集約する** 二層構造が要る。

## §2 設計原則

`feature/fix/docs/* → (PR) → develop → (PR, 1 日 1 回) → main` の develop 二層と、それに対応する gate 二層を採用する。

- **gate 二層**: 個別 PR（→ develop）は軽量レーン、統合 PR（develop → main）は最重厚レーン。ADR-0007 §5 が定義する「2 層 cadence（per-PR の軽量 targeted 検証 / EPIC-merge・顧客レビュー直前の総合検証）」を **branch 軸で実装** したものが本戦略である。
- **責務分担の二層**: feature → develop の品質責任は QM（毎時レビュー）、develop → main の品質責任は外部品質監査チーム（1 日 1 回）。両者はいずれも gh アカウント `ganbariquestsupport-lab` で、role（レビュー scope・gate 範囲）で区別する。
- **main 不変条件の保全**: develop 導入後も「main = 本番」を崩さない。deploy トリガー（main push）には一切手を入れない。develop は本番反映前の集約・検証バッファであり、deploy 経路を持たない。
- **外部品質監査チームの責務境界**: develop → main 統合 PR の発行・最重厚 gate 判定・merge を担う。問題は 1 件で即棄却せず**全件を発露させてから** Issue 起票 + 棄却する（Pre-PMF の「最初の 5 人」レビュー枠を最大活用する NN/G 思想）。ロール定義の詳細は外部品質監査チーム EPIC で整備し、本ファイルでは責務境界のみを定める。
- **統合 PR の自動発行 + merge 戦略 = merge commit（#2871）**: develop → main 統合 PR は `integration-pr.yml`（schedule + dispatch、release PR パターン）が Takenori-Kusaka 名義で自動発行・常時更新する（手動発行は廃止、作成者≠承認者分離 ADR-0022 Amendment 4-2 を維持）。本文（含有 PR 一覧・統合サマリ）は `scripts/integration-pr-body.mjs`（pure function SSOT）が develop の merge 履歴から自動生成し、散文 self-report 退化（ADR-0056）を防ぐ。**統合 PR の merge は merge commit を採り、squash は採らない** — develop 上の各 feature PR は QM 取込時に既に squash 済で、統合 PR を squash すると含有 PR の commit 粒度が潰れ、B-4 の in-toto 構成 link / DORA per-PR instability 計測（audit-team.md §3.5）が成立しなくなる（release-please も「atomic commit を保持したい場合は merge / rebase 可」と明記）。発行は `integration-pr.yml` までで、approve / merge は audit-manager 専権（ADR-0056 §E、本 workflow は不可逆 action をしない）。

## §3 ブランチ規則

| 項目 | ルール |
|---|---|
| 命名 | `feat/*` / `fix/*` / `refactor/*` / `docs/*` / `infra/*`（既存の type label 接頭辞と一致）。統合は `release/*`（§3.1） |
| 切る元 | `develop`（hotfix / release を除く） |
| PR 先 | `develop`（hotfix / release を除く） |
| main へ PR を出せる branch | `release/*`（統合 PR、§3.1）と hotfix branch（§5、緊急 fix / CI 環境構築の main 直 PR を含む）の **2 系統のみ** |
| 長命 branch | 禁止。feature / release branch は merge 後に削除。develop は恒久 branch |

- 新規作業は必ず `develop` から branch を切り、`develop` 向けに PR を出す。`main` を直接 base にした feature PR は出さない（hotfix / release を除く）。
- `develop` は `main` から分岐した恒久 branch。統合 PR（release/* → main）merge 後も削除しない。

### §3.1 release ブランチ方式（統合 PR の「動く標的」問題の構造的解消、#3063）

統合 PR を `develop → main` で出すと、PR の HEAD が develop の日次/毎時マージで動き続け、APPROVE→merge 直前に develop が動くたびに 8 領域監査・adversarial evidence（TTL 30 分）が無効化され再監査ループに陥る（#3021 で顕在化）。これを構造的に解消するため、統合は **release ブランチ方式（git-flow）** で行う。

| 手順 | 内容 |
|---|---|
| 1. cut | 統合したい `develop` の**特定コミットを凍結**し、そこから `release/<YYYY-MM-DD>`（例 `release/2026-06-16`）を cut する。以後 develop が進んでも release branch の HEAD は不変＝frozen 標的 |
| 2. 統合 PR | `release/* → main` の PR を発行する。`pr-lane.mjs` rule 2 で `integration`（重量レーン）に分類され、`main-pr-base-guard` が release/* を許可、重量 job + `integration-evidence` が保証発火する |
| 3. 監査・merge | frozen な release HEAD に対し 8 領域監査 + adversarial evidence（ADR-0056）→ lab approve（author≠approver, ADR-0022）→ squash merge。HEAD が動かないため監査が無効化されない |
| 4. back-merge | merge 後、`main → develop` の back-merge sync PR で main の squash commit を develop へ取り込む（hotfix back-merge と同じ §5 経路 / #2951・#3061 自動化）|

- release branch は **`non_fast_forward` の ruleset（`release-lane-freeze`、target=`refs/heads/release/*`、id 17725378）で保護**し、force-push（history 書換）で標的が動くのを機械的に防ぐ。監査中に見つかった修正は release branch への通常 commit（append、fast-forward）で対応する。deletion guard は付けない（merge 後の release branch auto-delete を妨げないため。develop の deletion 保護 #2989 とは異なり release は ephemeral）。
- 命名は `release/<YYYY-MM-DD>` を基本とし、同日複数回は `-2` 等の suffix を付ける。
- machine 層: `pr-lane.mjs`（lane 判定）/ `resolve-base-branch.mjs`（release/* → main 基点解決）/ `ci.yml`（base-guard + 重量発火）が release/* を統合レーンとして扱う。
- **`integration-pr.yml`（develop → main 自動発行、#2871）との関係**: `develop → main` も rule 2 で integration レーンに残す（後方互換）。audit-manager が形式 audit で main へ反映する際は **release/* を cut して frozen 標的で監査・merge する**のを正準とする。`integration-pr.yml` の自動発行を release/* cut 方式へ移行するかは別 Issue（#3063 派生）で判断する。

### branch 作成・push 運用 SOP（refspec self-heal + 基点鮮度 + rebase、#2975 / #3009）

stale develop 基点ズレ（single-branch refspec で `origin/develop` が更新されない）と PR 期間中の develop rebase drift を防ぐ運用手順。機械層は `scripts/lib/resolve-base-branch.mjs`（pre-push hook Step 2.0 / pre-ready が経由）が refspec を自動 self-heal する。

| 局面 | 手順 |
|---|---|
| worktree / clone 直後 | `git config --get-all remote.origin.fetch` に develop 行（または `refs/heads/*`）があるか確認。無ければ `git config --add remote.origin.fetch '+refs/heads/develop:refs/remotes/origin/develop' && git fetch origin`（`resolve-base-branch.mjs` 経由の経路では自動修復される。worktree は main repo と config 共有のため修復は clone 単位で 1 回） |
| branch 作成直後 | `node scripts/lib/resolve-base-branch.mjs --verify-base` で基点鮮度を機械検証（HEAD が `origin/<base>` 最新を取り込んでいなければ exit 1。`git rev-list --count HEAD..origin/<base>` == 0 と等価） |
| push 前 | `git fetch origin <base> && git rebase origin/<base>` → `git push --force-with-lease origin <branch>`（base は `node scripts/lib/resolve-base-branch.mjs` で解決） |
| `--force-with-lease` が stale info で reject | worktree / 限定 refspec 下では `origin/<branch>` tracking ref が自動更新されない（`git fetch origin <branch>` は FETCH_HEAD のみ更新で tracking ref を更新しない）。`git fetch origin <branch>:refs/remotes/origin/<branch> --force` で tracking ref を明示更新してから再 push する。fast-forward push なのに reject が続く場合は `git push origin <branch>`（force なし）で通る。tracking ref 一致でも reject が続く環境（Windows worktree で観測）では `git push --force-with-lease=<branch>:$(git ls-remote origin refs/heads/<branch> \| cut -f1) origin <branch>` で期待 SHA を明示する（lease 安全性は同等） |
| PR open 中に base（develop）が進んだ | **QM BLOCK を待たず速やかに rebase + push する**（#3009: 放置すると BLOCK が複数ラウンド累積する）。UI 変更 PR は rebase 後の SS 再撮影 + screenshots branch push も必須（`src/routes/CLAUDE.md` §「rebase 後の screenshots branch push 必須」） |

## §4 gate 二層対応表

軽量レーン（→ develop PR）と重量レーン（release/* → main 統合 PR、§3.1）の job 振り分け。実測所要は本リポジトリの CI 観測値（`ci.yml` の各 job）。

### 軽量レーン（feature → develop PR）

| job | 内容 | 実測 |
|---|---|---|
| `lint-and-test` | Biome / svelte-check / stylelint / cspell / knip / build | 約 199s |
| `unit-test`（×2 shard）+ `unit-test-merge` | vitest + coverage ratchet | 約 259s |
| `site-check` | site/ HTML / forbidden terms（site 変更時） | ≤ 53s |
| `new-env-distribution-check` / `schema-change-tests-check` / `schema-migration-completeness-check` | env 配布証跡 / スキーマ互換 | ≤ 53s |
| PR テンプレ gate（`pr-template-gate.yml` 5 job / `pr-ac-verification-check.yml`） | 必須セクション / AC マップ | ≤ 53s |

### 重量レーン（release/* → main 統合 PR、§3.1）

| job | 内容 | 実測 |
|---|---|---|
| 軽量レーン全 job | 上記すべてを再実行（集約検証） | — |
| `e2e-test`（×3 shard）+ `e2e-merge-reports` | Playwright E2E matrix | shard あたり最大 909s |
| `a11y` | axe-core WCAG 2.2 AA | 約 745s |
| `e2e-cognito-dev` | 認証・課金 E2E | 約 169s |
| `docker-build` / `e2e-demo-lambda` | Docker build + demo Lambda 等価検証 | 約 133s |
| `storybook-test` | Storybook interaction（play） | 約 106s |
| visual regression（`lp-visual-regression.yml` / `child-home-visual-regression.yml` / `app-visual-regression.yml`） | pixelmatch baseline 比較 | — |
| `e2e-matrix`（#2874） | ADR-0040 mode×plan matrix（4 project、port 5201-5204、`playwright.matrix.config.ts`） | 約 4-7min（並列、critical path 不変） |
| `deploy-nuc-staging`（#2872） | NUC staging deploy + migration 込み起動貫通 + health（self-hosted runner） | — |
| `deploy-aws-staging`（#2873） | AWS staging 3 stack deploy + post-deploy health / smoke（Phase 1 advisory → Phase 2 required 化、[runbooks/staging-gate-required-checks.md](../runbooks/staging-gate-required-checks.md)） | 約 15min |
| `integration-evidence`（#2874） | audit-team.md §3.5 #3/#4 エビデンス自動生成（`integration-pr-evidence-*` artifact、gate ではない） | 約 1-2min |

### 全 workflow の gate × lane 対応表（SSOT、#2948 / EPIC #2861 AC6）

全 `.github/workflows/*.yml`（37 本）の lane 帰属・required 化・lane 分岐の網羅表。新規 workflow を追加する人はこの表に必ず 1 行追加する（差分検出 gate `scripts/check-internal-terms.mjs` の workflow-coverage group が「`.github/workflows/*.yml` 一覧 ⊆ 本表記載一覧」を機械検証し、未記載は CI fail、#2948 AC4）。

> **2 つの不変原則（外部 research の結論を運用 SSOT 化、#2948 AC3）**:
> 1. **required は trigger filter で skip 不可（permanent pending）** — required status check に登録した context は、`branches:` / `paths:` filter で workflow ごと skip すると GitHub 側で「報告されない = pending」のまま merge がブロックされる。required context を生む job は filter で消さず、**job 内で全 lane 実行 → 観点だけ切替** する（[GitHub Docs: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)）。
> 2. **lane 分岐は job 内部で観点切替（全体 skip 禁止）** — lane-aware 化した required gate は `if:` で lane による job 全体 skip をしない。lane を `actions/pr-lane`（A-1 SSOT `scripts/pr-lane.mjs`）から取得し、検証「観点」だけを切り替える（feature/hotfix=per-PR 観点 / integration=統合観点、新規 conditional job も required に自動取込される設計）。

#### lane 帰属の凡例

| lane 値 | 意味 |
|---|---|
| `feature` | 軽量レーン（→ develop PR、`pr-lane.mjs` rule 4/5）。back-merge（main→develop）も帰属 |
| `integration` | 重量レーン（統合 PR、rule 2 = `release/* → main` または `develop → main`、§3.1） |
| `hotfix` | 重量レーン（`fix/*` → main、rule 3、ADR-0002） |
| `feature+integration+hotfix`（= 全 PR lane） | `branches` 無指定 PR-scoped。全レーンで発火する軽量 gate |
| `integration+hotfix` | `branches: [main]` PR-scoped。main 向け PR（統合 / hotfix）のみ発火する重量 gate |
| `dependabot` | bot PR。`pr-lane.mjs` の `BOT_ACTORS` SSOT で exempt 判定（rule 1） |
| `N/A（非 PR）` | PR event を持たない（schedule / push / workflow_run / issues / workflow_dispatch のみ）。lane 概念の対象外 |

#### 対応表（required context は ★ 印 + context 名、`gh api .../rulesets/14673945` の配列と一致＝#2948 AC2）

| workflow | lane 帰属 | required context（★） | lane 分岐（A-1 SSOT 経由） | 重量/軽量 |
|---|---|---|---|---|
| `ci.yml` | feature+integration（`branches:[main,develop]`） | ★`ci-gate` | あり（inline `base_ref=='main' && (head_ref=='develop' \|\| startsWith(head_ref,'release/'))` = `pr-lane.mjs` rule 2 SSOT。重量 job を統合 PR で保証発火、develop PR で skip） | 軽量 job=軽量 / 重量 job=重量 |
| `pr-template-gate.yml` | 全 PR lane（`branches` 無指定） | ★`必須セクションの存在確認` / ★`関連 Issue 番号の記入` / ★`変更タイプの選択` / ★`顧客価値・目的の記入` / ★`テスト実行結果の記入`（5 job） | あり（`uses: ./actions/pr-lane` → 各 job が `--lane`。feature/hotfix vs integration vs dependabot=skip 相当、#2944） | 軽量 |
| `pr-ac-verification-check.yml` | 全 PR lane | ★`Verify AC map in PR body` | あり（`uses: ./actions/pr-lane`。feature/hotfix=AC マップ 4 列 / integration=マージ判定エビデンス表、#2945） | 軽量 |
| `pr-merge-gate.yml` | 全 PR lane | ★`PR チェックリスト完了確認` | あり（`uses: ./actions/pr-lane`。feature/hotfix=2 section / integration=統合用 section、#2945） | 軽量 |
| `pr-quality-gate.yml` | 全 PR lane | ★`screenshot-check` | あり（`uses: ./actions/pr-lane`。feature/hotfix=before/after 4 スロット / integration=VR 3 層委譲、#2946） | 軽量 |
| `lp-metrics.yml` | 全 PR lane（`paths:site/**`） | ★`Measure LP dimensions and lint forbidden terms`（`measure` job） | なし（lane 非依存。`paths` scope のみ。`cumulative-lp-metrics` は main merge 擬似累積） | 軽量 |
| `lp-fallback-check.yml` | 全 PR lane（`paths` scope） | — | なし | 軽量 |
| `check-pr-template-sections-sync.yml` | 全 PR lane（`paths` scope） | — | なし | 軽量 |
| `orphan-check.yml` | 全 PR lane（`paths` scope）+ push[main] | — | なし | 軽量 |
| `dependency-review.yml` | feature+integration（`branches:[main,develop]`、`paths` scope） | — | なし（develop/main 双方発火、軽量） | 軽量 |
| `pr-info.yml` | feature+integration（`branches:[main,develop]`） | — | なし（`type-label` job は dependabot exempt） | 軽量 |
| `pr-author-guard.yml` | 全 PR lane（`pull_request_target`） | —（`enforce-pr-author` job、ruleset 未登録） | なし（dependabot/renovate exempt） | 軽量 |
| `labeler.yml` | 全 PR lane（`pull_request_target`） | — | なし | 軽量 |
| `pr-lane-smoke.yml` | feature+integration（`branches:[main,develop]`）+ dispatch | —（comment-only、block しない） | あり（`uses: ./actions/pr-lane` の動作実証専用、#2943 AC4） | 軽量 |
| `dependabot-auto-merge.yml` | dependabot（`pull_request`、actor=`dependabot[bot]`） | — | なし（`BOT_ACTORS` SSOT を参照し inline 判定。composite action は overhead 回避で不採用、#2947） | 軽量 |
| `lp-visual-regression.yml` | integration+hotfix（`branches:[main]`）+ push[main] | — | なし（develop PR で skip＝重量レーン、VR hard-fail） | 重量 |
| `child-home-visual-regression.yml` | integration+hotfix（`branches:[main]`）+ push[main] | — | なし（develop PR で skip、VR warn） | 重量 |
| `app-visual-regression.yml` | integration+hotfix（`branches:[main]`）+ push[main] | — | なし（develop PR で skip、VR warn） | 重量 |
| `deploy-aws-staging.yml` | integration+hotfix（`branches:[main]` PR、paths filter 撤去で常時発火） | —（required 化は段階導入、[runbooks/staging-gate-required-checks.md](../runbooks/staging-gate-required-checks.md)） | なし（main 向け PR で発火、actor allowlist） | 重量 |
| `deploy-nuc-staging.yml` | integration+hotfix（`branches:[main]` PR） | — | なし（actor allowlist） | 重量 |
| `codeql.yml` | integration+hotfix（`branches:[main]` PR）+ push[main]+schedule | — | なし（develop PR で skip、main 経路で coverage 維持、#2931） | 重量 |
| `deploy.yml` | N/A（push[main] / tags / dispatch） | — | — | 本番 deploy |
| `deploy-nuc.yml` | N/A（push[main] / dispatch） | — | — | 本番 deploy |
| `pages.yml` | N/A（push[main] / dispatch、LP 配信 + SS 撮影） | — | — | 本番 deploy |
| `hotfix-back-merge.yml` | N/A（push[main] / dispatch、hotfix merge 契機の back-merge PR 自動発行） | — | なし（判定は `scripts/hotfix-back-merge.mjs` SSOT。発行する back-merge PR 自体は base=develop で軽量レーン = `pr-lane.mjs` rule 4） | 補助（§5 back-merge 機械強制、#2951） |
| `integration-pr.yml` | N/A（schedule 週 2 回 / dispatch、develop→main 統合 PR を release PR パターンで自動発行・常時更新） | — | なし（本文生成は `scripts/integration-pr-body.mjs` SSOT。発行する統合 PR 自体は base=main + head=develop で integration レーン = `pr-lane.mjs` rule 2、上記 ci.yml 等の lane 分岐が観点切替する） | 補助（§2 統合 PR 自動発行、#2871） |
| `draft-on-ci-fail.yml` | N/A（`workflow_run`: CI 完了時） | — | — | 補助 |
| `issue-close-gate.yml` | N/A（`issues: [closed]`） | — | — | 補助 |
| `ac-audit-monthly.yml` | N/A（schedule / dispatch） | — | — | 定期監査 |
| `audit-run.yml` | N/A（`workflow_dispatch` のみ） | — | — | 監査（手動） |
| `admin-bypass-evidence.yml` | N/A（schedule hourly / dispatch） | — | — | 定期監査 |
| `cost-audit.yml` | N/A（schedule monthly / dispatch） | — | — | 定期監査 |
| `code-quality-weekly.yml` | N/A（schedule weekly / dispatch） | — | — | 定期監査 |
| `security-scan.yml` | N/A（schedule quarterly / dispatch） | — | — | 定期監査 |
| `weekly-report.yml` | N/A（schedule weekly / dispatch） | — | — | 定期レポート |
| `gcp-terraform.yml` | N/A（`workflow_dispatch` のみ） | — | — | infra（手動） |
| `zenn-lint.yml` | N/A（push/PR `paths:docs/zenn/**`、lint 専用） | — | なし（docs/zenn のみ、lane 非依存） | 軽量（zenn 限定） |

> **required context 数 = 10**（★ 印）。`gh api repos/Takenori-Kusaka/ganbari-quest/rulesets/14673945` の `required_status_checks` 配列（`ci-gate` / `screenshot-check` / `Verify AC map in PR body` / `Measure LP dimensions and lint forbidden terms` / `PR チェックリスト完了確認` / `必須セクションの存在確認` / `関連 Issue 番号の記入` / `変更タイプの選択` / `顧客価値・目的の記入` / `テスト実行結果の記入`）が真の SSOT。本表は「どの workflow がどの context を生むか」のマッピングであり、ruleset 変更時は本表も同期する（#2948 no-go: ruleset と乖離させない）。
>
> **A-2〜A-5 で lane-aware 化した required gate**: `pr-template-gate.yml`（5 job、#2944）/ `pr-ac-verification-check.yml`（#2945）/ `pr-merge-gate.yml`（#2945）/ `pr-quality-gate.yml`（#2946）の 4 workflow（5+1+1+1 = 8 required context）が `actions/pr-lane` 経由で観点切替する。`dependabot-auto-merge.yml`（#2947）は `BOT_ACTORS` SSOT を参照（required ではないが bot lane 判定を共通化）。`ci.yml`（#2874）は inline 式で `pr-lane.mjs` rule 2 と同一判定を行い重量 job を統合 PR で保証発火する。

### 実装状況（§8 step 2、#2931 で実施済み / #2874 で重量レーン拡張）

- **`ci.yml`**: `pull_request: branches: [main, develop]` 化。重量 job（`storybook-test` / `e2e-test` / `a11y` / `e2e-cognito-dev` / `docker-build` / `e2e-demo-lambda`）は `github.base_ref != 'develop'` 条件で develop 向け PR では skip。`ci-gate` の required status check context 名は互換維持（skip job は gate を block しない）。
- **#2874 拡張**: 統合 PR（base==main && head==develop、`scripts/pr-lane.mjs` rule 2 が判定 SSOT）では重量 job 6 種を paths filter に依らず**保証発火**（inline `if:` OR）。`e2e-matrix`（mode×plan matrix 4 project）を重量レーンに新設し `ci-gate` needs へ追加。`integration-evidence` job が §3.5 #3/#4 エビデンスを artifact `integration-pr-evidence-<run_id>` として自動生成（`if: always()`、ci-gate needs 非所属 = gate ではない）。`deploy-aws-staging.yml` は paths filter を撤去し main 向け PR で常時発火（required 化前提、段階導入は [runbooks/staging-gate-required-checks.md](../runbooks/staging-gate-required-checks.md)）。
- **`codeql.yml`**: 改修なし = 重量レーン扱い。develop 向け PR では発火せず、develop → main 統合 PR（pull_request → main）+ main push で coverage を維持する（per-PR の数分のスキャンコストを軽量レーンから排除する判断、#2931）。

## §5 hotfix 経路

`priority:critical` の本番修正は git flow 標準どおり **main 直行 hotfix branch** とする。

- **経路**: `fix/*`（main から分岐） → `main` への PR → merge → main → develop へ back-merge。
- **gate**: hotfix PR は **重量 gate を維持**する。ADR-0002 §4 の Critical 品質ゲート（E2E 回帰 / AC 全完了 / 提案全実装 / 5 年齢モード検証 / 直近 30 日重複変更チェック）を省略しない。緊急であっても gate 省略は禁止。
- **back-merge 必須**: hotfix を main に merge したら、同じ修正を develop に取り込む（main / develop の drift 防止）。この「必須」は `hotfix-back-merge.yml`（#2951）が機械強制する — main への hotfix（`fix/*` / `hotfix` / `priority:critical` label）merge を契機に main→develop の `back-merge/<ref>` PR を自動発行する（判定 SSOT = `scripts/hotfix-back-merge.mjs`）。conflict 時は強制 push せず `status:blocked` 付き PR + 通知で人手解決へ。統合 PR（develop→main）merge は同期済のため除外（無限ループ防止）。back-merge PR は `back-merge` label を持ち、B-3 統合 PR §6 が「未取込 hotfix（drift）」状態として読む。author は Takenori-Kusaka を維持する（PAT `BACK_MERGE_PAT` 経由、ADR-0022 Amendment 4-2）。
- develop 経由で critical 修正を遅延させない目的のための例外経路であり、critical 以外は本経路を使わない。
- **例外**: CI 環境構築（workflow / runner 整備）のための main 直 PR は例外として許容し、QM がレビューする（2026-06-11 User 指示）。

## §6 役割分担

| レビュー対象 | 担当 role | cadence | gh アカウント |
|---|---|---|---|
| feature → develop PR | QM | 毎時 | `ganbariquestsupport-lab` |
| release/* → main 統合 PR（§3.1） | 外部品質監査チーム | 1 日 1 回 | `ganbariquestsupport-lab`（role 区別） |

- QM と外部品質監査チームは同一 gh アカウントを使い、**担当する PR の種別（base branch）で role を区別**する。QM = feature → develop の軽量レーン approve / merge、外部品質監査チーム = release/* → main（§3.1）の最重厚レーン発行・判定・merge。
- ADR-0022（admin bypass 禁止 / `ganbariquestsupport-lab` QM Approve 体制）との関係: 本戦略は ADR-0022 の「Takenori-Kusaka 作成 / ganbariquestsupport-lab approve」役割分離を二層に拡張する。ADR-0022 本文への amendment（base branch 別の required reviews 適用）は workflow 改修 PR と同期して別 PR で行う。

## §7 Branch Ruleset 変更（ユーザー手動）

現行 Ruleset の確認・変更はユーザー手動作業。本 SSOT merge 後に実施する（§8）。

- **現状確認コマンド**:

  ```bash
  gh api repos/Takenori-Kusaka/ganbari-quest/rulesets/14673945
  ```

  現行 ruleset（id=14673945、name `PR_Mearge`、target=branch、condition=`~DEFAULT_BRANCH`=main）は `pull_request`（required_approving_review_count=1）+ `required_status_checks`（ci-gate / screenshot-check / Verify AC map / Measure LP dimensions / PR チェックリスト 等）+ `non_fast_forward` を強制している。
- **必要な変更（2 点）**:
  1. **main 向け PR の base 制限**: 「main へ PR を出せるのは develop と hotfix branch のみ」を Ruleset 単体で表現するのは困難（Branch Ruleset は head branch の base 制限を直接持たない）。**補完案**として、`main` 向け PR の base / head を workflow gate で検査し、`develop` / `fix/*` 以外を head とする main 向け PR を fail させる方式を採る — **#2931 で `ci.yml` の `main-pr-base-guard` job として実装済み**。有効化は repository variable **`BRANCH_STRATEGY_CUTOVER_AT`**（ISO 8601 UTC 日時、ユーザー手動設定）。未設定なら gate inactive、設定後は設定日時より後に作成された main 向け PR のみ enforce（既存 open PR は grandfather 免除 = §8 step 6）。bot（dependabot / renovate）は exempt（`dependabot.yml` の `target-branch: develop` 切替は cutover 完了時に別途実施）。
  2. **develop 用 ruleset の整理**: 2026-06-04 時点で既存 ruleset `PR_Mearge` (id=14673945) の include に `refs/heads/develop` が追加済みだが、これは main と同一の required checks（重量含む）を develop に課す形であり §4 の軽量レーン設計と相違する。#2931 の workflow 改修により `ci-gate` は develop 向け PR でも報告される（重量 job は skip 扱いで gate を block しない）ため、当面は同居でも詰まらない。ただし設計どおり **`develop` を target とする軽量 ruleset を分離新設**（lint-and-test / unit-test / PR テンプレ gate 等のみ required、e2e / a11y / docker は含めない）し、`PR_Mearge` の include から develop を外すことを推奨。
  3. **release/* freeze 保護 ruleset（§3.1、#3063）**: `release-lane-freeze`（id 17725378、target=`refs/heads/release/*`、`non_fast_forward` のみ）を新設済み。cut した release branch の force-push（history 書換）で audit 標的が動くのを機械的に防ぐ。deletion guard は付けない（merge 後 auto-delete を妨げないため）。release/* → main の PR 承認・required checks は既存 `PR_Mearge`（target=main）が担うため、本 ruleset に required_status_checks / pull_request は付けない。

- **`BACK_MERGE_PAT` repository secret 設定（ユーザー手動、#2951）**: `hotfix-back-merge.yml`（§5 back-merge 機械強制）と B-3 daily 統合 PR 自動発行（#2871）は、`secrets.GITHUB_TOKEN` で PR を作ると author が `github-actions[bot]` になり `pr-author-guard.yml` に auto-close されるため、author=Takenori-Kusaka 維持に `Takenori-Kusaka` 個人 PAT を repository secret `BACK_MERGE_PAT`（権限: `contents:write` + `pull-requests:write`、classic なら `repo` scope）として設定する必要がある。未設定でも workflow は fail せず、hotfix merge 時に「PAT 未設定で back-merge 未発行 = drift」を Discord（`vars.DISCORD_WEBHOOK_URL`）+ job summary で通知し silent fail を避ける（人手 back-merge で代替できる）。本 secret は B-3 と共有する（両者で 1 つ）。

## §8 無停止 cutover 手順（順序厳守）

進行中の Dev / QA チームを突然ブロックしないため、以下の順序を厳守する。

1. **本 docs PR を merge**（ルール文書を先に確定）。— ✅ 完了（#2858）
2. **workflow 改修 PR**: `branches: [main]` 4 本の develop 向け発火追加 + 軽量 / 重量の振り分け + main 向け PR の base/head 検査 gate 追加。集約 job 名（`ci-gate` 等 required status check の context 名）は互換維持する。— ✅ 完了（#2931、§4「実装状況」参照）
3. **develop branch 作成**: `main` から分岐して `develop` を作る。
4. **数 PR で実測確認**: develop 向け軽量レーン PR を数本流し、軽量 / 重量の振り分けが期待どおりかを実測する。
5. **Ruleset 変更（ユーザー手動）**: §7 の develop 用 ruleset 整理 + repository variable `BRANCH_STRATEGY_CUTOVER_AT` の設定（main 向け base 制限の有効化）。
6. **既存 open PR は retarget しない**: merge 済みになるまで現行ルール（main 向け）のまま扱い、新規 PR から develop 向けに切り替える。強制 rebase / retarget はしない。
7. **周知**: dev / po / qa session 各 doc に本 SSOT への参照を 1 行追加（本 PR で実施済み）。
8. **ロールバック**: develop を廃止する場合は **develop branch 削除 + workflow revert のみ**で戻せる。deploy 経路（main push）は一切変えないため、ロールバックも無停止。

## §9 将来オプション

- **統合 PR cadence 段階導入（#2871、現在進行中）**: `integration-pr.yml` の schedule は **週 2 回（月・木 JST 06:00 = cron `0 21 * * 0,3`）から開始**し、運用が安定したら **1 日 1 回（cron `0 21 * * *`）→ 必要なら 1 日 2 回** へ段階的に引き上げる。初期 cadence をいきなり daily にしない（drift 蓄積を防ぎつつ GitHub Actions 分の消費を抑制、ADR-0010）。cadence 変更は `integration-pr.yml` の `cron` 1 行更新で行い、運用手順は B-6 runbook に記載する。`workflow_dispatch`（手動 + `dry_run` input）は cadence と無関係に常時利用可能。
- **12 時間 cadence 化**: develop → main を 1 日 2 回に増やす（上記 daily の次段）。並行作業量が増えた段階で判断する。
- **GitHub Merge Queue（`merge_group`）**: 並行 PR が常態化した場合、統合 PR を batch full-gate するために GitHub Merge Queue の導入を検討する。
- **NUC / AWS Staging 構築 CI + ブラックボックス・仮ユーザテスト**: 重量レーンに staging 環境構築と仮ユーザテストを追加する。AWS staging は serverless 設計で idle ≈ ¥0（PO 確認済み）だが、cdk deploy の CI wall-time と stack 命名・分離設計を先に設計してから導入する。
