# 0016. 日本語テキスト折り返し方針（CSS 第一 + BudouX フォールバック）

- **Status**: Proposed
- **Date**: 2026-04-21
- **Related Issue**: #1353（B8 吸収）/ #584（CLOSED、BudouX 導入検討起源）

## コンテキスト

日本語は空白区切りがないため、見出し・ボタン・カードタイトルが不自然な位置で折り返される（「がんばり｜クエスト」「おみ｜くじ」等）。対象ターゲット（3-15 歳の子供 × 保護者）は読み困難でプロダクト品質として劣化する。

現状:
- `app.css` に折り返し制御なし
- 見出し・Dialog タイトル・チュートリアルステップ・tip カードで目視違和感あり
- #584 で BudouX 導入が検討されたが CLOSED（結論持ち越し）

一方、2024-2025 にかけて CSS 標準側で進展: `text-wrap: balance`（行頭揃え）+ `word-break: auto-phrase`（日本語文節境界認識）が Chromium 119+ / Firefox 125+ / Safari 17.5+ で利用可能に。

## 検討した選択肢（OSS 最低 2 件比較 — #1350）

### 選択肢 A: CSS 標準（text-wrap: balance + word-break: auto-phrase）

- 概要: W3C 標準 CSS プロパティのみ。JS ゼロ、bundle 増分ゼロ
- メリット: (1) **0KB**（ブラウザ native）、(2) W3C 標準で将来廃止リスク極小、(3) SSR/hydration 問題ゼロ、(4) 保守コスト ゼロ
- デメリット: (1) Safari 17.5 未満 / Firefox 125 未満 / 古い Chromium で効かない、(2) 長文段落では精度が BudouX に劣る
- Pre-PMF コスト（ADR-0010）: 導入工数 **最低**（`app.css` 追記のみ）、学習コスト ゼロ、bundle size **ゼロ**、長期保守性 最高

### 選択肢 B: BudouX（Google OSS, Apache-2.0）

- 概要: Google 製の ML ベース日本語文節境界認識ライブラリ。v0.8.1（2026-03）活発。`loadDefaultJapaneseParser()` + `applyElement()` で ZWSP 挿入
- メリット: (1) 全ブラウザ対応、(2) ML 文節精度が CSS auto-phrase より高い、(3) CDN Web Component 提供 → LP 側でも使用可、(4) ZWSP 挿入が決定論的 → SSR 事前適用可能
- デメリット: (1) bundle **15-20KB**、(2) JS 実行前は folding されない（FOUC 類似）、(3) SSR hydration で二重適用回避判定が必要
- Pre-PMF コスト: 導入工数 低（Svelte action 実装のみ）、学習コスト 低、bundle size **中**（必要箇所のみ）、長期保守性 高

### 選択肢 C: tiny-segmenter / kuromoji.js（代替 OSS、不採用）

- tiny-segmenter: 助詞単位で切れすぎ子供向け UI で逆効果 → **不採用**
- kuromoji.js: 辞書 17MB、Pre-PMF で論外 → **不採用**
- mecab（WASM）: native binding / WASM 複雑性、採用コスト高 → **不採用**

## 決定

**ハイブリッド構成: A を第一選択、B をフォールバックとして併用**。理由:

1. 対象ブラウザ（Chromium 119+ / Firefox 125+ / Safari 17.5+ 2024-以降）で CSS が動くケースは **0KB で十分な品質**が出る（Pre-PMF コスト最小）
2. 古いブラウザ・段落が長い箇所（チュートリアル本文等）で BudouX を追加適用（`Svelte action`）
3. LP 側は CDN Web Component で追加実装不要（`site/**` の bundle 肥大回避）

### 段階導入

**Phase 1（即時、0KB）**: `src/lib/ui/styles/app.css`

```css
h1, h2, h3, .heading, .tutorial-title, .btn-label {
  text-wrap: balance;
  word-break: auto-phrase;
}
```

**Phase 2（必要箇所のみ、~15KB）**: Svelte action

```ts
// src/lib/ui/actions/budoux.ts
import { loadDefaultJapaneseParser } from 'budoux';
const parser = loadDefaultJapaneseParser();
export function budoux(node: HTMLElement) {
  if (!node.dataset.budouxApplied) {
    parser.applyElement(node);
    node.dataset.budouxApplied = 'true';
  }
  return { destroy() {} };
}
```
対象: 見出し / Dialog タイトル / チュートリアルステップ / tip カード。本文段落は CSS-only で十分。

**Phase 3（LP, `site/*.html`）**: CDN Web Component
```html
<script async src="https://unpkg.com/budoux/bundle/budoux-ja.min.js"></script>
<budoux-ja><h1>がんばりクエスト</h1></budoux-ja>
```

### SSR hydration 戦略

- BudouX の ZWSP 挿入は **決定論的**（同一入力 → 同一出力）
- サーバー側 `translateHTMLString()` で事前適用、クライアント action 側は `data-budoux-applied` フラグで二重適用回避
- `+layout.server.ts` で処理するのが最安全（PoC で検証、follow-up Issue）

## 結果

- 子供向け UI の読みやすさが向上（特に見出し・ボタンラベル）
- 本文段落は CSS-only で bundle 増分ゼロを維持
- LP 側は CDN で導入、`shared-labels.js` 自前経路に依存しない
- ADR-0015（年齢帯 variant）とは独立関心事として並走可能

### トレードオフ

- BudouX Phase 2 導入時に 15-20KB の bundle 増分（tutorial 等必要箇所のみ）
- `auto-phrase` は 2024-以降ブラウザ前提、古いブラウザで精度劣化（許容）
- 決定論的とはいえ SSR 二重適用バグリスク → PoC + テストで担保

## 関連

- ADR-0010（Pre-PMF scope）— CSS-only を第一選択にする根拠
- ADR-0015（年齢帯 variant）— 本 ADR とは独立関心事として並走
- #584（BudouX 導入検討、CLOSED）— 本 ADR で結論
- #1353（本 Issue B8 吸収）
- [CSS text-wrap: balance - Chrome Developers](https://developer.chrome.com/docs/css-ui/css-text-wrap-balance)
- [google/budoux](https://github.com/google/budoux)

## LP 側適用検証（#1729 R14, 2026-04-30 P5B2 bundle）

`site/index.html` への適用結果:

- **CSS 第一選択**: `site/shared.css` の `body` に `text-wrap: pretty; word-break: auto-phrase` を、`h1, h2, h3, h4` に `text-wrap: balance; word-break: auto-phrase` を適用
- **Phase 3 BudouX CDN**: `site/index.html` `<head>` に `https://cdn.jsdelivr.net/npm/budoux@latest/bundle/budoux-ja.min.js` を defer 読み込み（追加 bundle ~15KB gzipped）
- **動的更新の特例**: hero carousel-label は `splide.on('mounted move')` で動的に label.innerHTML を書き換えるため、textContent escape したうえで `<budoux-ja>...</budoux-ja>` でラップしてから注入する。CDN 未ロード時は plain custom element として描画されるため fallback safe（Web Component 未登録扱い）
- **静的長文への適用は不要**: `section-desc` / `pp-disclaimer` / `trust-disclaimer-text` / `cta-bottom-disclaimer` 等の長文は `text-wrap: pretty + word-break: auto-phrase` で十分な品質が出ることを実機検証で確認したため、`<budoux-ja>` ラップを行わない
- **メトリクス**: BudouX CDN 追加後も mobileHeight=14741 / desktopHeight=7868（`THRESHOLDS.mobileHeight=15000` / `desktopHeight=8000` 内）

副次効果として #1737 (R18) で `THRESHOLDS.mobileHeight` を 15200 → 15000 に restore できた（ADR-0006 整合）。
