# 0007. 静的解析 tier ポリシー (T1/T2/T3/T4 + EPIC-merge / customer-review tier)

- **Status**: Accepted (2026-05-27 EPIC-merge tier 追加、#2544 / 2026-07-18 §6 eslint-plugin-svelte 追記、#3878 / 2026-07-19 §7 dependency-cruiser required 昇格 ratify、#3895)
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265 / #2544 / #3878 / #3895

## コンテキスト

> 旧 ADR-0032 を renumber した新採番。ADR 10 枠再構成（#1262）の一環。

#969-#984 で静的解析ツール 7 本（Biome opt-in / knip / jscpd / sonarjs / type-coverage / cspell / Biome 広域拡張）の導入 Issue が並行起票されたが、**実行頻度指定が不統一**。全ツールを PR 毎に走らせると `lint-and-test` の既存重量に積み上がり、Pre-PMF 1 人体制では CI 待ちが最大のボトルネック要因となる。

**根本原因**: 「ツールを導入すれば品質が上がる」という発想のまま 7 本並べ、**実行頻度 × blast radius の組合せを設計していない**。CI 時間は無尽蔵ではないので、頻度設計こそが品質戦略である。

## 決定

### 1. 4 階層の定義

| 階層 | 実行頻度 | 判定ルール | 失敗時の扱い | 想定ツール |
|------|---------|-----------|-------------|----------|
| **T1 PR ゲート** | 全 push / PR 毎 | < 30s AND merge されたら致命的 | CI 失敗 / merge block | biome check / svelte-check / stylelint / vitest unit / knip（fast） / type-coverage 閾値チェック |
| **T2 PR 並行レーン** | 全 PR、別 job | 30s-3min AND 誤検知があっても merge 判断は人間 | CI 失敗 / merge block（override 可） | Playwright E2E / sonarjs（要計測） |
| **T3 nightly / 週次** | main に schedule | > 3min OR 広域 debt 検知 | **PR は止めない** / finding は PR コメント or Accepted residual に記録 (2026-07-30 改訂) | jscpd / cspell / Biome 広域 / madge circular |
| **T4 四半期 / 手動** | cron quarterly or workflow_dispatch | 重い / 外部 API コスト | 発見 → PR コメント or Accepted residual に記録 (2026-07-30 改訂) | 脆弱性スキャン / type-coverage ベースライン更新 |

**T3 / T4 finding の Issue 化基準 (2026-07-30 改訂)**: **Issue 化するのは、顧客の金・データ・法務に接続する finding のみ**とする。それ以外は PR コメント / 統合 PR の Accepted residual に記録して閉じる。旧「finding を Issue 自動起票」は装置起因の Issue を量産し、backlog の 10% が「同 class N 例目」を名乗る装置修理 Issue で占められた (#4121 棚卸の実測)。ADR-0061 原則 2 の適用対象限定 (装置の不具合に class-lock を掛けない) と同じ理由による。

### 1-2. gate を残すか消すかの判断原則 v2 (2026-07-30、#4121)

装置 (CI gate / hook / check script) を減らすときは、**まず何を守っているかで類型を決める**。

| # | 何を守るか | 扱い |
|---|---|---|
| 1 | **証跡の真正性 / 不可逆な損失**（偽装・成果物の消失・自己承認） | **hard-fail で残す** |
| 2 | **顧客に見える正しさ**（XSS / LP の嘘 / 用語） | **残す**。cheap なら hard-fail、重ければ warn |
| 3 | 書式・網羅性・手続きの整合 | **warn 降格 or 撤去** |
| 4 | 参照ゼロ | **削除** |

**「稼働中だが keep list に無い」は削除理由にならない。** keep list は hard-fail の一覧であって「守る価値のあるものの全集」ではない。削除の前に類型 1〜4 のどれかを明示する。

> 本原則は #4121 で「消すか keep list に入れるかの二択」と書いた誤りの訂正である。二択のままだと、稼働中で価値のある gate に対して消す以外の選択肢が無くなる (実際に `check-recent-deploy-deletion` = 類型 1 と `check-lp-innerhtml-tags` = 類型 2 が削除候補に載った)。

**適用実績 (#4121 Wave 2)**:

- `check-lp-plan-sync` を advisory (`continue-on-error`) から **hard-fail に復帰**（本 script は後日 #4322 で削除済み、#4420）。回帰ガード: `tests/unit/scripts/pre-ready-step-budget.test.ts` [P6] / [P7]
- **`check-pr-body.mjs` の 26 検査を id 単位で blocking / advisory に分離** (#4121 決裁 4、2026-08-02)。1 本の script に 類型 1 と 類型 3 が同居していたため **script 単位で「pr-body は類型 1」と扱われ、書式検査 19 本が類型 1 の看板で hard-fail に残っていた**（統合 PR #3995 が 60 check 中 57 SUCCESS でありながら書式 gate 2 本で 4 日間 BLOCK された実害の構造）。**hard-fail するのは `BLOCKING_GATES` に明示列挙した 7 件のみ**（証跡の宛先 / close 宣言の着地 / 証跡なき自己申告 / PO 決裁ブリーフ 3 件 / 統合 PR エビデンス表）で、**列挙されていない検査は advisory が既定**。新しい検査を足すときに hard-fail 化を明示的な意思決定にするための向き付け（憲章 §3.4 制約 1 と同型）。advisory は `ADVISORY-IDS <ids>` の 1 行を必ず出し、**2 run 連続で無反応なら削除候補**として棚卸しに上げる（記録用の新装置は作らず CI ログを grep する）。回帰ガード: `tests/unit/scripts/check-pr-body-severity.test.ts`（id タイプミスで gate が無言 advisory 化するのを機械検出）
- `npm run pre-ready` を **20 step → 6 step** に縮小 (類型 1: pr-body / ss-embed-gate、類型 2 cheap: biome / svelte-check / plan-literals / local-tz-getters)。当時「外した 14 検査は消していない」としていたが、うち大半は **#4322 (#4291 品質ゲート 80 点主義削減) で script / workflow ごと削除済み**。現存し CI で hard-fail し続けているものの最新対応表は `npm run pre-ready -- --help` を参照（`capture` step のみ、検査せずガイダンスを表示するだけ (類型 4 = 参照ゼロ相当) のため撤去）

### 2. 新ツール導入時の判断フロー

```
Q1. 実行時間は？
  < 30s   → Q2 へ
  30s-3min → Q3 へ
  ≥ 3min  → T3 or T4 確定

Q2. merge されたら直ちに本番影響か？
  YES → T1
  NO  → T3（debt 検知）

Q3. 誤検知率が高く人間判断が要るか？
  YES → T2
  NO  → T1
```

### 3. 実行時間予算

- **T1 合計**: `lint-and-test` 全体で **≤ 3min**。新規 T1 追加は **+30s 以下** を目安
- **T2 合計**: `e2e-test` + 並列 job で **≤ 5min**
- **T3 / T4**: 実行時間制限なし（main 専用、ブロックしない）

T1 合計が 3min を超えた時は、最も遅いツールを T3 へ降格することを **先に検討**する（新規ツール追加拒否より先に）。

### 4. 運用ルール

- 昇格 / 降格は本 ADR に追記する（別 ADR 不要、文書同期のみ）
- 新ツール導入 Issue には「想定階層」欄を必須化
- T1 / T2 job の実行時間を定期モニタ
- **required 化（merge block 化）の実装点は `ci.yml` の `ci-gate` job `needs:` 登録**（#3895）。branch ruleset (`PR_Mearge`) は `ci-gate` 単一 context を required とする集約設計のため、個別 job の required / advisory は needs 登録の有無で決まる（ruleset 変更は不要）。`ci-gate` の `needs:` に job を追加 / 削除する PR は、本 ADR の階層マッピング表を**同 PR で同期**する（silent な gating policy 変更の禁止）
- **warn 降格の実装点も同じ `ci-gate` の `needs:`**（2026-07-30 明記）。job を `needs:` から外せば job 自体は走り続けるが merge を止めなくなる = advisory 化である。`continue-on-error` を足す必要はない。降格した job は階層マッピング表の「階層」列を T1/T2 → T3 相当 (advisory) に更新し、**同 PR で表を同期**する

### 既存 CI の階層マッピング（baseline）

| job | 階層 | 備考 |
|-----|------|------|
| Biome check / Stylelint / Parallel sync | T1 | < 10s |
| svelte-check | T1 | ~30s |
| vitest --coverage | T1 | ~60s |
| Storybook build | T2 相当 | stories 変更時 fan-out |
| Playwright | T2 | ~2min |
| `new-env-distribution-check`（ADR-0006） | T1 | — |
| `schema-change-tests-check` | T1 | — |
| ESLint Svelte (`lint:svelte`、recommended + suppressions) | T1 | < 30s、merge block、#3878（§6） |
| `dependency-cruiser`（app + infra、#3871） | T2 | 並行 job、merge block（`ci-gate` needs 登録、#3895 ratify、§7）。baseline 12 件（循環 8 + orphan 4）は `--ignore-known` で pin、新規違反のみ block |
| `cdk-cfn-lint`（#3874） | T2 | 並行 job、merge block（`ci-gate` needs 登録） |
| jscpd 週次 | T3 | cron |
| 脆弱性スキャン | T4 | 四半期 / 手動 |

### 5. EPIC-merge / customer-review tier (#2544 で追加)

T1-T4 は「実行頻度 × blast radius」で **静的解析・自動テスト** を階層化したが、**「動くが分かりにくい」UX 層 (謎用語 / 経路重複 / dead-end からの脱出不能) と CUJ 全網羅貫通は、per-PR で毎回回すには重く、機械だけでは判定しきれない**。本リポジトリの実害 (初顧客レビュー直前、marketplace 取込で「追加無反応・キャンセル不能」+「パックから追加」謎用語を実ユーザーが 1 分で発見) は、**per-PR の targeted 検証では捕捉しきれず、顧客に当たる直前の総合検証が欠けていた**ことが構造的原因。そこで横断的に「**2 層 cadence**」を本 ADR の SSOT として定義する。

| 層 | 実行タイミング | 内容 | 性質 |
|---|---|---|---|
| **per-PR (T1/T2 に含む)** | 全 PR | 変更領域の targeted E2E (act → outcome、render-only 禁止、`playwright/expect-expect` gate) + svelte-check + Storybook play (`npm run test:storybook`) + 用語 coherence lint (`check-internal-terms` / `check-add-path-coherence`) | 機械・高速、CI gate |
| **EPIC-merge / customer-review** | EPIC 完了時 / 顧客レビュー前 (この規模だけ) | 全 critical user journey の goal 完遂貫通 E2E + Cognitive Walkthrough 4 質問 (#2459 C-2) + a11y (addon-a11y) + visual (pixelmatch) + 実機 1 クリック貫通 | per-PR では重い総合検証。半自動 (lint) + 人間判断 (walkthrough) を集約 |

- **判定ルール**: 「interactive flow を触る test は per-PR でも act → outcome assert 必須 (render-only 禁止)。ただし CUJ 全網羅貫通 / Cognitive Walkthrough / visual baseline 全件は EPIC-merge / 顧客レビュー gate に置く」。
- **失敗時の扱い**: EPIC-merge / customer-review gate は **merge を止めるのではなく「顧客に当てる前の必須チェックリスト」** (CX 版 DoR、#2459 C-1)。Pre-PMF では顧客レビュー = 貴重な「最初の 5 人」枠 (NN/G 5-user rule) なので、明白な 85% 級問題はこの gate で潰す。
- **SSOT**: 横断 cadence ポリシーは本節を SSOT とし、`tests/CLAUDE.md` §interactive flow / §2 層 cadence はその tests/ 視点の抜粋とする。

### 6. eslint-plugin-svelte recommended の活性化と Runes semantic の lint 対象外原則 (#3878 で追加)

`eslint-plugin-svelte` は導入済みだったが `svelte/no-at-html-tags` の 1 本のみ有効で、公式 `svelte.configs.recommended` の十数ルール（Runes/reactivity correctness）が **死蔵**していた。#3878 で recommended を `.svelte` に適用し T1 gate 化した。

- **層の責務分離（二重化しない）**: 型 = `svelte-check --threshold warning`（T1） / a11y = Svelte compiler warning を svelte-check が surface + `@axe-core/playwright` E2E / Runes・reactivity・SvelteKit correctness = `eslint-plugin-svelte` recommended（本節）。**`svelte/valid-compile` は追加しない**（compiler warning の ESLint 再実行 = svelte-check と二重）。**a11y ルールは eslint-plugin-svelte に存在しない**ため追加不能。自作 `local/*`（no-raw-button 等）と重複する opt-in ルール（no-inline-styles 等）も追加しない。
- **既存違反の baseline 凍結（ratchet）**: recommended 有効化で既存コードに 483 error が出る（内訳: `no-navigation-without-resolve` 166 / `require-each-key` 133 / `no-useless-children-snippet` 113 / `prefer-svelte-reactivity` 15 / `prefer-writable-derived` 11 / `no-unused-svelte-ignore` 7 / `no-useless-mustaches` 2 + 既存 `local/*` 36）。ESLint 10 native bulk suppressions（`eslint --suppress-all` → `eslint-suppressions.json` を commit）で凍結し、**新規違反のみ CI fail**。段階返済後は `eslint --prune-suppressions` で baseline を ratchet down する（assertion 弱体化・ルール一括 disable は ADR-0006 禁止）。SSOT = `eslint.config.js`（recommended spread）+ `eslint-suppressions.json`（baseline）+ `.github/workflows/ci.yml`（`lint:svelte` hard gate）。
- **Runes semantic 判断は lint 対象外＝PR review 領域**: Svelte 5 公式が最も警告する「`$effect` で state を derive/同期するな、`$derived` を使え」は、静的に捕まるのは `prefer-writable-derived` の単一代入 trivial shape のみ。effect 本体に分岐・複数文が入ると linter は沈黙する。「この effect は derived にすべき」の意図判断は ESLint では原理的に不可能なため、**lint は syntactic footgun を潰し、semantic 判断は PR review で補う**（`.claude/skills/pr-review/SKILL.md` の Svelte 観点で確認）。component 全体（script+template）の cognitive/cyclomatic 複雑度を測る既製 OSS は存在しない（SonarJS は `.svelte` 非サポート）ため深追いせず、自作 `local/max-svelte-lines`(500) を粗い proxy として維持する。

### 7. dependency-cruiser の required gate 昇格 ratify (#3895 で追加)

`dependency-cruiser`（#3871 導入、ADR-0061 Phase 2）は導入 PR 時点で `ci-gate` の `needs:` 未登録＝advisory-only（job は走るが failure が merge を block しない）だった。#3890 の rebase 時に `ci-gate` + `integration-evidence` の `needs:` へ登録され required gate に昇格した。本 ADR で以下を正式決定として ratify する:

- **dependency-cruiser は T2 required gate（merge block）が正**。「gate は block すべき」（ADR-0061 shift-left 機械強制）に整合し、advisory-only は導入 PR の gap であって設計意図ではない
- **既存 PR を誤 block しない**: baseline 12 件（循環 8 + orphan 4）は `.dependency-cruiser-known-violations.json` に pin され、`npm run depcruise`（`--ignore-known` 内蔵）が新規違反のみ fail する（`depcruise:infra` は baseline 0 で全数 gate）
- 今後の gating policy 変更（needs 追加 / 削除）は §4 の運用ルールに従い本 ADR へ同 PR で追記する

## 結果

- 新ツール導入時に「PR 毎に走らせる」がデフォルトではなくなる
- `lint-and-test` の膨張が予算 3min で止まり、Pre-PMF の開発速度が維持される
- T3 / T4 に寄せた debt 検知ツールは実装が軽く（最初から nightly cron で書く）
- EPIC-merge / customer-review tier の追加で、「動くが分かりにくい」UX 層と CUJ 全網羅貫通を per-PR から分離。per-PR は軽量・高速を保ちつつ、顧客に当たる直前で総合検証する 2 層防御が確立 (#2544)

## 関連

- ADR-0005（テスト品質 ratchet）— T1 カバレッジ閾値チェックの実体
- ADR-0010（Pre-PMF スコープ判断）— T3 / T4 finding の Issue 自動起票スコープ判定
- #2544（goal 完遂 + CX 検証基盤）— EPIC-merge tier の実体 (goal-flows helper / expect-expect gate / check-add-path-coherence / Storybook play)
- #2459（Test Strategy EPIC）— 本 tier と Pyramid 戦略の整合 / CX サブ Issue 群の親
