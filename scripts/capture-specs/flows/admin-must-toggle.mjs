/**
 * scripts/capture-specs/flows/admin-must-toggle.mjs (#1756 / #1709-B)
 *
 * /admin/activities/[id]/edit must トグル + /admin/checklists kind タブ削除 検証用フロー。
 * AUTH_MODE=cognito (npm run dev:cognito) で動作。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow admin-must-toggle \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/admin-must-toggle.mjs \
 *     --base-url http://localhost:5180 \
 *     --presets desktop,mobile \
 *     --out docs/screenshots/pr-1756/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

async function loginAs(page, email, password) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => {
			const input = document.querySelector('input[name="email"]');
			return input?.getAttribute('type') === 'email';
		},
		{ timeout: 15_000 },
	);

	const emailInput = page.getByLabel('メールアドレス');
	await emailInput.click();
	for (const ch of email) {
		await page.keyboard.type(ch, { delay: 20 });
	}

	const pwdInput = page.getByLabel('パスワード', { exact: true });
	await pwdInput.click();
	for (const ch of password) {
		await page.keyboard.type(ch, { delay: 20 });
	}

	await page.locator('button[type="submit"]:not([disabled])').first().waitFor({
		state: 'visible',
		timeout: 30_000,
	});
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// owner@example.com (default state — already has children/activities seeded by setup flow if needed)
	await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x');

	// セットアップ未完了なら setup 経由で /admin に飛ぶケースもあるので明示的に navigate
	await page.goto(`${BASE_URL}/admin/activities`);
	// 一覧画面 (must Badge 表示前)
	await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('admin-activities-list-before');

	// 編集リンクが存在するか確認
	const editLink = page.getByTestId('activity-edit-link').first();
	if (await editLink.count() > 0) {
		await editLink.click();
		await page.waitForURL(/\/admin\/activities\/\d+\/edit$/, { timeout: 10_000 });
		// 編集画面 (must トグル UI)
		await page.getByTestId('must-toggle-section').waitFor({ state: 'visible', timeout: 10_000 });
		await capture('admin-activity-edit-must-off');

		// must トグル ON 状態
		const checkbox = page.getByTestId('must-toggle-checkbox');
		if (!(await checkbox.isChecked())) {
			await checkbox.check();
		}
		await capture('admin-activity-edit-must-on');

		// 保存
		const save = page.getByTestId('activity-edit-save');
		await save.click();
		await page.waitForURL(`${BASE_URL}/admin/activities`, { timeout: 15_000 });
		// 一覧画面 (must Badge 表示後)
		await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 10_000 });
		await capture('admin-activities-list-with-must-badge');
	}

	// /admin/checklists 画面 (kind タブ削除済み)
	await page.goto(`${BASE_URL}/admin/checklists`);
	await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('admin-checklists-no-kind-tab');
};
