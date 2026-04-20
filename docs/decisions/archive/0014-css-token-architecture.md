# 0014. 3層 CSS トークンアーキテクチャ

> **archived (2026-04-20)**: no longer active-primary, kept for historical reference (#1262 sub-B)


| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-03-15 |
| 起票者 | 日下武紀 |

## コンテキスト

5つの年齢モード × 本番/デモの UI で、色・スペーシング・フォントサイズの一貫性を保つ必要がある。Tailwind のユーティリティクラスだけでは、hex カラーのハードコードが散在する問題が発生。

## 決定

3層トークンアーキテクチャを採用:

1. **Base Tokens** — `--color-brand-500`, `--color-neutral-200` 等。`app.css` の `@theme` ブロック内でのみ定義
2. **Semantic Tokens** — `--color-action-primary`, `--color-surface-card` 等。Base トークンを参照して定義
3. **Component Usage** — routes/features 配下では Semantic トークンのみ使用

### ルール
- routes/features 配下で hex カラー直書き禁止
- `bg-[#667eea]` のような Tailwind arbitrary hex 禁止
- Base トークンは Semantic トークン定義内でのみ使用

## 結果

- UI の一貫性がトークン変更で全画面に反映される
- ESLint (`svelte/no-inline-styles`) + Stylelint (`color-no-hex`) で自動検出
- #651 で既存の683箇所のハードコード色を段階的に移行中
