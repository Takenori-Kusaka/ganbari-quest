---
name: Regression Check
description: Use when evaluating the blast radius of a code change. Identifies affected features, parallel implementations, and test coverage gaps.
---

# リグレッション影響分析

## 分析手順

### 1. 変更ファイルの特定

```bash
git diff --name-only main...HEAD
```

### 2. 影響範囲マッピング

| 変更カテゴリ | チェック対象 |
|------------|-----------|
| `src/lib/domain/` | 全画面に影響。labels.ts / validation/ / constants/ |
| `src/lib/server/services/` | API エンドポイント + テスト |
| `src/lib/server/db/` | リポジトリ層 + サービス層 + テスト |
| `src/lib/ui/primitives/` | 使用している全コンポーネント |
| `src/routes/(child)/` | 5年齢モード全てに影響 |
| `src/routes/(parent)/admin/` | 管理画面全体 |
| `src/routes/demo/` | デモモード |
| `site/` | LP・パンフレット |

### 3. 並行実装チェック（docs/design/parallel-implementations.md）

- [ ] UI ラベル変更 → labels.ts + site/ + tutorial
- [ ] 本番画面変更 → デモ画面
- [ ] ナビ変更 → Desktop + Mobile + BottomNav
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
