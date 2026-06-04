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

## §3 ブランチ規則

| 項目 | ルール |
|---|---|
| 命名 | `feat/*` / `fix/*` / `refactor/*` / `docs/*` / `infra/*`（既存の type label 接頭辞と一致） |
| 切る元 | `develop`（hotfix を除く） |
| PR 先 | `develop`（hotfix を除く） |
| main へ PR を出せる branch | `develop`（統合 PR）と hotfix branch（§5）の **2 系統のみ** |
| 長命 branch | 禁止。feature branch は develop merge 後に削除。develop は恒久 branch |

- 新規作業は必ず `develop` から branch を切り、`develop` 向けに PR を出す。`main` を直接 base にした feature PR は出さない（hotfix を除く）。
- `develop` は `main` から分岐した恒久 branch。統合 PR（develop → main）merge 後も削除しない。

## §4 gate 二層対応表

軽量レーン（→ develop PR）と重量レーン（develop → main 統合 PR）の job 振り分け。実測所要は本リポジトリの CI 観測値（`ci.yml` の各 job）。

### 軽量レーン（feature → develop PR）

| job | 内容 | 実測 |
|---|---|---|
| `lint-and-test` | Biome / svelte-check / stylelint / cspell / knip / build | 約 199s |
| `unit-test`（×2 shard）+ `unit-test-merge` | vitest + coverage ratchet | 約 259s |
| `site-check` | site/ HTML / forbidden terms（site 変更時） | ≤ 53s |
| `new-env-distribution-check` / `schema-change-tests-check` / `schema-migration-completeness-check` | env 配布証跡 / スキーマ互換 | ≤ 53s |
| PR テンプレ gate（`pr-template-gate.yml` 5 job / `pr-ac-verification-check.yml`） | 必須セクション / AC マップ | ≤ 53s |

### 重量レーン（develop → main 統合 PR）

| job | 内容 | 実測 |
|---|---|---|
| 軽量レーン全 job | 上記すべてを再実行（集約検証） | — |
| `e2e-test`（×3 shard）+ `e2e-merge-reports` | Playwright E2E matrix | shard あたり最大 909s |
| `a11y` | axe-core WCAG 2.2 AA | 約 745s |
| `e2e-cognito-dev` | 認証・課金 E2E | 約 169s |
| `docker-build` / `e2e-demo-lambda` | Docker build + demo Lambda 等価検証 | 約 133s |
| `storybook-test` | Storybook interaction（play） | 約 106s |
| visual regression（`lp-visual-regression.yml` / `child-home-visual-regression.yml` / `app-visual-regression.yml`） | pixelmatch baseline 比較 | — |
| （将来 phase）NUC / AWS Staging 構築 CI + ブラックボックス・仮ユーザテスト | §9 参照 | — |

### 実装上の注意（workflow 改修は別 PR、§8 cutover で実施）

- **`pull_request: branches: [main]` 固定の workflow は 4 本**: `ci.yml` / `codeql.yml` / `dependency-review.yml` / `pr-info.yml`。これらは develop 向け PR では発火しないため、develop 向け発火への改修が必要（軽量 / 重量の振り分けを含む）。
- **`branches` 無指定（`paths` scope のみ）の workflow は develop 向け PR でも発火する**: `lp-metrics.yml` / `lp-fallback-check.yml` / `pr-template-gate.yml` / `pr-ac-verification-check.yml` / `pr-merge-gate.yml` / `pr-quality-gate.yml` / visual regression 3 本など。これらを軽量レーン化（重い検査を develop 向けで skip）するには明示的な skip 改修が必要。
- これらの改修は本 SSOT の merge 後に着手する別 PR の範囲（§8）。本 docs PR では設計のみを確定する。

## §5 hotfix 経路

`priority:critical` の本番修正は git flow 標準どおり **main 直行 hotfix branch** とする。

- **経路**: `fix/*`（main から分岐） → `main` への PR → merge → main → develop へ back-merge。
- **gate**: hotfix PR は **重量 gate を維持**する。ADR-0002 §4 の Critical 品質ゲート（E2E 回帰 / AC 全完了 / 提案全実装 / 5 年齢モード検証 / 直近 30 日重複変更チェック）を省略しない。緊急であっても gate 省略は禁止。
- **back-merge 必須**: hotfix を main に merge したら、同じ修正を develop に取り込む（main / develop の drift 防止）。
- develop 経由で critical 修正を遅延させない目的のための例外経路であり、critical 以外は本経路を使わない。

## §6 役割分担

| レビュー対象 | 担当 role | cadence | gh アカウント |
|---|---|---|---|
| feature → develop PR | QM | 毎時 | `ganbariquestsupport-lab` |
| develop → main 統合 PR | 外部品質監査チーム | 1 日 1 回 | `ganbariquestsupport-lab`（role 区別） |

- QM と外部品質監査チームは同一 gh アカウントを使い、**担当する PR の種別（base branch）で role を区別**する。QM = feature → develop の軽量レーン approve / merge、外部品質監査チーム = develop → main の最重厚レーン発行・判定・merge。
- ADR-0022（admin bypass 禁止 / `ganbariquestsupport-lab` QM Approve 体制）との関係: 本戦略は ADR-0022 の「Takenori-Kusaka 作成 / ganbariquestsupport-lab approve」役割分離を二層に拡張する。ADR-0022 本文への amendment（base branch 別の required reviews 適用）は workflow 改修 PR と同期して別 PR で行う。

## §7 Branch Ruleset 変更（ユーザー手動）

現行 Ruleset の確認・変更はユーザー手動作業。本 SSOT merge 後に実施する（§8）。

- **現状確認コマンド**:

  ```bash
  gh api repos/Takenori-Kusaka/ganbari-quest/rulesets/14673945
  ```

  現行 ruleset（id=14673945、name `PR_Mearge`、target=branch、condition=`~DEFAULT_BRANCH`=main）は `pull_request`（required_approving_review_count=1）+ `required_status_checks`（ci-gate / screenshot-check / Verify AC map / Measure LP dimensions / PR チェックリスト 等）+ `non_fast_forward` を強制している。
- **必要な変更（2 点）**:
  1. **main 向け PR の base 制限**: 「main へ PR を出せるのは develop と hotfix branch のみ」を Ruleset 単体で表現するのは困難（Branch Ruleset は head branch の base 制限を直接持たない）。**補完案**として、`main` 向け PR の base / head を workflow gate で検査し、`develop` / `fix/*` 以外を head とする main 向け PR を fail させる方式を採る（§8 の workflow 改修 PR で実装）。
  2. **develop 用 ruleset 新設**: `develop` を target とする ruleset を追加し、軽量レーンの required status checks（lint-and-test / unit-test / PR テンプレ gate 等）を設定する。重量 job（e2e / a11y / docker 等）は develop ruleset の required には含めない。

## §8 無停止 cutover 手順（順序厳守）

進行中の Dev / QA チームを突然ブロックしないため、以下の順序を厳守する。

1. **本 docs PR を merge**（ルール文書を先に確定）。
2. **workflow 改修 PR**: `branches: [main]` 4 本の develop 向け発火追加 + 軽量 / 重量の振り分け + main 向け PR の base/head 検査 gate 追加。集約 job 名（`ci-gate` 等 required status check の context 名）は互換維持する。
3. **develop branch 作成**: `main` から分岐して `develop` を作る。
4. **数 PR で実測確認**: develop 向け軽量レーン PR を数本流し、軽量 / 重量の振り分けが期待どおりかを実測する。
5. **Ruleset 変更（ユーザー手動）**: §7 の develop 用 ruleset 新設 + main 向け base 制限を反映。
6. **既存 open PR は retarget しない**: merge 済みになるまで現行ルール（main 向け）のまま扱い、新規 PR から develop 向けに切り替える。強制 rebase / retarget はしない。
7. **周知**: dev / po / qa session 各 doc に本 SSOT への参照を 1 行追加（本 PR で実施済み）。
8. **ロールバック**: develop を廃止する場合は **develop branch 削除 + workflow revert のみ**で戻せる。deploy 経路（main push）は一切変えないため、ロールバックも無停止。

## §9 将来オプション

- **12 時間 cadence 化**: develop → main を 1 日 2 回に増やす（現状は 1 日 1 回）。並行作業量が増えた段階で判断する。
- **GitHub Merge Queue（`merge_group`）**: 並行 PR が常態化した場合、統合 PR を batch full-gate するために GitHub Merge Queue の導入を検討する。
- **NUC / AWS Staging 構築 CI + ブラックボックス・仮ユーザテスト**: 重量レーンに staging 環境構築と仮ユーザテストを追加する。AWS staging は serverless 設計で idle ≈ ¥0（PO 確認済み）だが、cdk deploy の CI wall-time と stack 命名・分離設計を先に設計してから導入する。
