/**
 * scripts/capture-specs/child-home-category.mjs
 *
 * #2148 検証用 SS spec (QM Tier 2 Review BLOCK 3 解消)。
 * 子供画面ホームを全 5 年齢モード × mobile/desktop で撮影し、
 * CategorySection のカテゴリヘッダーが `<button>` ではなく `<div>` で描画されている
 * γ 採用の視覚的検証を行う。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr 2239 --config scripts/capture-specs/child-home-category.mjs
 *
 * 認証は不要 (anonymous mode で demo 環境を起動した場合は本番ルートが直接 host される、
 * ADR-0048 #2189 で /demo/ 配下を全削除済み、`src/routes/(child)/[uiMode=uiMode]/home` を直接撮影)。
 *
 * 撮影元 URL: `/<uiMode>/home` (本番ルート、ADR-0048 経路)
 * 待機セレクタ: `[data-testid^="category-header-"]` の最初の 1 件が visible になるまで待つ
 */

/** @type {Array<{ url: string; name: string; presets?: string[]; selector?: string }>} */
export default [
	// 各年齢モードの子供ホーム画面 (#2148 γ 採用: CategorySection collapsible=false 固定)
	{
		url: '/preschool/home',
		name: 'child-home-preschool',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid^="category-header-"]',
	},
	{
		url: '/elementary/home',
		name: 'child-home-elementary',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid^="category-header-"]',
	},
	{
		url: '/junior/home',
		name: 'child-home-junior',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid^="category-header-"]',
	},
	{
		url: '/senior/home',
		name: 'child-home-senior',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid^="category-header-"]',
	},
	{
		url: '/baby/home',
		name: 'child-home-baby',
		presets: ['mobile', 'desktop'],
	},
];
