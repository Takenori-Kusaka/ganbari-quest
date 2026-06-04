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

### 年齢帯 variant

基本原則: `if (uiMode === 'baby')` 散在 / runtime 動的変換 / Feature Flag 代替 等を避け、`getLabel(key, ctx)` 経由で labels.ts に集約。`+layout.server.ts` で `{ ageTier: params.uiMode }` を context 注入。7 アンチパターン (A1-A7) の網羅と検出方法の詳細は git 履歴 (旧 `docs/decisions/0015-age-tier-variant-architecture.md`、#2898 で削除) 参照。

### 日本語テキスト折り返し（ADR-0016）

見出し / Dialog / `.tutorial-title` / `.btn-label` は `app.css` の `text-wrap: balance; word-break: auto-phrase;` で対応 (0KB)。長文段落 / 旧ブラウザ対応は `use:budoux` 個別適用 (~15KB)。LP 側は `<budoux-ja>` Web Component。

## チュートリアル修正

`tutorial-chapters.ts` + `TutorialOverlay.svelte` 変更時:
1. 全ステップ通し操作（フォーカスリング・説明文・ナビ被り・遷移後 DOM 安定確認）
2. デスクトップ + モバイル両方の SS 添付（ナビ構造が異なる）

## 旧 URL 廃止ルール（#578）

URL リネーム・廃止時は **必ず** `src/lib/server/routing/legacy-url-map.ts` の `LEGACY_URL_MAP` にエントリ追加。個別 `redirect()` 直書き禁止（無限ループ温床）。`tests/unit/routing/legacy-url-map.test.ts` + `tests/e2e/legacy-url-redirect.spec.ts` も追加。エントリは永久保持（ブックマーク維持のため削除禁止）。

## `?screenshot` モード（#1164 / #1209 / #1893 / #2097 PR-B1 hotfix #2 / PR-B3 #2188）

LP SS 撮影用に **全 route** で本番一致演出を強制 ON + demo 固有 UI を一括非表示。SSOT は `src/routes/+layout.svelte` (root) の 1 箇所のみで `setScreenshotModeContext()` 経由 context 配布、配下の page / component は `getScreenshotMode()` / `getScreenshotModeKind()` で参照。

> **#2097 PR-B3 (#2188)**: `src/routes/demo/**` 全削除に伴い、screenshot mode context は root +layout.svelte (PR-B1 hotfix #2 で hoist 済) で全 route に提供される。旧 demo ルート (`+layout.svelte` 等) の context 設置は撤去済み。demo Lambda 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo、ADR-0048) でも本番ルートが直接 host されるため、`?screenshot=*` は demo / production 両 Lambda で同一動作。

| URL パラメータ | mode | 用途 |
|---|---|---|
| (なし) | `'off'` | 通常デモ表示 |
| `?screenshot=1` | `'noise-only'` | demo 固有 UI のみ非表示 (旧挙動、後方互換) |
| `?screenshot=all` | `'all'` | demo 固有 UI 非表示 + 本番一致演出強制 ON (#1893) |

`?screenshot=all` モード (#1893): demo (child) layout で `MilestoneBanner` を強制表示する等、本番 NUC ユーザの実画面と一致する演出を screenshot 撮影時に再現する。LP 配信 SS が本番乖離する事故 (PO 直接指摘 8 回連続再発) への構造的対策。

```svelte
<script>
import { getScreenshotMode, getScreenshotModeKind } from '$lib/features/demo/screenshot-mode.js';

const isScreenshot = getScreenshotMode();        // 'noise-only' | 'all' で true
const kind = getScreenshotModeKind();            // 'off' | 'noise-only' | 'all'
const isScreenshotAll = $derived(kind === 'all');
</script>
{#if !isScreenshot}<div class="demo-only-notice">…</div>{/if}
{#if isScreenshotAll}<MilestoneBanner ... bypassSeenCheck />{/if}
```

**禁止**: page 側で `$page.url.searchParams.get('screenshot')` 再呼出 / props drilling / global `$state` 化。リグレッション検出: `tests/e2e/demo-lambda/visual-equality.spec.ts`

**capture-hp-screenshots.mjs**: `withScreenshotParam(path)` のデフォルトは `screenshot=all` (#1893)。後方互換で `?screenshot=1` が必要な場合は `withScreenshotParam(path, { mode: 'noise-only' })` を使う。

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
- demo モードは **env で起動** する (ADR-0048 / #2189 PR-B4 で cookie/query signal 撤去済): `AUTH_MODE=anonymous DATA_SOURCE=demo npm run preview` 等。ローカル開発で誤って demo に入った場合は env を unset して再起動するだけで本番モードに戻る

#### rebase 後の screenshots branch push 必須（#2063）

実装 branch を `git push --force` で rebase した場合、**`screenshots` branch は独立 branch のため自動更新されない**。修正後 SS は必ず別途撮影し screenshots branch に push すること。push を怠ると Before / After SS が完全同一画像のまま PR body に残り、CI gate (`pr-quality-gate.yml` `ss-blob-sha-uniqueness-check`) が **Blob SHA 一致 = 偽装** として hard-fail する (#2063 / 起因事例: PR-2054 で 3 ラウンド連続偽装発生 → user 判断 close)。

```bash
# rebase 後の正しい流れ
git push --force-with-lease origin <branch>
node scripts/capture.mjs --pr <N>            # 修正後 SS を撮り直す
# scripts/capture.mjs が screenshots branch への push まで担当する場合はここで完結
# 手動運用時は capture 結果を screenshots branch にコミット & push
```

## 局所テストコマンド (#2184)

routes 配下のみ修正時は全体テストを待たず以下で高速検証:

```bash
npx vitest run src/routes/                                      # routes 配下 unit test
npx playwright test tests/e2e/<関連>.spec.ts                    # 該当 E2E spec 個別実行
npx playwright test tests/e2e/legacy-url-redirect.spec.ts       # URL リネーム時
npx playwright test tests/e2e/demo-lambda/visual-equality.spec.ts  # demo `?screenshot` モード変更時
```

SSOT: `docs/CLAUDE.md` §「サブディレクトリ別局所テストコマンド SSOT」。Ready 化前は `npm run pre-ready -- --pr <num>` で全 step PASS が必須。

## 絶対にやってはいけないこと

- 実画面未確認でゴールに `[x]`（検証偽装）
- チケット「提案」と異なる方式で実装しながらゴール達成と報告
- デモ + 本番など複数対象チケットで一方のみ修正して Done
