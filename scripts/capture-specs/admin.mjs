/**
 * scripts/capture-specs/admin.mjs
 *
 * npm run capture:admin 用設定ファイル。
 * Demo 管理画面の代表ページを mobile + desktop で撮影する。
 * 認証不要（demo ルートは全公開）。
 *
 * 使用例:
 *   npm run capture:admin                          # tmp/screenshots/ に保存
 *   node scripts/capture.mjs --pr 123 --config scripts/capture-specs/admin.mjs
 */

/** @type {Array<{ url: string; name: string; presets?: string[]; selector?: string }>} */
export default [
	// ---- 管理画面トップ ----
	{
		url: '/demo/admin',
		name: 'admin-home',
		presets: ['desktop', 'mobile'],
	},
	// ---- 活動記録 ----
	{
		url: '/demo/admin/activities',
		name: 'admin-activities',
		presets: ['desktop', 'mobile'],
	},
	// ---- 子供一覧 ----
	{
		url: '/demo/admin/children',
		name: 'admin-children',
		presets: ['desktop', 'mobile'],
	},
	// ---- レポート ----
	{
		url: '/demo/admin/reports',
		name: 'admin-reports',
		presets: ['desktop', 'mobile'],
	},
	// ---- チャレンジ ----
	{
		url: '/demo/admin/challenges',
		name: 'admin-challenges',
		presets: ['desktop', 'mobile'],
	},
	// ---- 子供ホーム（幼児モード） ----
	{
		url: '/demo/preschool/home',
		name: 'child-home-preschool',
		presets: ['mobile'],
	},
	// ---- 子供ホーム（小学生モード） ----
	{
		url: '/demo/elementary/home',
		name: 'child-home-elementary',
		presets: ['mobile'],
	},
	// ---- 子供ステータス ----
	{
		url: '/demo/elementary/status',
		name: 'child-status-elementary',
		presets: ['mobile'],
	},
	// ---- 実績 ----
	{
		url: '/demo/elementary/achievements',
		name: 'child-achievements-elementary',
		presets: ['mobile'],
	},
	// ---- 持ち物チェックリスト ----
	{
		url: '/demo/checklist',
		name: 'checklist',
		presets: ['desktop', 'mobile'],
	},
];
