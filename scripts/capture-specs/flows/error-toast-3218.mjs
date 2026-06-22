/**
 * scripts/capture-specs/flows/error-toast-3218.mjs
 *
 * PR #3221 (Issue #3218, EPIC #3217): 統一エラー通知 P0 の error Toast SS。
 *
 * 撮影目的:
 *   #3218 で改修した Toast primitive の「error = role="alert"(assertive) + 非自動消滅 +
 *   手動 ✕ 閉じ」を実機 (Storybook の Primitives/Toast `Error` story) で視覚的に提示する。
 *   - Before: story 初期状態 (Toast 不在 = silent-failure の起点)。
 *   - After: error ボタン click 後に error Toast が出た状態 (role=alert + ✕ ボタン)。
 *
 *   注: 実 admin 画面 (cheer/points) の error Toast は backend 失敗の決定的再現が困難な
 *   ため、component 層 SSOT である Storybook story で挙動を提示する。挙動の機械検証は
 *   `Toast.stories.svelte` の play 関数 (`npm run test:storybook`、CI 実行) が担保する。
 *
 * 使用例 (Storybook を別途 `npm run storybook` で 6006 起動した状態で):
 *   BASE_URL=http://localhost:6006 node scripts/capture.mjs \
 *     --flow error-toast-3218 \
 *     --url /iframe.html?id=primitives-toast--error&viewMode=story \
 *     --actions scripts/capture-specs/flows/error-toast-3218.mjs \
 *     --presets mobile,desktop --no-start-server --pr 3221
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:6006';
const STORY_URL = `${BASE_URL}/iframe.html?id=primitives-toast--error&viewMode=story`;

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) Before: story 初期状態 (Toast 不在 = 無反応 silent-failure の起点) ---
	await page.goto(STORY_URL);
	await page
		.locator('#storybook-root button')
		.first()
		.waitFor({ state: 'visible', timeout: 15_000 });
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr3221-before-no-toast');

	// --- 2) After: error ボタン click → error Toast (role=alert + ✕ 手動閉じ) ---
	await page.locator('#storybook-root button').first().click();
	await page.getByRole('alert').waitFor({ state: 'visible', timeout: 15_000 });
	// bounce-in アニメーション完了待ち
	await page.waitForTimeout(700);
	await capture('pr3221-after-error-toast-alert');
};
