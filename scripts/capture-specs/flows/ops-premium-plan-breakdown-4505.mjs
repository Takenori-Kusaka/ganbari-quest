/**
 * scripts/capture-specs/flows/ops-premium-plan-breakdown-4505.mjs (#4505)
 *
 * /ops のプラン内訳テーブルにプレミアム行が追加されたことを撮る。
 * ops@example.com (MFA 済) でログインして /ops を開くだけの単純フロー。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr 4506 \
 *     --flow ops-premium-plan-breakdown \
 *     --url /ops \
 *     --server-mode cognito \
 *     --actions scripts/capture-specs/flows/ops-premium-plan-breakdown-4505.mjs \
 *     --presets desktop,mobile
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function login(page, email, password) {
	await page.goto(`${BASE_URL}/auth/logout`).catch(() => {});
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type(email, { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type(password, { delay: 20 });

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
	await login(page, 'ops@example.com', devPassword('ops@example.com'));
	await page.goto(`${BASE_URL}/ops`);
	await page.waitForLoadState('domcontentloaded');
	await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
	await page.getByText('プラン別内訳').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('ops-plan-breakdown-with-premium');
};
