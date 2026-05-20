/**
 * scripts/capture-specs/flows/settings-audit-2319.mjs (EPIC #2319 / PR #2326)
 *
 * /admin/settings の hub + 5 child routes を順次撮影する flow:
 *   1. settings-hub             — /admin/settings (hub)
 *   2. settings-account         — /admin/settings/account (Danger Zone)
 *   3. settings-activities      — /admin/settings/activities
 *   4. settings-notifications   — /admin/settings/notifications
 *   5. settings-data            — /admin/settings/data (Danger Zone)
 *   6. settings-support         — /admin/settings/support
 *
 * 動作前提: npm run dev:cognito (port 5174)
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5174 node scripts/capture.mjs \
 *     --flow settings-audit-2319 \
 *     --url /admin/settings \
 *     --actions scripts/capture-specs/flows/settings-audit-2319.mjs \
 *     --base-url http://localhost:5174 \
 *     --out tmp/screenshots/pr-2326/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

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
	// owner@example.com で login
	await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x');

	const routes = [
		{ path: '/admin/settings', label: 'settings-hub' },
		{ path: '/admin/settings/account', label: 'settings-account' },
		{ path: '/admin/settings/activities', label: 'settings-activities' },
		{ path: '/admin/settings/notifications', label: 'settings-notifications' },
		{ path: '/admin/settings/data', label: 'settings-data' },
		{ path: '/admin/settings/support', label: 'settings-support' },
	];

	for (const { path: routePath, label } of routes) {
		await page.goto(`${BASE_URL}${routePath}`, { waitUntil: 'domcontentloaded' });
		// 主要要素 (h1 等) が render 完了するのを deterministic に待つ
		await page
			.locator('h1, h2')
			.first()
			.waitFor({ state: 'visible', timeout: 15_000 })
			.catch(() => {});
		// 追加 100ms 安定化待ち (font/icon 描画落ち着き)
		await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
		await capture(label);
	}
};
