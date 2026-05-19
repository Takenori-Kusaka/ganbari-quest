/**
 * scripts/capture-specs/pr-2293-cheer.mjs
 *
 * PR #2293 QM Tier 2 Fix: SS 4 枚が /setup 画面のみで PR 主題 (/admin/cheer / /admin)
 * 不在 + Blob SHA 偽装 2 ペアの差替え用。
 *
 * 撮影対象:
 *   - /admin/cheer (新規画面、Issue #2267)
 *   - /admin (ナビ再構造、Issue #2274)
 *   - /preschool/home?screenshot=all (子供画面 cheer 受信、preschool 児)
 *   - /elementary/home?screenshot=all (子供画面 cheer 受信、elementary 児)
 *
 * 起動 server: AUTH_MODE=local の `npx vite dev --port 5180`
 *   ローカル DB seed: children id=1 (preschool), id=2 (elementary)
 *
 * 使用例:
 *   BASE_URL=http://localhost:5180 MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --pr 2293 --config scripts/capture-specs/pr-2293-cheer.mjs
 */

/** @type {Array<{ url: string; name: string; presets?: string[]; cookies?: Array<{name: string; value: string}> }>} */
export default [
	// ---- /admin/cheer (新規画面、Issue #2267) ----
	{
		url: '/admin/cheer',
		name: 'admin-cheer',
		presets: ['desktop', 'mobile'],
	},
	// ---- /admin (ナビ再構造、Issue #2274) ----
	{
		url: '/admin',
		name: 'admin-home',
		presets: ['desktop', 'mobile'],
	},
	// ---- 子供画面 cheer 受信 (preschool 児、ローカル DB id=1) ----
	{
		url: '/preschool/home?screenshot=all',
		name: 'child-cheer-preschool',
		presets: ['desktop', 'mobile'],
		cookies: [{ name: 'selectedChildId', value: '1' }],
	},
	// ---- 子供画面 cheer 受信 (elementary 児、ローカル DB id=2) ----
	{
		url: '/elementary/home?screenshot=all',
		name: 'child-cheer-elementary',
		presets: ['desktop', 'mobile'],
		cookies: [{ name: 'selectedChildId', value: '2' }],
	},
];
