# 外部品質監査チーム — 役割定義 SSOT

> **このファイルの位置づけ**: develop → main 統合 PR を客観的第三者視点で監査する「外部品質監査チーム」のロール・責務・境界の SSOT。マネージャ orchestrator + 8 チーム + ポリシー準拠判定 agent の役割、skill 再利用マップ、QM との 2 段 gate 境界、マージ判定エビデンス基準、棄却運用 flow を定める。
>
> **関連 Issue**: EPIC #2861 ｜ A1 = #2862 ｜ **関連 ADR**: ADR-0056（QM Orchestrator role drift の構造的対処）/ ADR-0022（QM Approve 体制・admin bypass 禁止）/ ADR-0010（Pre-PMF scope）
>
> **上流 SSOT**: ブランチ運用・gate 二層・merge 責任分担は [branch-strategy.md](branch-strategy.md)。QM Tier1/Tier2 の 2 層構造は [qa-session.md](qa-session.md)。本ファイルはこの 2 つを継承し、develop → main レーンの監査チーム側のみを定義する。
>
> **本ファイルの守備範囲**: 役割定義 SSOT。daily cron 自動化 / NUC・AWS staging 構築 / 最重厚テスト束ね / 判定エビデンス自動生成などの**実装**は EPIC #2861 の各 sub-issue（B 系 / C 系 / D 系 / E 系）が担う。本ファイルでは「誰が・何を・どの境界で判定するか」のみを確定する。

## §1 設計背景

main = 本番（push 即 deploy、不変条件）であるにもかかわらず、現状の品質ゲートは「Dev 自己レビュー + QM 毎時レビュー（per-PR の機能正しさ判定）」までで止まっている。

- **統合前に CUJ（Critical User Journey）を横断する第三者監査層が存在しない**: QM は feature → develop PR 単位で「その PR の機能が AC どおりか」を毎時判定するが、複数 PR が develop に積み上がった後の「統合状態で顧客体験が崩れていないか」を横断検査する役割が不在だった。個別 PR が全て緑でも、統合後に画面間の整合・CUJ 通し体験が崩れる事故は per-PR review では原理的に捕捉できない。
- **この役割定義がないと困ること**: 監査チームが「何を判定し、何を判定しないか」が曖昧だと、(1) 毎時 QM レビューと判定が衝突して二重判定になる（EPIC 失敗シナリオ⑤）、(2) self-review が形骸化したまま統合 merge される（同①、ADR-0056 が実証した QM drift 42 回再発の延長）、(3) 検出問題を 1 件で即棄却して残りを発露させず triage 不能に陥る（同⑥）。役割・境界・エビデンス基準を SSOT として固定して初めて、これらの構造的失敗を防げる。
- **既存の `docs/sessions/` 同型**: PO / Dev / QA のロール定義が `docs/sessions/` 配下にあるのと同じく、監査チームのロール定義もここに置く。QM の Tier1/Tier2 2 層構造（[qa-session.md](qa-session.md)）と ADR-0056 §E（subagent ≠ orchestrator の役割分離）を継承し、独自の構造を増やさない。

## §2 設計原則

- **マネージャ orchestrator 専権 + subagent は evidence 生成まで（ADR-0056 §E 継承）**: 不可逆 side-effect（統合 PR の approve / merge、Issue 起票の実行）は audit-manager orchestrator が直接実行する。8 チーム・ポリシー準拠判定の各 agent は finding（structured JSON evidence）を生成・報告するまでが責務で、approve / merge / 起票 action を肩代わりしない。これは QM Orchestrator の V-7 専権（[qa-session.md](qa-session.md) §「全手順 Pass → approve & merge」）と同型。
- **self-report 単独信頼の禁止（PO 判断 5 / ADR-0056）**: 監査チームの merge 判定は structured JSON evidence + adversarial verify を物理強制する。各 agent の「問題なし」自己申告だけでは merge しない。Echoing（arXiv:2511.09710）と Persona Drift を抑制するため、Adversarial Reviewer による反対理由生成を evidence の一部として要求する。
- **2 段 gate の責務分離（PO 判断 6）**: QM = feature → develop（per-PR の機能正、毎時）、監査チーム = develop → main（統合前の CUJ 横断、1 日 1 回）。両者は同一 gh アカウント `ganbariquestsupport-lab` を base branch（= レビュー対象 PR の種別）で role 区別する（[branch-strategy.md](branch-strategy.md) §6 継承）。二重判定が起きないよう §3.4 の境界表で「監査チームが判定しないこと」を明示する。
- **全件発露 → filter → 起票/棄却（PO 判断 7）**: 問題は 1 件で即棄却せず、まず全件を発露させる。その後 (1) 重複統合、(2) severity 閾値、(3) ポリシー準拠判定 filter を順に通し、残ったものを Issue 起票 + 棄却判定する。「あえてそうしている」プロダクトポリシー由来の挙動を誤起票しないことが filter の主目的。
- **Pre-PMF 整合（ADR-0010）**: 監査体制は Bucket A（顧客品質の構造的担保）。ただし staging stack / 最重厚テスト束ねは過剰防衛にならぬよう各 sub-issue で個別 bucket 判断する（本ファイルは役割定義のみで AWS コスト影響なし）。

## §3 仕様

### §3.1 チーム構成（マネージャ + 8 チーム + ポリシー準拠判定）

| role | 責務 | 不可逆 action | evidence 形式 |
|---|---|---|---|
| **audit-manager（orchestrator）** | 統合 PR 単位で 8 チーム + ポリシー準拠判定を dispatch → evidence 集約 → 重複統合・severity filter → Issue 起票 + approve/merge を実行 | **可**（approve / merge / 起票は orchestrator 専権） | 集約 evidence + マージ判定エビデンス表（§3.5） |
| 競合調査 | 競合プロダクトの機能・体験・価格を一次情報で調査し、本プロダクトの相対 gap を finding 化 | 不可 | structured JSON（一次情報 URL 必須） |
| 技術調査 | 統合差分の影響範囲（rename / モデル変更 / 大規模リファクタリング）を 4 layer で網羅検査 | 不可 | structured JSON |
| プロダクト実装調査 | 統合状態の実装一貫性・AC 充足・並行実装同期を横断検査 | 不可 | structured JSON |
| ユーザビリティ・a11y | CUJ を仮ユーザ persona で通し、NN/G 観点 + WCAG 2.2 AA の体験品質を検査 | 不可 | structured JSON |
| セキュリティ | 認可境界 / 依存脆弱性 / コードスキャン結果を集約し OWASP 観点で finding 化 | 不可 | structured JSON |
| パフォーマンス | アプリ perf budget + LP メトリクス + visual regression の劣化を検査 | 不可 | structured JSON |
| テスト品質 | テストカバレッジ ratchet・flaky・assertion 弱体化（ADR-0005 / ADR-0006）を検査 | 不可 | structured JSON |
| 問題起票 | filter 通過 finding を Issue 草稿に整形（起票の**実行**は audit-manager） | 不可（草稿まで） | Issue 草稿 JSON |
| **ポリシー準拠判定** | 各 finding が「プロダクトポリシーであえてそうしている」挙動でないかを判定し、誤起票を filter | 不可 | filter 判定 JSON（採否 + 根拠 ADR/docs） |

- 各 agent の evidence は audit-manager が物理 verify する。evidence 不在・schema 不充足の agent finding は採用しない（self-report 単独信頼の禁止、§2）。
- 競合調査 finding は一次情報 URL を必須とし、URL 欠落 finding は audit-manager が自動棄却する（EPIC 失敗シナリオ⑦の幻覚 finding 防止）。

### §3.2 既存 skill / 機構 再利用マップ（重複新設禁止）

EPIC #2861「既存資産再利用マップ」を本ファイルに正本化する。新設は **competitive-research / policy-compliance / audit-manager の 3 点に限定**し、残りは既存 skill / workflow を再利用する。

| チーム | 実装方針 | 再利用元（実在する SSOT を文言で参照） |
|---|---|---|
| audit-manager orchestrator | 新設 | qa-session.md の Tier1/Tier2 2 層構造を継承 |
| 競合調査 | 新設（薄い skill、WebSearch ベース） | issue-triage skill の prior art 手順 |
| 技術調査 | 再利用 | impact-analysis skill / regression-check skill |
| プロダクト実装調査 | 再利用 | pr-review skill / regression-check skill |
| ユーザビリティ・a11y | 再利用 | cognitive-walkthrough skill / customer-voice skill / age-mode-check skill / a11y job（axe-core） |
| セキュリティ | 再利用 | security-scan workflow / codeql workflow / dependency-review workflow |
| パフォーマンス | 一部新設（アプリ perf budget） | lp-metrics workflow / visual regression 3 層 / cost-review skill |
| テスト品質 | 再利用 | flake-hunt skill / ADR-0005 テスト品質 ratchet |
| 問題起票 | 再利用 | issue-triage skill |
| ポリシー準拠判定 | 新設 | pre-pmf-check skill + brand-check skill + adversarial-reviewer skill を統合した判定 |

- 仮ユーザテスト基盤は `scripts/ai-evaluation/`（Stagehand + axe-core + persona の POC、EPIC #2861 D4）の本格化で賄う。本ファイルは役割定義のみで、基盤実装は D 系 sub-issue が担う。
- a11y の `@axe-core/playwright` 採用根拠は ADR インベントリ（[../decisions/README.md](../decisions/README.md) §OSS 採用記録）を参照。
- ユーザビリティ・a11y チームの UX レビュー手順（4 層自動化モデル + NN/G 観点 + A〜D 課題一般化）の SSOT は [webui-review-process.md](webui-review-process.md)。CUJ 横断検査で見つけた UX 問題も同 §4 の A〜D 仕分けで還元先まで finding 化する。

### §3.3 ADR-0056 §E 継承（不可逆 side-effect = orchestrator 専権）

ADR-0056 §E が定義する「subagent ≠ QM（役割分離 SSOT）」を、監査チームにそのまま適用する。

- **subagent（8 チーム + ポリシー準拠判定）**: evidence 生成（finding を structured JSON で出力）が責務。approve / merge / Issue 起票の action 不可。
- **audit-manager（orchestrator）**: subagent 起動 → evidence 物理 verify → filter → 不可逆 action 実行が責務。evidence 生成（finding 自体の捏造）は不可（Echoing 抑制のため自分で finding を作って自分で採用しない）。
- **evidence 配置 SSOT**: structured JSON evidence は main repo 直下の規定ディレクトリに置く（subagent worktree 内のみは NG）。audit-manager は dispatch 後に evidence の物理存在を verify し、不在なら fallback（自筆ではなく再 dispatch ではなく、§3.4 の境界に従い該当 agent を再起動 or BLOCK）する。これは ADR-0056 §E の「evidence 流通 / action 接続点での drift」対策の継承。
- **adversarial verify の物理強制**: merge 判定 evidence には Adversarial Reviewer による反対理由（structured JSON、`must_object_count` を満たす）を含める。これにより self-report 単独信頼を構造的に禁止する（ADR-0056 採用案 B 継承）。

両者を混同すると drift が再発する（subagent が approve を肩代わり / orchestrator が finding を肩代わりで bias）ため、役割境界を越える動作は禁止する。

### §3.4 2 段 gate 境界（QM vs 監査チーム）

「誰が・いつ・何を判定し・何を判定しないか」を表で固定し、二重判定を防ぐ。

| 項目 | QM（毎時 gate） | 外部品質監査チーム（1 日 1 回 gate） |
|---|---|---|
| レビュー対象 PR | feature/fix/docs/* → develop | develop → main 統合 PR |
| cadence | 毎時 | 1 日 1 回（段階導入として週 1〜2 回から開始し、daily 自動化は C 系 sub-issue で確立） |
| gate レーン | 軽量レーン（[branch-strategy.md](branch-strategy.md) §4） | 最重厚レーン（同 §4） |
| 判定の主眼 | per-PR の機能正しさ（AC 充足 / SS / CI 緑 / 場当たり対応検出） | 統合状態の CUJ 横断品質（画面間整合 / 第三者 CUJ 通し体験 / 8 領域監査） |
| **判定すること** | その PR の AC・実装・テスト・UI の正しさ | 統合後の顧客体験・8 領域 finding・competitive gap・マージ判定エビデンス表 |
| **判定しないこと** | 統合後の CUJ 横断品質（= 監査チームの領域） | per-PR 単位の AC 再判定（= QM が develop 取込時点で済ませた領域。監査チームは再判定せず統合状態のみを見る） |
| 不可逆 action 主体 | QM Orchestrator 本体（V-7） | audit-manager orchestrator |
| gh アカウント | `ganbariquestsupport-lab`（QM role） | `ganbariquestsupport-lab`（監査 role、base branch で区別） |

- **二重判定の回避原則**: 監査チームは QM が develop 取込時に確定済みの per-PR AC を再判定しない。監査チームは「develop に積み上がった統合状態」を新しい検査対象として扱い、QM が見られない横断品質のみを担う。逆に QM は統合後の CUJ 横断を判定しない。
- **統合 PR の作成者 ≠ 承認者**: 統合 PR は Takenori-Kusaka 名義（監査マネージャ session）で作成し、`ganbariquestsupport-lab`（監査 role）が approve + merge する。ADR-0022 の作成者 ≠ 承認者分離を維持する（PO 判断 3 / [branch-strategy.md](branch-strategy.md) §6）。

### §3.5 マージ判定エビデンス基準

audit-manager が統合 PR の merge を判定する際に揃えるべき人間可読エビデンス。E 系 sub-issue でこの形式を自動生成するが、ここでは判定に使う仕様を定義する。

**必須エビデンス（4 点 + NG 0 件条件）**:

1. **新機能・修正一覧**: 統合 PR に含まれる develop 上の全変更（feature / fix）を 1 行ずつ列挙（出典 PR 番号 / 変更概要 / 対象領域）。
2. **対応テストケース一覧**: 各変更に対応する unit / integration / E2E / Storybook テストケースを紐付け（変更 × テストの突合表）。
3. **テスト結果表**: 上記テストの実行結果（pass / fail / skip）を最重厚レーン（[branch-strategy.md](branch-strategy.md) §4）の全 job 横断で集約。
4. **自動テストカバレッジ**: カバレッジ値 + ratchet 閾値割れがないこと（ADR-0005 整合）。
5. **NG 0 件エビデンス**: 8 領域 finding のうち severity 閾値以上（§3.6）の未解決 NG が **0 件**であること。残 NG があれば merge しない。

判定可読仕様（表イメージ）:

| 変更（出典 PR） | 対象領域 | 対応テストケース | 結果 | カバレッジ影響 | 残 NG |
|---|---|---|---|---|---|
| 例: 機能 A（#NNNN） | admin/activities | unit×N / e2e×M | pass | 閾値内 | 0 |
| 例: 修正 B（#NNNN） | child-home | unit×N / e2e×M | pass | 閾値内 | 0 |

- 全行が pass + 残 NG 合計 0 + カバレッジ閾値割れなし + adversarial evidence の反対理由が解消済、を満たして初めて audit-manager が merge を実行する。
- 1 行でも fail / 残 NG > 0 の場合は merge せず、該当を §3.6 の起票/棄却 flow に送る。

### §3.6 棄却運用 flow（全件発露 → filter → 起票/棄却）

問題を 1 件で即棄却せず、全件発露 → 3 段 filter → 起票/棄却 の手順で処理する（PO 判断 7 / EPIC 失敗シナリオ②⑥⑦）。

```
[1] 全件発露
    8 チーム + ポリシー準拠判定が finding を structured JSON で全件出力
    （この時点では棄却しない。固定時間 box 内で発露を完了する）
        │
        ▼
[2] 重複統合
    audit-manager が同一原因・同一箇所の finding をマージし重複を 1 件化
        │
        ▼
[3] severity 閾値
    severity 1-2（軽微）= backlog 蓄積のみ（起票せず）
    severity 3-4（重大）= 次段の filter へ
        │
        ▼
[4] ポリシー準拠判定 filter
    「あえてそうしているプロダクトポリシー」由来の挙動か判定
      ├─ ポリシー由来（誤検出）→ 棄却（採否 + 根拠 ADR/docs を記録）
      └─ 真の問題         → 次段へ
        │
        ▼
[5] 起票 or 棄却
    残った真の問題 → 問題起票チームが Issue 草稿 → audit-manager が起票実行
    棄却分        → 棄却理由を evidence に記録（無言棄却しない）
```

- **無限棄却ループの回避**: severity 閾値で打ち切り、閾値未満は backlog 蓄積。各 run は固定時間 box で完了する（EPIC 失敗シナリオ⑥）。
- **起票の実行主体**: Issue 起票の**実行**は audit-manager（不可逆 action）。問題起票チームは草稿生成まで（§3.1 / §3.3）。
- **誤起票防止**: ポリシー準拠判定 filter（pre-pmf-check / brand-check / adversarial-reviewer 統合）で、Anti-engagement（ADR-0012）・Pre-PMF scope（ADR-0010）・ブランド規約に基づく意図的挙動を Issue 化しない。

### §3.7 初回事前準備ゲート（baseline run 着手前に充足必須）

監査 run（特に初回 baseline）を着手する前に、以下 5 項目を audit-manager が検証する。1 項目でも未整備なら、その項目を最初の finding として扱い（無視して run を始めない）、対応 sub-issue へ紐付ける。各項目は最重厚レーン（[branch-strategy.md](branch-strategy.md) §4）が main 取込を保証するための前提。

| # | 事前準備項目 | 充足条件 | 検証方法 |
|---|---|---|---|
| 1 | ブランチ戦略整合 | cutover 済（`BRANCH_STRATEGY_CUTOVER_AT` 設定）/ main・develop ruleset active / lane 判定 SSOT 稼働 | `gh api .../rulesets` + `gh api .../actions/variables` + lane gate の実 PR 通過実績 |
| 2 | staging 環境構築 | develop→main 取込**前**に検証できる staging stack（AWS / NUC）が起動し、本番と同一構成で疎通する | staging deploy workflow の存在 + 疎通 health（本番 deploy workflow とは別系統であること） |
| 3 | 統合 PR 発行準備 | 統合 PR 専用 template（含有 PR 一覧 + §3.5 エビデンス表 + 監査 run リンク）と lane-aware gate が揃い、feature 観点で誤 fail しない | 統合 PR template の存在 + `pr-lane` 判定が integration レーンへ正しく分類 |
| 4 | main 取込最終品質 CI | 最重厚レーン全 job が develop→main で trigger し、AC/template gate が統合観点に切替わる | `ci.yml` heavy job の base_ref filter + pr-merge/ac gate の lane-aware 化状態 |
| 5 | 実機 e2e（AWS + NUC、マイグレ込み起動） | 本番 deploy 後、AWS 版・ローカル NUC 版の両方で **過去状態からマイグレーション込みで正常起動** し、post-deploy e2e/smoke が緑 | deploy workflow 内の migration step + post-deploy e2e/health（self-hosted runner 含む） |

- **未整備項目の扱い**: §3.6 の起票/棄却 flow に乗せ、対応 sub-issue（EPIC #2861 の A/B/C/D/E 系）へ紐付ける。前提未整備で実施できない検査領域は「実施不能」と run 結果に明記し（無言 skip しない）、充足後に再実施する。
- **段階導入**: 全 5 項目が揃うまでは、充足済み項目に対応する検査領域のみで部分 run を回し、残りは finding として可視化する。

### §3.8 毎回 run の標準 9 ステップ（develop→main 統合監査サイクル）

事前準備ゲート（§3.7）充足後、各 run（1 日 1 回 gate）は以下 9 ステップを順に実行する。audit-manager が orchestrate し、deepresearch / テスト追加 / 起票は subagent へ dispatch、不可逆 action（PR 発行 / merge / 起票実行）は orchestrator 専権（§3.3）。

| step | 内容 | 主体 | 不可逆 |
|---|---|---|---|
| 1 | develop→main の変更差分を整理（含有 feature/fix を §3.5 一覧化） | audit-manager | — |
| 2 | 差分に対し実施すべきテスト範囲を洗い出す（影響領域 × テスト種別） | 技術調査 / テスト品質 | — |
| 3 | テスト範囲・方針・影響範囲見積もりを deepresearch し抜け漏れを確認 | 技術調査（deep-research） | — |
| 4 | テストケース一覧 + 自動テスト追加（E2E / Storybook / API）。**develop に既存のテストとの網羅性マッピング**を行い冗長を排除 | テスト品質 | — |
| 5 | 追加テスト一式を **develop ブランチへ PR** として提出 | audit-manager（PR 発行） | **可** |
| 6 | テスト取込後の develop から **統合 PR を発行** | audit-manager（PR 発行） | **可** |
| 7 | 統合 PR の全 CI 成功を確認。fail は **1 件で止めず全件洗い出し**、各々 deepresearch で真因特定・なぜなぜ分析・横展開（影響範囲）まで行い **Issue 起票** | audit-manager（起票） + 各領域 agent | **可** |
| 8 | 全緑なら統合 PR を merge → 本番 deploy actions を watch し成功確認 | audit-manager（merge） | **可** |
| 9 | deploy 完了後、本番 **AWS 版・ローカル NUC 版の両方へ health check** | audit-manager + deploy-verify skill | — |

- **全件発露原則（step 7）**: CI fail は最初の 1 件で止めず、固定時間 box 内で全 fail を発露させてから triage する（§3.6 / EPIC 失敗シナリオ⑥）。起票 Issue には真因・なぜなぜ・横展開（同種 defect の他箇所）を必須記載する（ADR-0003 Issue 品質）。
- **冗長テスト回避（step 4）**: develop 取込時点で feature PR が追加済みのテストと突合し、同一観点の二重追加を避ける。監査チームが足すのは「統合状態でしか検出できない CUJ 横断テスト」に限る（§3.4 二重判定回避と同型）。
- **健全性確認（step 9）**: AWS / NUC の health check は deploy-verify skill を再利用する。NUC 版は self-hosted runner（`local_nuc`）経由で実機起動を確認する（§3.7 #5 と対）。

## §4 関連参照

| 参照先 | 役割 |
|---|---|
| [branch-strategy.md](branch-strategy.md) | ブランチ運用・gate 二層・merge 責任分担の上流 SSOT（§6 役割分担を継承） |
| [qa-session.md](qa-session.md) | QM Tier1/Tier2 2 層構造（audit-manager がこれを継承） |
| [../decisions/0056-qm-drift-prevention-by-structural-agent-constraint.md](../decisions/0056-qm-drift-prevention-by-structural-agent-constraint.md) | §E 役割分離 SSOT（不可逆 side-effect = orchestrator 専権） |
| [../decisions/0022-admin-bypass-disable-qm-approve.md](../decisions/0022-admin-bypass-disable-qm-approve.md) | 作成者 ≠ 承認者分離・admin bypass 禁止 |
| [../decisions/0010-pre-pmf-scope-judgment.md](../decisions/0010-pre-pmf-scope-judgment.md) | Pre-PMF scope 判断（監査体制の bucket A 整合） |
| EPIC #2861 | 5 phase 実装計画（本ファイルは A1、実装は B/C/D/E 系 sub-issue が担う） |
