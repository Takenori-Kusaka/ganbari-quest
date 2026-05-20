/**
 * scripts/capture-specs/settings-audit-2319.mjs (EPIC #2319 / PR #2326)
 *
 * /admin/settings hub + 5 child routes 撮影 config (capture.mjs --config 用)。
 * 各 route を mobile + desktop で撮影 (合計 12 SS)。
 *
 * 動作前提:
 *   - npm run dev:cognito (port 5174) を別 terminal で起動済み
 *   - --storage-state で owner@example.com の認証済 storageState を渡す
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --config scripts/capture-specs/settings-audit-2319.mjs \
 *     --base-url http://localhost:5174 \
 *     --storage-state tmp/auth-state-owner.json \
 *     --out tmp/screenshots/pr-2326/
 */

export default [
	{ url: '/admin/settings', name: 'settings-hub', presets: ['mobile', 'desktop'] },
	{ url: '/admin/settings/account', name: 'settings-account', presets: ['mobile', 'desktop'] },
	{ url: '/admin/settings/activities', name: 'settings-activities', presets: ['mobile', 'desktop'] },
	{ url: '/admin/settings/notifications', name: 'settings-notifications', presets: ['mobile', 'desktop'] },
	{ url: '/admin/settings/data', name: 'settings-data', presets: ['mobile', 'desktop'] },
	{ url: '/admin/settings/support', name: 'settings-support', presets: ['mobile', 'desktop'] },
];
