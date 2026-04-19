# src/routes/ — UI 実装ルール

## デザインシステム（3層トークンアーキテクチャ）

### 色
- hex カラー（`#fff`, `#667eea` 等）直書き禁止 → CSS 変数 `var(--color-*)` を使う
- Semantic トークン（`--color-action-primary`, `--color-surface-card` 等）を優先
- Base トークン（`--color-brand-500` 等）は Semantic 定義内でのみ使用
- `@theme` ブロック（`src/lib/ui/styles/app.css`）内でのみ hex 定義を許可
- CI 自動検出: `stylelint color-no-hex`, ESLint `svelte/no-inline-styles`

### コンポーネント
- ボタンは `$lib/ui/primitives/Button.svelte` 必須。`<button class="...">` 直書き禁止
- フォーム要素は `$lib/ui/primitives/FormField.svelte` を使用
- カードは `$lib/ui/primitives/Card.svelte` を使用
- 新しい UI パターンが必要な場合は、先に primitives/components に追加してから routes で使う
- Ark UI を routes から直接 import しない。`$lib/ui/primitives` ラッパ経由

### スタイル
- `<style>` ブロックは原則50行以下。超える場合はコンポーネント分割
- `style="..."` は動的な値（`style:width={pct + '%'}` 等）のみ許容
- Tailwind の arbitrary value で hex を書かない（`bg-[#667eea]` 禁止 → `bg-[var(--color-*)]`）

## 用語管理（用語散在の防止）

UI に表示されるラベル・用語は `src/lib/domain/labels.ts`（用語辞書）を Single Source of Truth とする。

- ナビラベル、ページタイトル、チュートリアル本文で同じ機能を指す場合、必ず用語辞書の定数を使う
- 用語を変更する場合は `grep` で全出現箇所を確認し、用語辞書の値を変更するだけで全画面に反映されることを確認
- デモ版 (`/demo`) と本番で異なるラベルを使ってはならない

## チュートリアル修正ルール

チュートリアル（`tutorial-chapters.ts` + `TutorialOverlay.svelte`）に関わる変更では:

1. **全ステップ通し操作**: フォーカスリング・説明文・ナビ被り・ページ遷移後の DOM 安定を確認
2. **スクリーンショット添付**: 全ステップのスクリーンショットを PR に添付
3. **デスクトップ + モバイル両方確認**: ナビ構造が異なるため両方テスト

## 旧 URL 廃止ルール（#578）

URL をリネーム・廃止したら、**必ず** `src/lib/server/routing/legacy-url-map.ts` の
`LEGACY_URL_MAP` にエントリを追加する。個別ページで `redirect()` を書くのは禁止。

- 散在した redirect は「廃止漏れ」と「無限ループ」の温床になる
- `LEGACY_URL_MAP` 配列に `LegacyUrlEntry` を追加（`from` / `to` / `deletedAt` / `issue` / `reason`）
- `tests/unit/routing/legacy-url-map.test.ts` のテストケースと `tests/e2e/legacy-url-redirect.spec.ts` のスモーク E2E も追加
- `LEGACY_URL_MAP` のエントリは永久に残す（ブックマークが生き続けるため削除禁止）

## demo 配下の `?screenshot=1` モード（#1164 / #1209）

LP スクリーンショット撮影用に、`/demo/**` には `?screenshot=1` で demo 固有 UI
（バナー・プラン切替・ガイドバー・黄色注意書き 等）を一括で非表示にする仕組みがある。

- 値の SSOT は `src/routes/demo/+layout.svelte` の 1 箇所だけ。layout で
  `setScreenshotModeContext(() => isScreenshotMode)` を呼び、
  `$lib/features/demo/screenshot-mode.ts` の context に配置する
- 配下 page / component で参照するときは `getScreenshotMode()` を使う:

  ```svelte
  <script>
  import { getScreenshotMode } from '$lib/features/demo/screenshot-mode.js';
  </script>

  {#if !getScreenshotMode()}
    <div class="demo-only-notice">…</div>
  {/if}
  ```

- **禁止**: page 側で `$page.url.searchParams.get('screenshot')` を再度呼ぶこと / props drilling /
  global `$state` 化。layout の SSOT が唯一の真実の源
- リグレッション検出: `tests/e2e/demo-screenshot-mode.spec.ts`

## UI/デザイン変更の Done 基準

1. **ビジュアル検証**: ブラウザで実際に開き、変更前と比較して意図通りであることを確認
2. **スクリーンショット提示**: 変更後のスクリーンショットをユーザーに提示し承認を取得
3. **LP/アプリ両方確認**: `site/`（LP）と `src/`（アプリ）の両方に影響がある場合、両方を確認
4. **モバイル確認**: DevTools のレスポンシブモードで主要ブレークポイントを確認
5. **ゴールのチェック検証**: `[x]` を付ける前に、そのゴールが文字通り達成されているか自問する

### 絶対にやってはいけないこと
- 実際に画面を確認せずにゴールに `[x]` を付けること（検証偽装）
- チケットの「提案」と異なる方式で実装しながら、ゴールだけ達成したと報告すること
- デモと本番など、複数の対象があるチケットで、一方だけ修正して Done とすること
