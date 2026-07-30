/**
 * scripts/capture-specs/checkout-reconciliation-3958.mjs
 *
 * #3958: checkout 完了照合バナー (`CheckoutReconciliationBanner`) の状態別 SS。
 *
 * このバナーは Stripe に実在する checkout session を照合できたときだけ描画されるため、
 * `isStripeEnabled()=false` のローカルアプリ (`dev` / `dev:cognito`) では再現できない。
 * Storybook の story に props を直接渡して 4 状態を撮影する。
 *
 * 使用例:
 *   npm run storybook                      # port 6006 で起動しておく
 *   node scripts/capture.mjs --pr <N> --base-url http://localhost:6006 \
 *     --config scripts/capture-specs/checkout-reconciliation-3958.mjs
 */

const STORY_BASE = '/iframe.html?viewMode=story&id=admin-checkoutreconciliationbanner';

/** @type {Array<{ url: string; name: string; presets?: string[]; selector?: string }>} */
export default [
	{
		url: `${STORY_BASE}--applied`,
		name: 'checkout-reconciliation-applied',
		presets: ['desktop', 'mobile'],
		selector: '#storybook-root > *',
	},
	{
		url: `${STORY_BASE}--already-applied`,
		name: 'checkout-reconciliation-already-applied',
		presets: ['desktop'],
		selector: '#storybook-root > *',
	},
	{
		url: `${STORY_BASE}--pending`,
		name: 'checkout-reconciliation-pending',
		presets: ['desktop', 'mobile'],
		selector: '#storybook-root > *',
	},
	{
		url: `${STORY_BASE}--unresolved`,
		name: 'checkout-reconciliation-unresolved',
		presets: ['desktop'],
		selector: '#storybook-root > *',
	},
];
