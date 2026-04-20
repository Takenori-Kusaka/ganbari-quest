# 0007. 静的解析 tier ポリシー (T1/T2/T3/T4 階層化)

- **Status**: Accepted
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265
- **統合元**: 旧 ADR-0032（本 PR で削除、詳細は git 履歴）

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

## 結果

- 新ツール導入時に「PR 毎に走らせる」がデフォルトではなくなる
- `lint-and-test` の膨張が予算 3min で止まり、Pre-PMF の開発速度が維持される
- T3 / T4 に寄せた debt 検知ツールは実装が軽く（最初から nightly cron で書く）

## 関連

- ADR-0005（テスト品質 ratchet）— T1 カバレッジ閾値チェックの実体
- ADR-0010（Pre-PMF スコープ判断）— T3 / T4 finding の Issue 自動起票スコープ判定
