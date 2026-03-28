# アクセシビリティ監査レポート

## 監査日: 2026-03-28
## ツール: コードレベル静的解析
## 対象: WCAG 2.1 AA 基準

---

## 監査サマリー

| 基準 | 状態 | 指摘件数 | 重要度 |
|------|------|---------|--------|
| HTML lang属性 | ✅ 合格 | 0 | - |
| 画像alt属性 | ✅ 合格 | 0 | - |
| アイコンボタンaria-label | ✅ 修正済 | 2→0 | High |
| aria-live通知 | ✅ 良好 | 0 | - |
| prefers-reduced-motion | ✅ 修正済 | 全アニメーション対応 | Critical |
| role="status/alert" | ✅ 良好 | 0 | - |
| セマンティックランドマーク | ✅ 良好 | 0 | - |
| フォーカスインジケーター | ✅ 修正済 | :focus-visible追加 | High |
| フォームラベル紐付け | ✅ 良好 | 0 | - |
| フォントサイズ | ⚠️ 残存 | 9件（装飾系） | Medium |

---

## 修正済み項目

### [CRITICAL] prefers-reduced-motion 対応

**修正箇所**: `src/lib/ui/styles/app.css`

全アニメーション（bounce-in, point-pop, spin-in, shimmer, flame-appear, skeleton-shimmer）に対して
`@media (prefers-reduced-motion: reduce)` でアニメーションを無効化。

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### [HIGH] フォーカスインジケーター

**修正箇所**: `src/lib/ui/styles/app.css`

全インタラクティブ要素に `:focus-visible` スタイルを追加。

```css
:focus-visible {
  outline: 3px solid var(--theme-primary, #3878b8);
  outline-offset: 2px;
  border-radius: 4px;
}
```

### [HIGH] icon-only ボタンの aria-label

| ファイル | 修正内容 |
|---------|---------|
| `admin/checklists/+page.svelte` | ✕ボタンに `aria-label="削除"` 追加 |
| `admin/points/+page.svelte` | ✕ボタンに `aria-label="プレビューを閉じる"` 追加 |

---

## 残存項目（Medium / Low）

### [Medium] フォントサイズ 14px 未満

以下のファイルで `text-[10px]` 等の小さいフォントサイズが使用されている。
ただしいずれも装飾的バッジ・副次的メタデータで、主要な情報表示ではない。

- `CompoundIcon.svelte`: サブアイコンバッジ (8px)
- `ActivityCard.svelte`: 記録回数バッジ (10px)
- `achievements/+page.svelte`: そうび中ステータス (10px)
- `shop/+page.svelte`: 価格・装備状態 (10px)

**対応方針**: 次回 UI 改善チケットで rem 単位への変換を検討

### [Low] コントラスト比の確認

以下の色組み合わせについてブラウザツール（Lighthouse, axe）での測定が必要:

- アクセントカラー (#FFCC00) 上のテキスト
- プライマリブルー (#3878B8) 上の白テキスト
- disabled 状態のテキスト

---

## 既に合格している項目

- `<html lang="ja">`: `src/app.html` に設定済み
- 画像 alt 属性: Logo, アバター画像等すべて設定済み
- aria-live/role="alert": Toast, ErrorAlert, SuccessAlert, ProgressMessage で実装済み
- セマンティックランドマーク: `<main>`, `<nav aria-label>`, `<header>` 適切に使用
- フォームラベル: ログイン・サインアップフォームで `<label for>` + `<input id>` 設定済み
- BottomNav: `<nav aria-label="メインナビゲーション">` 設定済み
