# 0032. 静的解析ツール実行頻度ポリシー (T1/T2/T3/T4 階層化)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-16 |
| 起票者 | Session PO |
| 関連 Issue | #989（本 ADR）, #969 / #970 / #971 / #977 / #978 / #979 / #981 / #985 / #986 |
| 関連 ADR | ADR-0017（テスト品質ラチェット）, ADR-0020（テスト品質ラチェット強制）, ADR-0023（Pre-PMF 優先度）, ADR-0029（Safety Assertion Erosion Ban） |

> **ADR 番号について**: 本 Issue #989 の本文では「ADR-0030」として起票されたが、起票時点で既に ADR-0030（Cognito E2E ユーザーライフサイクル基盤）と ADR-0031（スキーマ変更互換性テスト義務化）が採番済みのため、本 ADR は **0032** を割り当てる。

## コンテキスト

### なぜいま必要か

#969–#984 で **静的解析ツール 7 本**（Biome opt-in / knip / jscpd / sonarjs / type-coverage / cspell / Biome 広域拡張）の導入 Issue が並行起票されたが、各 Issue の **実行頻度指定が不統一** である。このまま順次実装すると以下のリスクが顕在化する。

- 全ツールを PR 毎に走らせると `lint-and-test` の既存重量（biome + svelte-check + vitest --coverage + build + storybook）に積み上がり、開発速度を損なう。Pre-PMF 1 人体制では CI 待ちが最大のボトルネック要因。
- 「failing fast にすべきもの」と「debt として定期検知で十分なもの」の判断基準が Issue 毎に発明される。一貫性がない結果、ツール毎に設計議論をやり直す。
- 新ツール導入時のデフォルトが「PR 毎に走らせる」になりがちで、CI 実行時間が単調増加する。

### 既存 Issue の頻度指定（監査結果）

| Issue | 現状指定 | 問題 |
|---|---|---|
| #969 Biome 品質 opt-in | 曖昧 | ルール毎に blast radius が違うのに一律扱い |
| #970 knip | "CI 検出" | 頻度未指定 |
| #971 jscpd | 週次 | OK（本 ADR で明示） |
| #977 sonarjs | "自動検出" | 頻度未指定 |
| #978 type-coverage | "CI ラチェット" | 閾値チェックか再計算かで重さが 10 倍違う |
| #979 cspell | 曖昧 | 頻度未指定 |
| #981 Biome 広域拡張 | 既存 CI 乗せ | scripts/infra/tests 拡張で違反 163 件が PR 毎に走る |

### 根本原因

「ツールを導入すれば品質が上がる」という発想のまま 7 本並べ、**実行頻度 × blast radius の組合せを設計していない**。CI 時間は無尽蔵ではないので、頻度設計こそが品質戦略である。

## 検討した選択肢

### 選択肢 A: 全ツールを PR 毎に実行（従来の素直な実装）
- メリット: `merge された debt` が発生しない。即時是正。
- デメリット: `lint-and-test` が最悪 +10min 化。CI 待ちが開発速度を直撃。Pre-PMF 1 人体制では致命的。誤検知率が高いツールで頻繁に red → override が常態化し、本当に重要な検知が埋もれる。

### 選択肢 B: 全ツールを nightly cron に寄せる
- メリット: PR は従来通り軽い。
- デメリット: 致命的な型違反（noImplicitAny 等）も merge 後検知になり、fix が遅延する。main の修正コストが増える。品質の線引きが失われる。

### 選択肢 C: 階層ポリシー（T1 PR ゲート / T2 並行レーン / T3 nightly / T4 四半期）【採用】
- メリット: ツール毎に blast radius と実行コストを定量的に分類でき、CI 時間を予算内に収められる。新ツール導入時の判断フローが明示され、Claude Code が自律的に判断できる。
- デメリット: 階層の再分類（降格・昇格）運用が必要。運用ルールを ADR に明記して対処。

## 決定

### 1. 4 階層の定義

| 階層 | 実行頻度 | 判定ルール | 失敗時の扱い | 想定ツール |
|---|---|---|---|---|
| **T1 PR ゲート** | 全 push / PR 毎 | 実行時間 < 30s AND merge されたら致命的 | CI 失敗 / merge block | biome check / svelte-check / stylelint / vitest unit / knip（fast 想定） / type-coverage 閾値チェック |
| **T2 PR 並行レーン** | 全 PR、`lint-and-test` と別 job | 実行時間 30s–3min AND 誤検知があっても merge 判断は人間 | CI 失敗 / merge block（override 可） | Playwright E2E（現行）/ sonarjs（要計測） |
| **T3 nightly / 週次** | main に schedule（cron） | 実行時間 > 3min OR 広域 debt 検知 | **PR は止めない**。finding を Issue 自動起票 | jscpd（既に週次 cron）/ cspell / Biome 広域 broad scan / madge circular / sonarjs（重ければここ） |
| **T4 四半期 / 手動** | cron quarterly or `workflow_dispatch` | 重い / 例外的 / 外部 API コスト | 発見 → Issue 自動起票 | 脆弱性スキャン（#985 / #986）/ type-coverage 全計算のベースライン更新 |

### 2. 新ツール導入時の判断フローチャート

```
新ツール導入時:
  Q1. 実行時間は？
    < 30s   → Q2 へ
    30s-3min → Q3 へ
    ≥ 3min  → T3 or T4 確定

  Q2. merge されたら直ちに本番影響か？
    YES → T1
    NO  → T3（debt として検知）

  Q3. 誤検知率が高く人間判断が要るか？
    YES → T2
    NO  → T1
```

### 3. 既存 CI ジョブの階層マッピング（現状 baseline）

| 現行 job | 階層 | 備考 |
|---|---|---|
| `lint-and-test` / Biome check | T1 | < 10s |
| `lint-and-test` / Parallel sync check | T1 | < 5s |
| `lint-and-test` / Stylelint | T1 | < 5s |
| `lint-and-test` / svelte-check | T1 | ~30s |
| `lint-and-test` / vitest --coverage | T1 | ~60s（ラチェット含む） |
| `lint-and-test` / Storybook build | T2 相当 | stories 変更時のみ fan-out |
| `e2e-test` / Playwright | T2 | 並列 job、~2min |
| `site-check` | T1 相当 | site/ 変更時のみ |
| `new-env-distribution-check` | T1 | ADR-0029 |
| `schema-change-tests-check` | T1 | ADR-0031 |
| jscpd 週次（#971） | T3 | cron schedule |
| 脆弱性スキャン（#985 / #986） | T4 | 四半期 / 手動 |

### 4. 実行時間予算

- **T1 合計**: `lint-and-test` job 全体で **≤ 3min**（現状 baseline ~2min）を上限目標。新規 T1 ツール追加は **+30s 以下** を目安とする。
- **T2 合計**: `e2e-test` + 並列 job 全体で **≤ 5min**（現状 ~3-4min）。
- **T3 / T4**: 実行時間制限なし（main 専用、ブロックしない）。

T1 合計が 3min を超えた時は、最も遅いツールを T3 へ降格することを **先に検討**する（新規ツール追加を拒否する前に）。

### 5. 既存 6 Issue の階層指定（別 PR で各 Issue に追記）

| Issue | ツール | 階層 | 備考 |
|---|---|---|---|
| #969 | Biome 品質 opt-in | ルール単位で T1 / T3 | `noBannedTypes` 等の安全系は T1、`noExcessiveCognitiveComplexity` 等の debt 検知系は T3 |
| #970 | knip | T1（初期）/ 実測 > 30s なら T3 降格 | fast 想定 |
| #977 | sonarjs | 軽量サブセット T2 / 完全版 T3 | 要計測 |
| #978 | type-coverage | 閾値チェック T1 / ベースライン再計算 T4（四半期） | 閾値 check は < 30s |
| #979 | cspell | 辞書整備期は T3 / 初回 clean 後に T1 fast | 辞書整備 2-4 週間想定 |
| #981 | Biome 広域拡張 | 163 errors 修正完了後 T1 / 修正中は T3 で debt 可視化 | ラチェット式に導入 |

### 6. 運用ルール

- **T1 への追加は合計 +30s 以下を目安とする**（§4 参照）。超過する場合は T2 / T3 に寄せるか、既存 T1 ツールの降格を同時に提案する。
- **昇格 / 降格は ADR に追記する**。ツールを T3 → T1 に昇格する / T1 → T3 に降格する場合は、本 ADR の §3 マッピング表を更新する（別 ADR 不要、文書同期のみ）。
- **新ツール導入 Issue には「想定階層」欄を必須化**する。`.github/ISSUE_TEMPLATE/` の infra テンプレート側を更新する（本 ADR と同 PR or follow-up）。
- **CI 時間計測**: T1 / T2 job の実行時間を定期モニタする（手動で OK、#923 Phase 2 的な自動化は本 ADR スコープ外）。

## 結果

### 何が変わるか

- 新ツール導入時に「PR 毎に走らせる」がデフォルトではなくなり、judgement が構造化される。
- 既存 6 Issue の AC に階層指定が追加され、実装時の判断が明示される。
- `lint-and-test` の膨張が予算 3min で止まり、Pre-PMF の開発速度が維持される。
- T3 / T4 に寄せた debt 検知ツールは、**実装は軽く**（最初から nightly cron ジョブとして書く）、過度な CI 設計議論を省略できる。

### トレードオフ

- 階層管理のオーバーヘッド：昇格 / 降格のタイミングで本 ADR を更新する必要がある。文書同期は ADR-0003（設計書 SSOT）と同様の運用負荷。
- T3 / T4 finding の放置リスク：nightly で検知しても Issue 起票まで自動化しないと debt が累積する。自動起票は follow-up Issue で検討する（本 ADR スコープ外）。

## 参考

- 既存 CI: `.github/workflows/ci.yml`（#923 Phase 1 で並列化済）
- 関連 Issue: #969–#984（静的解析ツール群）, #985 / #986（脆弱性スキャン）
- 関連 ADR: ADR-0017 / ADR-0020（品質ラチェット）, ADR-0023（Pre-PMF 優先度）, ADR-0029（Safety Assertion Erosion Ban）, ADR-0031（スキーマ変更互換性テスト）
