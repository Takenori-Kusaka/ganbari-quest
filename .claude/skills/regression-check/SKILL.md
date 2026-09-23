---
name: Regression Check
description: Use when evaluating the blast radius of a code change. Identifies affected features, parallel implementations, and test coverage gaps.
---

# リグレッション影響分析

## 分析手順

### 1. 変更ファイルの特定

```bash
git diff --name-only develop...HEAD   # feature / fix の base は develop（hotfix のみ main）
```

### 2. 影響範囲マッピング

| 変更カテゴリ | チェック対象 |
|------------|-----------|
| `src/lib/domain/` | validation/ / constants/ は全画面に影響。labels 層は変わったファイルで決まる: 下層の共有ファイル (`common` / `format` / `nav` / `age-tier` / `plan` / `theme` / `admin-shared`) は全画面、画面・機能のファイル (`admin-<x>` / `child-<x>` 等) はその画面、`lp.ts` は site/ |
| `src/lib/server/services/` | API エンドポイント + テスト |
| `src/lib/server/db/` | リポジトリ層 + サービス層 + テスト |
| `src/lib/ui/primitives/` | 使用している全コンポーネント |
| `src/routes/(child)/` | 5年齢モード全てに影響 |
| `src/routes/(parent)/admin/` | 管理画面全体 |
| `src/lib/server/demo/` | デモデータ（デモ専用ルートは無い。本番ルートを `AUTH_MODE=anonymous` + `DATA_SOURCE=demo` で起動、ADR-0048） |
| `site/` | LP・パンフレット |

### 3. 並行実装チェック（docs/design/parallel-implementations.md）

- [ ] UI ラベル変更 → labels 層の該当ファイル + site/ (`lp.ts` のとき) + tutorial (`tutorial.ts` / `page-guide.ts` のとき)
- [ ] 本番画面変更 → デモでも同じ本番ルートが動く（`DATA_SOURCE=demo` のデモデータで表示が破綻しないか）
- [ ] ナビ変更 → 面を固定数で数えず `grep -rn "<nav\b" src/` で洗い出す（`AdminLayout` に Desktop / Mobile 同居、ほか `BottomNav` / 設定サブナビ / 運営者ナビ / ページ内タブ）
- [ ] DB 変更 → テストデータ + デモデータ

### 4. テストカバレッジ確認

```bash
npx vitest run --coverage
npx playwright test
```

## 出力フォーマット

```markdown
### リグレッション影響分析

**変更ファイル数**: X 件
**影響範囲**: [広い/限定的]

| 影響を受ける機能 | テストカバレッジ | リスク |
|----------------|----------------|--------|
| [機能名] | [あり/なし] | [高/中/低] |

**推奨テスト**: [実行すべきテストスイート]
```
