/**
 * scripts/capture-specs/flows/switch-timed-out.mjs (#3125)
 *
 * 親管理画面の inactivity redirect で `/switch?timedOut=1` に戻ったときの通知バナー
 * (data-testid="parent-gate-timed-out-banner") を撮影する flow。
 * owner login → /switch?timedOut=1 を開き、子供選択画面 + timedOut バナーを撮影する。
 *
 * 動作前提: PARENT_GATE_FORCE_ACTIVE=true npm run dev:cognito (port 5174)
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 PARENT_GATE_FORCE_ACTIVE=true node scripts/capture.mjs \
 *     --pr 3127 --base-url http://localhost:5174 \
 *     --flow switch-timed-out --url "/switch?timedOut=1" \
 *     --actions scripts/capture-specs/flows/switch-timed-out.mjs \
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

	await page.goto(`${BASE_URL}/switch?timedOut=1`);
	const banner = page.getByTestId('parent-gate-timed-out-banner');
	await banner.waitFor({ state: 'visible', timeout: 15_000 });

	await capture('switch-timed-out');
};
