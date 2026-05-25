/**
 * scripts/capture-specs/flows/child-home-per-child-pr2485.mjs
 *
 * PR #2485 (#2471): 子供 home の activity per-child 絞り込み修正 SS フロー
 *
 * 背景:
 *   PR #2455 (ADR-0055 per-child instance flip) 完了後、子供 home `/(child)/[uiMode]/home` の
 *   load() が依然として `getActivities(tenantId)` (tenant 全 child を aggregate) を呼んでおり、
 *   5 children seed 環境では同名 activity が child 数分重複 render される UX 退行が発生していた。
 *
 *   本 PR で `getChildActivities(child.id, tenantId, filter)` に切替え、選択中 child の per-child
 *   instance のみを render するようにした。
 *
 * 撮影状態:
 *   1. たろうくん (preschool, 902) home: per-child instance のみ visible (no duplicates)
 *   2. けんたくん (elementary, 903) home: 異なる per-child instance set
 *   3. ゆうこちゃん (junior, 904) home: 異なる per-child instance set
 *
 * 使用例:
 *   BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow child-home-per-child-pr2485 \
 *     --actions scripts/capture-specs/flows/child-home-per-child-pr2485.mjs \
 *     --presets desktop,mobile \
 *     --pr 2485
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * cookie で selectedChildId を pre-set してから home に遷移する
 *
 * preview server は AUTH_MODE=anonymous + DATA_SOURCE=demo で起動している前提
 * (capture-hp-screenshots.mjs と同じ env)。fixture ID:
 *   baby=901 / preschool=902 / elementary=903 / junior=904 / senior=906
 *
 * @param {import('playwright').Page} page
 * @param {number} childId
 * @param {string} uiMode
 */
async function gotoChildHome(page, childId, uiMode) {
	await page.context().addCookies([
		{
			name: 'selectedChildId',
			value: String(childId),
			url: BASE_URL,
		},
	]);
	await page.goto(`${BASE_URL}/${uiMode}/home?screenshot=all`);
	// activity-card render 完了 + hydration 安定待ち
	await page
		.locator('[data-testid^="activity-card-"]')
		.first()
		.waitFor({ state: 'visible', timeout: 15_000 });
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) たろうくん (preschool, 902) home ---
	await gotoChildHome(page, 902, 'preschool');
	await capture('pr2485-preschool-taro-home');

	// --- 2) けんたくん (elementary, 903) home ---
	await gotoChildHome(page, 903, 'elementary');
	await capture('pr2485-elementary-kenta-home');

	// --- 3) ゆうこちゃん (junior, 904) home ---
	await gotoChildHome(page, 904, 'junior');
	await capture('pr2485-junior-yuko-home');
};
