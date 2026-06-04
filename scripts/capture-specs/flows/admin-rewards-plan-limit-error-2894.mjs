/**
 * scripts/capture-specs/flows/admin-rewards-plan-limit-error-2894.mjs
 *
 * #2894 AC3: free tier の reward-set 取込 → PlanLimitError 構造化メッセージ + upgrade 導線。
 *
 * 旧 bug: `String(error)` が PlanLimitError オブジェクトを `[object Object]` 化していた。
 * 本 fix で getActionErrorDisplay 経由で構造化メッセージ + `/admin/subscription` リンクを表示する。
 *
 * 撮影 2 状態:
 *   1. ?import=<presetId> → ChildSelectionDialog auto-open (free state)
 *   2. 確定 click → PlanLimitError banner (rewards-action-message) + upgrade 導線 (rewards-upgrade-link)
 *
 * 前提: cognito-dev サーバ (port 5174) + free storageState。
 *   AUTH_MODE=cognito COGNITO_DEV_MODE=true npm run dev:cognito で起動し、
 *   --storage-state playwright/.auth/free.json を渡す。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5174 node scripts/capture.mjs \
 *     --flow admin-rewards-plan-limit-error-2894 \
 *     --url "/admin/rewards?import=kinder-rewards" \
 *     --actions scripts/capture-specs/flows/admin-rewards-plan-limit-error-2894.mjs \
 *     --storage-state playwright/.auth/free.json \
 *     --presets desktop --pr 2894
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function waitForDialogOpen(page, testid) {
	await page.waitForFunction(
		(t) => {
			const el = document.querySelector(`[data-testid="${t}"]`);
			if (!el) return false;
			return el.getAttribute('data-state') === 'open' && !el.hasAttribute('hidden');
		},
		testid,
		{ timeout: 15_000, polling: 100 },
	);
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
	// --- 1) ?import=<presetId> → ChildSelectionDialog auto-open ---
	await page.goto(`${BASE_URL}/admin/rewards?import=kinder-rewards`);
	await waitForDialogOpen(page, 'reward-import-child-selection-dialog');
	await capture('2894-rewards-import-dialog-open');

	// --- 2) 確定 → free tier の PlanLimitError banner + upgrade 導線 ---
	const confirm = page.getByTestId('child-selection-confirm');
	await confirm.click();
	// banner が表示され、[object Object] でない構造化メッセージ + upgrade link を待つ。
	await page.getByTestId('rewards-action-message').waitFor({ state: 'visible', timeout: 15_000 });
	await page.getByTestId('rewards-upgrade-link').waitFor({ state: 'visible', timeout: 10_000 });
	await capture('2894-rewards-plan-limit-error-with-upgrade-link');
};
