# src/routes/ — UI 実装ルール

**SSOT**: デザイン → @docs/DESIGN.md / 用語 → `src/lib/domain/labels.ts` / 並行実装 → @docs/design/parallel-implementations.md

## デザインシステム

詳細は @docs/DESIGN.md §2-5 / §9 禁忌事項。要点のみ:

- **色**: 3 層トークン (Base → Semantic → Component)。routes は Semantic (`--color-action-primary` 等) のみ参照。hex 直書き禁止 (CI: `stylelint color-no-hex`)。**Base トークン (`--color-{brand,neutral,premium}-N`) の routes/features 直接使用は ratchet で機械強制** (`tests/unit/architecture/base-token-routes-ratchet.test.ts`、baseline=221 occurrence を超えると CI fail、#3152 Phase 2 / ADR-0061。削減したら baseline を下げる)
- **コンポーネント**: ボタン → `Button.svelte` / フォーム → `FormField.svelte` / カード → `Card.svelte`。直書き禁止。新パターンは primitives に追加してから使用
- **インラインスタイル**: 動的値のみ許容 (`style:width={pct + '%'}`)。Tailwind arbitrary hex 禁止
- **`<style>` ブロック**: 50 行以下推奨。超過時はコンポーネント分割

## 用語管理

UI ラベル・用語は `src/lib/domain/labels.ts` が SSOT。デモと本番で同じラベル使用必須。変更時は `grep` で全件確認。

### 年齢帯 variant

基本原則: `if (uiMode === 'baby')` 散在 / runtime 動的変換 / Feature Flag 代替 等を避け、`getLabel(key, ctx)` 経由で labels.ts に集約。`+layout.server.ts` で `{ ageTier: params.uiMode }` を context 注入。7 アンチパターン (A1-A7) の網羅と検出方法の詳細は git 履歴 (旧 `docs/decisions/0015-age-tier-variant-architecture.md`、#2898 で削除) 参照。

### 日本語テキスト折り返し（docs/DESIGN.md §3）

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

##### SS の命名規約と、gate が「検査できなかった」ときの扱い（#4084）

`ss-blob-sha-uniqueness` は **Before / After のペアが取れて初めて偽装を検知できる**。旧実装はペアが 0 件だと `skip` で通していたため、命名を変えるだけで検査が黙って消えた（実測: PR #4080 は SS 20 枚 embed 済で `[ss-blob-sha-uniqueness] SKIP` = 1 ペアも検査されず）。現在は **SS が embed されているのにペア 0 件なら fail** する。

| 状況 | 対応 |
|---|---|
| 通常 | file 名を `before-<key>.png` / `after-<key>.png` にする（既定のペアリング） |
| 別の命名で撮りたい | PR body に prefix 宣言を置く: `<!-- ss-pair-prefix: before=develop- after=pr<PR番号>- -->` |
| 個別に対応を書きたい | `<!-- ss-pair: before=<raw URL or path> after=<raw URL or path> -->` |
| ペアが原理的に存在しない（新規画面で修正前が無い 等） | `<!-- ss-pair-none: <12 文字以上の理由> -->` |
| **Before / After が同一なのが正しい** | `<!-- ss-identical-ok: <12 文字以上の理由> -->` |
| **UI は変わるが、その環境では原理的に描画できない** | `<!-- ss-render-impossible: <12 文字以上の理由> -->` + **Storybook story の参照を同じ body 内に必須** |

- **理由は必須**。空欄 / `TODO` / `n/a` 等の定型 stub は受理されない（理由の非強制を作らない、#3956 教訓）
- `ss-identical-ok` は「差分が現れる条件の外で撮影したため描画が一致するのが正しい」ケース用（例: JST 00:00〜09:00 だけ日付がずれる修正を JST 日中に撮影した #4080）。**撮り直し漏れの言い訳には使わない**。宣言しても同一だったペアは出力に列挙される
- `refactor:internal-no-doc-impact` label（視覚差分ゼロの内部 refactor 用）とは意味が違う。**顧客に見える挙動を変える PR には label を付けず、`ss-identical-ok` を使う**
- `ss-render-impossible` は **`ss-blob-sha-uniqueness` ではなく `check-pr-screenshot.mjs`（SS embed gate / pre-ready Step 11b）** 側の宣言（#4087）。表示条件が env に依存し、撮影に使う demo 環境（`DATA_SOURCE=demo`）では出ない UI がこれに当たる。**宣言だけでは通らない — Storybook story の参照が必須**（「原理的に撮れない」は「見た目を確認しなくてよい」ではない）。story は **実在する `*.stories.svelte` のパス**で書く。タイトルだけの言及（`Features/Admin/Foo`）は実在確認ができないため受理されない（#4255）。実環境での確認は後続 Issue に紐付けること

###### 「UI 変更なし」「該当なし（refactor / docs / chore）」は *宣言* として書く（#4255）

この 2 つは書くと **SS 検証がまるごと skip される** opt-out。判定は **行単位**で、その行が宣言かどうかを見る。以下は宣言と見なされない（gate は skip せず SS を要求する）:

- 否定文（「UI 変更なし**ではありません**」）/ 引用行（`> …`）/ コードブロック・インラインコード内
- **未チェックの checkbox**（`- [ ] UI 変更なし`）— チェックしていない = 宣言していない
- 手順・条件節（「UI 変更なし**の場合**: …」）

**テンプレートや案内文に opt-out 宣言そのものを書かない。** テンプレートを消さずに出しただけで gate が skip されるため、案内は「何を書くか」の説明にとどめる（`tests/unit/scripts/check-pr-screenshot.test.ts` が実テンプレートを読んで検証している）。

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
