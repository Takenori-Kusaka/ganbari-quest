# File Inventory（LP 関連ファイル一覧）

LP review 時に参照する全ファイルの一覧。新規ファイル追加時は本リストも更新。

## site/ (LP 本体)

- `site/index.html` — メイン LP（section 構成は `grep -nE "<section|<footer" site/index.html` で確認する）
- `site/pamphlet.html` — パンフレット版
- `site/pricing.html` — 価格詳細ページ
- `site/faq.html` — FAQ 詳細
- `site/{privacy,terms,sla,tokushoho}.html` — 法務ページ
- `site/selfhost.html` — セルフホスト訴求
- `site/graduation.html` — graduation シリーズ
- 上記で漏れがないかは `ls site/*.html` を正とする
- `site/shared.css` — `:root` トークン (ADR-0042) + 全ページ共通 base
- `site/shared-labels.js` — labels SSOT 注入機構 (ADR-0045 / ADR-0025)。`scripts/generate-lp-labels.mjs` の生成物なので直接編集しない

## src/lib/domain/labels/lp.ts

LP labels SSOT（compound）。LP 用 namespace (`LP_*`) はすべてこのファイルに置く（docs/DESIGN.md §6 配置規則の 1 行目）。atom は `src/lib/domain/terms.ts`（ADR-0045）。LP の値に使う共有文 (`WRITES_CONTINUE_ASSURANCE` 等) は他の labels ファイルにあり、`lp.ts` の import から辿れる。

## scripts/

- `scripts/measure-lp-dimensions.mjs` — ratchet 検証（検査項目・閾値は同 script の `THRESHOLDS` と `docs/CLAUDE.md` §LP メトリクス ratchet が SSOT）
- `scripts/check-lp-innerhtml-tags.mjs` — innerHTML 構造保持検証 (ADR-0025)
- `scripts/generate-lp-labels.mjs` — labels 層 → shared-labels.js 再生成
- `scripts/capture.mjs --server-mode lp` — LP SS 撮影

## .github/workflows/lp-metrics.yml

CI による ratchet 検証 + cumulative-lp-metrics ジョブ (#1840 ADR-0042)。

## docs/

- `docs/design/lp-content-map.md` — IA SSOT (#1163)
- `docs/design/19-プライシング戦略書.md` — 附則 Committed/Aspirational 区分
- `docs/decisions/0013-lp-truth-from-implementation.md` — LP truth 原則
- `docs/decisions/0025-lp-ssot-html-injection-with-xss-protection.md` — DOMPurify
- `docs/decisions/0029-lp-csp-and-cdn-sri-strategy.md` — CSP / SRI
- `docs/decisions/0042-lp-spacing-layout-tokens.md` — Spacing 3 層トークン

## site/screenshots/ (LP 用 SS)

LP の各セクションを撮影した SS（`feature-*.webp` / `growth-stage-*.webp` 等）。詳細: @docs/design/asset-catalog.md
