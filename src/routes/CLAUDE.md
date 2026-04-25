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

### 年齢帯 variant アンチパターン（ADR-0015）

年齢別言い回し（baby=「がんばったね！」/ senior=「目標達成です」等）の扱いで以下を避ける:

| # | アンチパターン | 代替 |
|---|-------------|------|
| A1 | `if (uiMode === 'baby')` 各コンポーネント散在 | `getLabel(key, ctx)` でラベル層に寄せる |
| A2 | 3 層以上の平坦 key（God-object registry） | 2 層以下に分割 |
| A3 | runtime 動的変換ロジック漏出（漢字→ひらがな置換等） | tier 別 literal を labels.ts に定義 |
| A4 | tier 追加で全ファイル touch 必要 | hierarchical fallback chain（baby → preschool → elementary → `_default`） |
| A5 | routes 直接分岐（`{#if uiMode === 'baby'}` feature 境界跨ぎ） | Presenter 層（`+page.ts` load）に寄せる |
| A6 | SSOT 二重管理（labels.ts と独自辞書の並立） | parallel-implementations.md に登録、統合 Issue 起票 |
| A7 | Feature Flag を segment 代替に使う（LaunchDarkly 等） | ADR-0010 過剰防衛 NG、採用禁止 |

`+layout.server.ts` で `{ ageTier: params.uiMode }` を context 注入し、全ページ・コンポーネントが同一 context で参照する（ラベル層とルート層の一致保証）。

### 日本語テキスト折り返し（ADR-0016）

- 見出し / Dialog タイトル / `.tutorial-title` / `.btn-label` は `app.css` 側で `text-wrap: balance; word-break: auto-phrase;` が効く（0KB, Chromium 119+ / Firefox 125+ / Safari 17.5+）
- 長文段落 / 古いブラウザ対応が必要な箇所のみ `use:budoux` Svelte action を個別適用（~15KB 追加）
- LP 側 (`site/*.html`) は `<budoux-ja>` CDN Web Component で wrap

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

### スクリーンショット自動取得手順（Claude Code / CI 用）

`.svelte` ファイルを変更したら、以下のいずれかで必ずスクリーンショットを取得する。
「手動確認をユーザーに依頼する」は許容しない。Playwright MCP ツールが利用可能な場合は常に使うこと。

#### コンポーネント単体（認証不要）

```bash
npm run storybook   # port 6006 で起動
# → Playwright MCP で http://localhost:6006 を開き対象 Story を撮影
```

#### 子供向けページ（child routes）

```bash
npm run dev         # port 5173 で起動（既に使用中なら 5175 等になる）
npm run capture:child   # baby ホームのフロースクリーンショット

# preschool モードを確認したい場合
node scripts/capture.mjs \
  --flow child-home-preschool \
  --url /switch \
  --actions scripts/capture-specs/flows/child-home-preschool.mjs \
  --presets mobile \
  --out tmp/screenshots/
```

注意: デモ Cookie (`gq_demo=1`) が残っていると isDemo=true になり子供一覧が空になる。
Playwright MCP で使用前に `page.context().clearCookies()` またはブラウザで `/demo/exit` を踏むこと。

#### 管理画面

```bash
npm run dev
npm run capture:admin
```

#### LP

```bash
# site/ を静的サーバーで起動（例: npx http-server site -p 8080）
BASE_URL=http://localhost:8080 npm run capture:lp
```

### 絶対にやってはいけないこと
- 実際に画面を確認せずにゴールに `[x]` を付けること（検証偽装）
- チケットの「提案」と異なる方式で実装しながら、ゴールだけ達成したと報告すること
- デモと本番など、複数の対象があるチケットで、一方だけ修正して Done とすること
