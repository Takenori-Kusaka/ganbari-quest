## 統合サマリ

- 対象 develop HEAD: `e593aebc2`
- 統合対象期間: `2026-07-30` 〜 `2026-07-31` (前回統合 merge 〜 今回)
- 統合 PR 番号: `#4126`

Closes #4129

## 含有 PR 一覧

| PR | title | type label | 対象領域 |
|---|---|---|---|
| #4144 | 破壊的ローテーションを止め、連続失敗を数える | `type:fix` | `scripts/backup` |
| #4125 | PR body gate を CI に配線する | `type:fix` | `.github/workflows` |

## マージ判定エビデンス表

| 変更（出典 PR） | 対象領域 | 対応テストケース | 結果 | カバレッジ影響 | 残 NG |
|---|---|---|---|---|---|
| backup ローテーション（#4144） | scripts/backup | unit×6 | pass | 閾値内 | 0 |
| PR body gate 配線（#4125） | .github/workflows | unit×3 | pass | 閾値内 | 0 |

残 NG 合計 0 件。

## 監査 run 結果リンク

- audit run evidence: `https://github.com/Takenori-Kusaka/ganbari-quest/actions/runs/1` (run id: `4126-20260731`)
- adversarial evidence: `tmp/adversarial-evidence/4126.json`

## NG 0 件 / カバレッジ宣言

- 残 NG 合計 0 件 (severity 3-4 + policy_compliant=false の未解決 finding なし)
- [x] 8 領域 finding のうち severity 閾値以上の未解決 NG が **0 件**である
- [x] カバレッジ ratchet 閾値割れがない (ADR-0005 整合)
- [x] 最重厚レーン (branch-strategy.md §4) の全 job が緑である
- [x] adversarial evidence の反対理由が全件解消済みである

## Accepted residual (Pre-PMF)

| finding (要約) | severity (1-2 のみ) | 受容理由 (Pre-PMF) | 関連 root class |
|---|---|---|---|
| reset deleted-count の命名精度 | 2 | dev-only 診断値、ユーザー価値影響なし | reset 完全性 |

## back-merge / drift 状態

- 直近 hotfix back-merge: 該当なし
- develop⇔main drift: `1` 日 (前回統合 merge からの経過)
