/**
 * scripts/capture-specs/shop-tabs-filter.mjs
 *
 * #2157 + #2160 検証用 SS spec。
 * 子供ショップ画面を全 5 年齢モード × mobile/desktop で撮影。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr 2235 --config scripts/capture-specs/shop-tabs-filter.mjs
 *
 * 認証は不要 (anonymous mode で demo 環境を起動した場合は本番ルートが直接 host される、
 * ADR-0048 #2189 で /demo/ 配下を全削除済み、`src/routes/(child)/[uiMode=uiMode]/shop` を直接撮影)。
 */

/** @type {Array<{ url: string; name: string; presets?: string[]; selector?: string }>} */
export default [
	// 各年齢モードのショップ画面 (初期状態 = すべてタブ + フィルタ未適用)
	{
		url: '/preschool/shop',
		name: 'shop-preschool',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
	},
	{
		url: '/elementary/shop',
		name: 'shop-elementary',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
	},
	{
		url: '/junior/shop',
		name: 'shop-junior',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
	},
	{
		url: '/senior/shop',
		name: 'shop-senior',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
	},
	{
		url: '/baby/shop',
		name: 'shop-baby',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
	},
];
