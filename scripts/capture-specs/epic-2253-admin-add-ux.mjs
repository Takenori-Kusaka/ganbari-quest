/**
 * scripts/capture-specs/epic-2253-admin-add-ux.mjs
 *
 * EPIC #2253 admin/activities add UX 構造的整理の dogfood SS spec。
 *
 * 撮影元: 本番ルート `/admin/activities` (demo Lambda 同型 env で起動)
 *   `AUTH_MODE=anonymous` + `DATA_SOURCE=demo` で preview server を立てる:
 *     `AUTH_MODE=anonymous DATA_SOURCE=demo npx vite dev --port 5173`
 *
 * 撮影:
 *   `MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --pr 2260 --config scripts/capture-specs/epic-2253-admin-add-ux.mjs`
 *
 * 撮影内容 (config モードは静的画面のみ、menu 展開 SS は別途 dev で目視確認):
 *   - 通常一覧 (header + 追加 + ︙ の 2 要素。右下 FAB は 0 個 — FeedbackFab は #2904 で撤去)
 *
 * × mobile + desktop = 2 SS
 *
 * menu 展開 SS (dropdown / overflow) は user-gesture 発火のため capture.mjs config モード
 * では撮れない。E2E spec `tests/e2e/admin-activities-add-ux.spec.ts` で挙動担保し、
 * UX 確認は dev server で目視 (本 PR Issue 説明文中で詳細記述)。
 */

/** @type {Array<{ url: string; name: string; presets?: string[]; selector?: string; cookies?: Array<{name:string; value:string}> }>} */
export default [
	{
		url: '/admin/activities?screenshot=all',
		name: 'epic-2253-admin-activities-default',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="header-add-activity-btn"]',
	},
];
