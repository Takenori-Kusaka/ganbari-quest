/**
 * scripts/capture-specs/flows/admin-rules-family-scope-pr6.mjs
 *
 * #2362 PR-6 / #2895: admin/settings/rules family-scope UX SS フロー
 *
 * #2895 で in-page OverflowMenu / help-restore-export dialog / browse UI を撤去し、
 * 本画面を「取込済 bonus ルールの確認 + ON/OFF + 削除」に簡素化したため、
 * 撮影状態を以下 2 状態に縮約した (旧 OverflowMenu open / help dialog state は撤去):
 *   1. default state (empty + family-wide 一覧、per-child タブなし)
 *   2. ?import=<presetId> auto-import 完了後 (一覧に追加 + toast 表示)
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 node scripts/capture.mjs \
 *     --flow admin-rules-family-scope-pr6 \
 *     --url /admin/settings/rules?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-rules-family-scope-pr6.mjs \
 *     --presets desktop,mobile \
 *     --pr <PR_NUMBER>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) default state: family-wide 一覧 (per-child タブなし) ---
	await page.goto(`${BASE_URL}/admin/settings/rules?screenshot=all`);
	await page.getByTestId('admin-rules-page').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('pr6-admin-rules-default');

	// --- 2) ?import=<presetId> auto-import: streak-bonus 取込後の一覧反映 ---
	await page.goto(`${BASE_URL}/admin/settings/rules?import=streak-bonus&screenshot=all`);
	await page.getByTestId('admin-rules-page').waitFor({ state: 'visible', timeout: 15_000 });
	// auto-import 完了で preset が一覧に追加されるのを待つ
	await page
		.getByTestId('rules-bonus-preset-streak-bonus')
		.waitFor({ state: 'visible', timeout: 30_000 });
	await capture('pr6-admin-rules-after-import');
};
