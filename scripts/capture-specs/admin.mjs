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
 *
 * DOM スナップショット (#1747 AC4 / #1766):
 *   各 SS と同じディレクトリに <name>.dom.html が同一プロセスで自動保存される。
 *   無効化したい場合は --no-dom-snapshot を付与（推奨されない）。
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
	// #2097 PR-B2 (#2187): /demo/(child)/* 撤去に伴い本番 (child) routes に切替
	{
		url: '/preschool/home',
		name: 'child-home-preschool',
		presets: ['mobile'],
	},
	// ---- 子供ホーム（小学生モード） ----
	{
		url: '/elementary/home',
		name: 'child-home-elementary',
		presets: ['mobile'],
	},
	// ---- 子供ステータス ----
	{
		url: '/elementary/status',
		name: 'child-status-elementary',
		presets: ['mobile'],
	},
	// ---- 実績 ----
	{
		url: '/elementary/achievements',
		name: 'child-achievements-elementary',
		presets: ['mobile'],
	},
	// ---- 持ち物チェックリスト ----
	{
		url: '/checklist',
		name: 'checklist',
		presets: ['desktop', 'mobile'],
	},
];
