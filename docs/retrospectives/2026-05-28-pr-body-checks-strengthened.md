# 2026-05-28 Retrospective — PR body 検証強化 (BOM heuristic + AC 4 列 SSOT)

> Issue #2576 / #2586 / combined PR (QA team self-implement) の振り返り。
> 本日観察された re-review 浪費 9 件 (BOM 4 + AC 4 列違反 5) の構造的予防策を deploy した。

## 観察された問題 (2026-05-28 1 日内に集中発生)

### BOM mojibake 4 連続再発

| PR | 症状 | 対応 |
|---|---|---|
| #2562 | PR body 冒頭 BOM (`﻿`) 残留、cp932 mojibake | initial 検出 (#2576 で `detectMojibake` 追加された原典) |
| #2563 | 同型 BOM 再発 | Dev Agent 改善後も heredoc 経由で再現 |
| #2566 | 同型 BOM 再発 | `--body-file` ルール周知後も発生 |
| #2583 | BOM + AC マップ違反 同時発生 | QM Re-Review で 2 件 BLOCK |

### AC マップ 4 列違反 5 連続再発

| PR | 症状 | 対応 |
|---|---|---|
| #2583 | 2 列簡略形式で起票 | QM Re-Review BLOCK |
| #2585 | 列数 3 (検証手段欠落) | QM Re-Review BLOCK |
| #2588 | 4 列形式で再起票 → MERGED (本 PR の SSOT 実装例) | OK |
| #2596 | 再発、3 列 | QM Re-Review BLOCK |
| #2593 | 列数不一致 | QM Re-Review BLOCK |

**合計**: 9 件 / 1 日。QM Re-Review 工数 / Dev rebase 工数の合計で 2-3 round/日 浪費。

## 根本原因分析

| 層 | 問題 | 構造的原因 |
|---|---|---|
| **template** | `.github/PULL_REQUEST_TEMPLATE.md` の AC マップ example 行が 1 行のみ + 4 列強制コメントが薄い | 開発者が「結果セルだけ書けばいい」と誤解し列を削除する自由度がある |
| **error message** | `scripts/check-pr-body.mjs` の `ac-map-incomplete` error message が「未記入セルが N 行あります」のみ | 何が期待形式か、どう直すかが提示されないため 5 連続で同じ違反パターン |
| **skill / runbook** | `.claude/skills/dev-open-pr/SKILL.md` に 4 列強制ルールが明示されていない | Dev Agent が PR body 作成時の予防ルールを参照できない |
| **heuristic threshold** | `??` mojibake 検出閾値が 10 件で too lenient | cp932 mojibake は典型的に 5-10 件で発生するため、4 連続で「9 件以下」をすり抜け |

## 本 PR (combined #2576 + #2586) で deploy した構造的対処

### 1. `.github/PULL_REQUEST_TEMPLATE.md` 強化

- AC マップ section の 4 列強制を ⚠️ コメントで明示
- example 行を 2 行に増やし、結果セルに `HEAD SHA + file:line + 実体根拠` の組合せを示す
- 参考 PR (#2588 / #2599) を comment で参照付記

### 2. `scripts/check-pr-body.mjs` 強化

#### `??` heuristic threshold 10 → 5

旧閾値 10 では 4 連続で「9 件以下」がすり抜けた。新閾値 5 で fail-fast を強化。

#### AC マップ error message に修正手順を追加

```
期待形式 (4 列固定): | AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
参考 PR (4 列 SSOT 実装例): #2588 / #2599
修正手順: PR body の AC マップを上記 4 列 header に置換、各セルに HEAD SHA + file:line + grep + 実体根拠を付与する
```

### 3. `.claude/skills/dev-open-pr/SKILL.md` 強化

- 「AC 検証マップは必ず 4 列形式」セクション新規追加
- 各セルの埋め方を具体例で提示 (`HEAD <SHA> + file:line + 実体根拠`)
- 参考 PR (#2588 / #2599) を内蔵
- BOM mojibake セクションに 4 ラウンド再発の事実を反映

### 4. unit test 拡張

- BOM detection error message が「heredoc 禁止」「UTF-8 file 投入」を含むことを assert
- `??` 5 件で fail (旧 9 件許容 → 新 5 件 fail) の境界値テスト
- AC マップ 2 列で error message が「4 列形式期待 + 参考 PR」を含むことを assert
- AC マップ 4 列で PASS (dogfood)

## 期待される効果 (Pre-PMF Bucket A, ROI 高)

| 指標 | Before (2026-05-28 観測) | After (期待値、6 ヶ月後 review trigger) |
|---|---|---|
| BOM mojibake 再発率 | 4 件 / 1 日 | < 1 件 / 月 (threshold 5 で fail-fast) |
| AC 4 列違反 再発率 | 5 件 / 1 日 | < 1 件 / 月 (error message + skill + template の 3 層 defense) |
| QM Re-Review round/日 | 2-3 round 浪費 | 0-1 round 期待 |

## 6 ヶ月後 effectiveness review trigger

2026-11 月時点で:
- PR body BOM 再発率 (`gh pr list --state merged --since 2026-08-28` で `??` 残留 / BOM grep)
- AC 4 列違反による QM BLOCK 数 (`gh pr list --label "qa:blocked"` count)
- 上記 2 指標が「Before」値の 80% 以下に減少していなければ追加対策 Issue 起票

## 関連 Issue / PR / ADR

- closes #2576 (BOM heuristic 強化)
- closes #2586 (AC 4 列 template SSOT)
- refs #2562 / #2563 / #2566 / #2583 (BOM 4 連続再発)
- refs #2583 / #2585 / #2588 / #2596 / #2593 (AC 4 列違反 5 連続再発)
- refs #2599 (本日 MERGED ADR-0056 — QA self-implement pattern 第 1 弾)
- refs ADR-0010 §3 (Pre-PMF Bucket A: ROI 高、構造的予防)
- refs ADR-0004 (AC 検証マップ義務)
- refs #1775 (PR body 検証 CLI 導入の原典)
