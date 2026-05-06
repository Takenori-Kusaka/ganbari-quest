# Issue List — N（finding 番号）→ #（Issue 番号）対応表

## 起票結果

`integrated-findings.md` の Issue 起票計画 → 実起票結果のトレース。

| 計画 ID | 起票 Issue # | finding 元 | kind | priority | 状態 |
|---|---|---|---|---|---|
| <!-- I-1 --> | <!-- #XXXX --> | <!-- finding-uiux-1, finding-pm-3 --> | <!-- lp-content --> | <!-- medium --> | <!-- open / merged --> |
| <!-- I-2 --> | | | | | |

## verify 結果

各 Issue が以下を満たすか機械検証:

| Issue # | no-touch-zones AC 含有 | SSOT 1 行リンク含有 | 画像物理パス二重貼り無し |
|---|:---:|:---:|:---:|
| <!-- #XXXX --> | ✅ / ❌ | ✅ / ❌ | ✅ / ❌ |

## verify コマンド

```bash
for issue in $(grep -oE "#[0-9]+" issue-list.md | sort -u); do
  body=$(gh issue view ${issue#\#} --json body -q .body)
  echo "=== $issue ==="
  echo "$body" | grep -q "po-direct-findings.md#" && echo "  SSOT リンク: ✅" || echo "  SSOT リンク: ❌"
  echo "$body" | grep -q "tmp/reviews/.*screenshots/" && echo "  画像二重貼り: ❌（違反）" || echo "  画像二重貼り: ✅"
  echo "$body" | grep -q "no-touch-zones" && echo "  no-touch-zones AC: ✅" || echo "  no-touch-zones AC: ❌"
done
```

## ラウンド総括

- 起票 Issue 数: <!-- N -->
- verify 全 PASS: <!-- N / N -->
- 観察期間後再評価予定: <!-- ラウンド YYYY-MM-DD -->
