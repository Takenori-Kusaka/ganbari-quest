---
name: Flake Hunt
description: Use when investigating flaky E2E tests. Systematic approach to identify race conditions, timing issues, and environment dependencies.
---

# E2E フレークテスト調査

## 調査手順

### 1. 再現確認

```bash
# 3回連続実行して再現率を確認
for i in 1 2 3; do npx playwright test <spec-file> --reporter=list; done
```

### 2. 一般的なフレーク原因

| 原因 | 症状 | 修正方法 |
|------|------|---------|
| タイミング競合 | 要素が見つからない | `waitFor` + 適切なセレクタ |
| ネットワーク遅延 | API レスポンス前に操作 | `waitForResponse` |
| アニメーション | クリックが効かない | `animations: 'disabled'` |
| テストデータ依存 | 順序で結果が変わる | テストごとにデータ初期化 |
| ポートコンフリクト | サーバー起動失敗 | `reuseExistingServer` 確認 |
| ダイアログ状態漏れ | 前のテストのダイアログが残る | アプリ側のバグを修正（clearDialogGhosts 新規使用禁止） |

### 3. デバッグツール

```bash
# トレース付きで実行
npx playwright test <spec-file> --trace on

# UI モードで実行
npx playwright test <spec-file> --ui

# 特定のブラウザのみ
npx playwright test <spec-file> --project=chromium
```

### 4. 修正方針

- waitFor の延長は最終手段（アサーション弱体化禁止 — ADR-0005）
- `.skip` の追加は禁止（ADR-0006）
- 根本原因を特定してアプリ側またはテスト側を修正
- 修正後は 5 回連続成功を確認
