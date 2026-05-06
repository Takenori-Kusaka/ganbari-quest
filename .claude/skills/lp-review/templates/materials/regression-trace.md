# Regression Trace（前ラウンド改悪パターン map）

前ラウンドで close した PR が、当ラウンドで PO 期待と乖離している箇所を 1 行/件で記録する。

## 抽出手順

```bash
# 前ラウンドで merged した area:lp PR を抽出
gh pr list --state merged --search "label:area:lp merged:>YYYY-MM-DD" \
  --json number,title,mergedAt --jq '.[] | "#\(.number) \(.title) (merged \(.mergedAt))"'
```

## Regression パターン一覧

| 前ラウンド PR | 改悪箇所 | 期待 vs 実態 | 当ラウンド対応 Issue |
|---|---|---|---|
| <!-- #1820 (R-CRT-2 装飾枠 5→1) --> | <!-- core-loop section の装飾アイコン --> | <!-- 期待: 装飾統一 / 実態: 別の不統一発生 --> | <!-- #1849 等 --> |
| <!-- #1832 (フッタ追加) --> | <!-- desktopHeight 累積膨張 --> | <!-- 期待: 8000 px 以下維持 / 実態: 累積で 8058 --> | <!-- #1840 (累積監視機構) --> |

## 構造的原因の分類

| 原因カテゴリ | 該当 PR | 構造的解決策 |
|---|---|---|
| <!-- 中途半端統一 --> | <!-- #1820 / #1846 / #1847 --> | <!-- ADR-0032 base class 不在の特定 --> |
| <!-- 累積膨張 --> | <!-- #1832 / #1834 / #1835 --> | <!-- ADR-0042 + #1840 累積監視 --> |
