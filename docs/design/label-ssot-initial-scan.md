# labels.ts SSOT 初回スキャンレポート (#1346 Phase 1)

生成日: 2026-04-21
対象: `scripts/check-no-hardcoded-labels.mjs` の初回実行結果

## サマリ

| 項目 | 値 |
|------|---|
| labels.ts から抽出したラベル | 135 件 |
| 対象ファイル (app) | 400 ファイル |
| 対象ファイル (lp) | 10 ファイル |
| 検出されたハードコード (app) | 97 件 |
| 検出されたハードコード (lp) | 14 件 |
| **合計** | **111 件** |

本スキャンは「クオート完全一致 / JSX タグ間完全一致」のみを対象とする厳密マッチで、部分一致 (例: 「チャレンジきろく」に「チャレンジ」が含まれるケース) は除外されている。

## 頻出ラベル TOP 15

| 件数 | ラベル | SSOT 参照先 |
|------|-------|-------------|
| 13 | `スタンダード` | `PLAN_SHORT_LABELS.standard` |
| 12 | `ファミリー` | `PLAN_SHORT_LABELS.family` |
|  9 | `ポイント` | `NAV_ITEM_LABELS.points` |
|  8 | `こども` | `NAV_ITEM_LABELS.children` |
|  7 | `インポートに失敗しました` | `IMPORT_LABELS.errorImportFailed` |
|  7 | `プラン` | `NAV_ITEM_LABELS.license` |
|  6 | `チャレンジ` | `NAV_ITEM_LABELS.challenges` |
|  5 | `JSONの解析に失敗しました` | `IMPORT_LABELS.errorInvalidJson` |
|  4 | `年齢` | `MARKETPLACE_FILTER_LABELS.age` |
|  4 | `活動` | `FEATURE_LABELS.activity` |
|  3 | `アップグレード` | `ACTION_LABELS.upgrade` |
|  3 | `無料プラン` | `PLAN_LABELS.free` |
|  3 | `ごほうび` | `NAV_ITEM_LABELS.rewards` |
|  3 | `おうえんメッセージ` | `FEATURE_LABELS.message` |
|  2 | `イベント` | `NAV_ITEM_LABELS.events` |

## 全件生データ

`docs/design/label-ssot-initial-scan.json` を参照。各エントリは以下の形式:

```json
{
  "file": "src/routes/...",
  "line": 123,
  "literal": "...",
  "sourceObject": "PLAN_LABELS",
  "key": "free",
  "snippet": "return '無料プラン';"
}
```

## Phase 2 着手時のガイド

### 優先順

1. **頻出度 TOP** — `スタンダード` / `ファミリー` / `インポートに失敗しました` など頻出ラベルから着手
2. **LP (`site/`) からの直書き 14 件** — static HTML から `data-label` 経由参照に移行 (ただし ADR-0009 の制限あり。架空の SSOT 機構が必要な部分は別途 Issue で)
3. **エラーメッセージ系** — `fail(500, { error: '...' })` パターンは置換が機械的に可能

### 想定される正当な例外

- 外部 API 応答と一致させたい文字列 (Stripe error text 等)
- 法的文書 (`site/tokushoho.html`)
- テストアサーション (既に対象外)

これらは `// label-allow-literal: <理由>` マーカーで明示的に除外する。

## Phase 3 への移行条件

- Phase 2 で全 111 件を解消 (または `label-allow-literal` マーカー付与)
- `node scripts/check-no-hardcoded-labels.mjs --strict` が exit 0 で完了
- `.github/workflows/ci.yml` の該当ジョブから `continue-on-error: true` を外す

## 関連

- [ADR-0009](../decisions/0009-labels-ssot-principle.md) — labels.ts SSOT 化原則
- [#1346](https://github.com/Takenori-Kusaka/ganbari-quest/issues/1346) — 本 Issue (Phase 1)
- `scripts/check-no-hardcoded-labels.mjs` — 検出スクリプト
- `docs/design/label-ssot-initial-scan.json` — 全件生データ
