/**
 * scripts/capture-specs/lp.mjs
 *
 * npm run capture:lp 用設定ファイル。
 * site/ 配下の LP ページを mobile + desktop で撮影する。
 *
 * 前提: site/ を静的ファイルサーバーで配信する必要がある。
 *
 * 使用例（--server-mode lp が静的サーバーを自動起動する）:
 *   node scripts/capture.mjs --server-mode lp --config scripts/capture-specs/lp.mjs --out tmp/screenshots/
 *   node scripts/capture.mjs --pr 123 --server-mode lp --config scripts/capture-specs/lp.mjs
 *
 * または手動でサーバーを起動する場合:
 *   npx serve site -l 5280 &
 *   node scripts/capture.mjs --base-url http://localhost:5280 \
 *     --config scripts/capture-specs/lp.mjs --out tmp/screenshots/
 */

/** @type {Array<{ url: string; name: string; presets?: string[]; fullPage?: boolean }>} */
export default [
	// ---- LP トップ (index.html) ----
	{
		url: '/index.html',
		name: 'lp-top',
		presets: ['desktop', 'mobile'],
		fullPage: false, // ファーストビューのみ（フルページは lp-top-full を使用）
	},
	{
		url: '/index.html',
		name: 'lp-top-full',
		presets: ['desktop', 'mobile'],
		fullPage: true,
	},
	// ---- パンフレット (pamphlet.html) ----
	{
		url: '/pamphlet.html',
		name: 'lp-pamphlet',
		presets: ['desktop', 'mobile'],
		fullPage: true,
	},
	// ---- プライシング (pricing.html) ----
	{
		url: '/pricing.html',
		name: 'lp-pricing',
		presets: ['desktop', 'mobile'],
		fullPage: false,
	},
	// ---- FAQ ----
	{
		url: '/faq.html',
		name: 'lp-faq',
		presets: ['desktop', 'mobile'],
		fullPage: false,
	},
];
