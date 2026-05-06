# src/routes/ — UI 実装ルール

**SSOT**: デザイン → @docs/DESIGN.md / 用語 → `src/lib/domain/labels.ts` / 並行実装 → @docs/design/parallel-implementations.md

## デザインシステム

詳細は @docs/DESIGN.md §2-5 / §9 禁忌事項。要点のみ:

- **色**: 3 層トークン (Base → Semantic → Component)。routes は Semantic (`--color-action-primary` 等) のみ参照。hex 直書き禁止 (CI: `stylelint color-no-hex`)
- **コンポーネント**: ボタン → `Button.svelte` / フォーム → `FormField.svelte` / カード → `Card.svelte`。直書き禁止。新パターンは primitives に追加してから使用
- **インラインスタイル**: 動的値のみ許容 (`style:width={pct + '%'}`)。Tailwind arbitrary hex 禁止
- **`<style>` ブロック**: 50 行以下推奨。超過時はコンポーネント分割

## 用語管理

UI ラベル・用語は `src/lib/domain/labels.ts` が SSOT。デモと本番で同じラベル使用必須。変更時は `grep` で全件確認。

### 年齢帯 variant（ADR-0015）

7 アンチパターン (A1-A7) は ADR-0015 参照。基本: `if (uiMode === 'baby')` 散在 / runtime 動的変換 / Feature Flag 代替 等を避け、`getLabel(key, ctx)` 経由で labels.ts に集約。`+layout.server.ts` で `{ ageTier: params.uiMode }` を context 注入。

### 日本語テキスト折り返し（ADR-0016）

見出し / Dialog / `.tutorial-title` / `.btn-label` は `app.css` の `text-wrap: balance; word-break: auto-phrase;` で対応 (0KB)。長文段落 / 旧ブラウザ対応は `use:budoux` 個別適用 (~15KB)。LP 側は `<budoux-ja>` Web Component。

## チュートリアル修正

`tutorial-chapters.ts` + `TutorialOverlay.svelte` 変更時:
1. 全ステップ通し操作（フォーカスリング・説明文・ナビ被り・遷移後 DOM 安定確認）
2. デスクトップ + モバイル両方の SS 添付（ナビ構造が異なる）

## 旧 URL 廃止ルール（#578）

URL リネーム・廃止時は **必ず** `src/lib/server/routing/legacy-url-map.ts` の `LEGACY_URL_MAP` にエントリ追加。個別 `redirect()` 直書き禁止（無限ループ温床）。`tests/unit/routing/legacy-url-map.test.ts` + `tests/e2e/legacy-url-redirect.spec.ts` も追加。エントリは永久保持（ブックマーク維持のため削除禁止）。

## demo 配下の `?screenshot=1` モード（#1164 / #1209）

LP SS 撮影用に `/demo/**` で demo 固有 UI を一括非表示。SSOT は `src/routes/demo/+layout.svelte` の 1 箇所のみ。`setScreenshotModeContext()` で context 配置、配下は `getScreenshotMode()` で参照。

```svelte
<script>
import { getScreenshotMode } from '$lib/features/demo/screenshot-mode.js';
</script>
{#if !getScreenshotMode()}<div class="demo-only-notice">…</div>{/if}
```

**禁止**: page 側で `$page.url.searchParams.get('screenshot')` 再呼出 / props drilling / global `$state` 化。リグレッション検出: `tests/e2e/demo-screenshot-mode.spec.ts`

## UI/デザイン Done 基準

1. ブラウザで実機ビジュアル確認（変更前後比較）
2. SS をユーザー提示し承認取得
3. LP / アプリ両方影響時は両方確認
4. DevTools レスポンシブモードで主要ブレークポイント確認
5. ゴールのチェック検証（`[x]` 前に文字通り達成されているか自問）

### SS 取得手順

`.svelte` 変更時は必ず SS 取得。「手動確認依頼」は許容しない。`scripts/capture.mjs` を使用 (`--help` 参照)。代表例:

- 子供 routes: `npm run capture:child` / 管理画面: `npm run capture:admin` / LP: `npm run capture:lp`
- preschool モード: `node scripts/capture.mjs --flow child-home-preschool --url /switch --presets mobile`
- デモ Cookie (`gq_demo=1`) 残存で `isDemo=true` になり子供一覧が空になる → `/demo/exit` または `clearCookies()`

## 絶対にやってはいけないこと

- 実画面未確認でゴールに `[x]`（検証偽装）
- チケット「提案」と異なる方式で実装しながらゴール達成と報告
- デモ + 本番など複数対象チケットで一方のみ修正して Done
