# 0007. 静的解析 tier ポリシー (T1/T2/T3/T4 + EPIC-merge / customer-review tier)

- **Status**: Accepted (2026-05-27 EPIC-merge tier 追加、#2544)
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265 / #2544

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
| **T3 nightly / 週次** | main に schedule | > 3min OR 広域 debt 検知 | **PR は止めない** / finding を Issue 自動起票 | jscpd / cspell / Biome 広域 / madge circular |
| **T4 四半期 / 手動** | cron quarterly or workflow_dispatch | 重い / 外部 API コスト | 発見 → Issue 自動起票 | 脆弱性スキャン / type-coverage ベースライン更新 |

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
