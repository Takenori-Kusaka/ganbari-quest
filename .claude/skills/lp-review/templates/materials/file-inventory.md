# File Inventory（LP 関連ファイル一覧）

LP review 時に参照する全ファイルの一覧。新規ファイル追加時は本リストも更新。

## site/ (LP 本体)

- `site/index.html` — メイン LP（hero / core-loop / machine-tour / soft-features / growth-roadmap / pricing / faq / cta / footer）
- `site/pamphlet.html` — パンフレット版
- `site/pricing.html` — 価格詳細ページ
- `site/faq.html` — FAQ 詳細
- `site/legal/{privacy,terms,sla,tokushoho}.html` — 法務ページ
- `site/graduation.html` — graduation シリーズ
- `site/shared.css` — `:root` トークン (ADR-0042) + 全ページ共通 base
- `site/shared-labels.js` — labels SSOT 注入機構 (ADR-0009 / ADR-0025)

## src/lib/domain/labels.ts

LP labels SSOT。`LP_HERO_LABELS` / `LP_CORELOOP_LABELS` / `LP_PRICING_LABELS` / `LP_NAV_LABELS` / `LP_FOOTER_LABELS` / `LP_FAQ_LABELS` 等。

## scripts/

- `scripts/measure-lp-dimensions.mjs` — ratchet 検証（mobile/desktopHeight / forbidden / cta / preset / residue）
- `scripts/check-lp-removal-residue.mjs` — orphan `data-lp-key` / 画像参照検出
- `scripts/check-lp-innerhtml-tags.mjs` — innerHTML 構造保持検証 (ADR-0025)
- `scripts/generate-lp-labels.mjs` — labels.ts → shared-labels.js 再生成
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
