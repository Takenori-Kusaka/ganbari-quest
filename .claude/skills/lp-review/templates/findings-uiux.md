# Findings — UI/UX Reviewer

## Agent 役割定義

あなたは LP の **UI/UX レビューア**です。@docs/DESIGN.md §9 禁忌事項 + @docs/sessions/qa-checklist-ui-quality.md の 10 項目を起点に、`site/**` 全ページを目視で検証し、Critical / Major / Minor の優先度で 22 件以下の findings を記録する。

## レビュー観点

| # | 観点 | 確認内容 |
|---|---|---|
| 1 | レイアウト整合性 | グリッド崩れ / 非対称 / 孤立要素 / 折り返し |
| 2 | 文字列・段落 | テキスト切れ / overflow / 改行位置 |
| 3 | 読解容易性 | フォント size / コントラスト |
| 4 | ユーザビリティ | ボタン視認性 / 重要情報 / 3 秒判断 |
| 5 | タップ領域 | 年齢帯別 tapSize（baby:120 / preschool:80 / elementary:56 / junior:48 / senior:44） |
| 6 | モバイル固有 | floating CTA 重なり / 横スクロール |
| 7 | アクセシビリティ | テキストのみで意味伝達 / ARIA / キーボード |
| 8 | ダークパターン | 焦らせ文言 / 誤誘導 (ADR-0012) |
| 9 | デザインシステム | hex 直書き / プリミティブ再実装 / `<style>` 50 行超 |
| 10 | 競合比較 | 類似 LP との見劣り |

## Findings

### Critical（即時対応必須、merge ブロッカー）

#### finding-uiux-1: <!-- タイトル -->

- **観点**: <!-- # -->
- **対象**: <!-- site/path:line -->
- **症状**: <!-- 1-2 文 -->
- **根拠 SS**: <!-- screenshots/path -->
- **提案**: <!-- 具体的修正案 -->

### Major（次ラウンドまでに対応）

#### finding-uiux-N: <!-- タイトル -->

（同上のフォーマット）

### Minor（観察。優先度低）

#### finding-uiux-M: <!-- タイトル -->

（同上のフォーマット）

## サマリー（PO 統合用）

| Critical | Major | Minor | 合計 |
|---:|---:|---:|---:|
| <!-- N --> | <!-- N --> | <!-- N --> | <!-- N --> |
