/**
 * scripts/capture-specs/flows/admin-redemption-banner.mjs (#3144)
 *
 * admin ホームの「ごほうび交換 承認待ち」バナー (data-testid="redemption-pending-banner") を撮影する。
 * 通常 pending > 0 のときのみ表示される transient state のため、既存の `?screenshot=all` モード
 * (src/routes/CLAUDE.md §?screenshot) で代表件数 2 にて強制描画して撮影する。
 *
 * 動作前提: npm run dev:cognito (PARENT_GATE_FORCE_ACTIVE なし = COGNITO_DEV_MODE で PIN gate 無効、
 *   owner login だけで /admin に到達)。port 5174。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --pr 3146 --base-url http://localhost:5174 \
 *     --flow admin-redemption-banner --url "/admin?screenshot=all" \
 *     --actions scripts/capture-specs/flows/admin-redemption-banner.mjs \
 *     --presets mobile,desktop
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
	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x');

	await page.goto(`${BASE_URL}/admin?screenshot=all`);
	const banner = page.getByTestId('redemption-pending-banner');
	await banner.waitFor({ state: 'visible', timeout: 15_000 });

	await capture('admin-redemption-banner');
};
