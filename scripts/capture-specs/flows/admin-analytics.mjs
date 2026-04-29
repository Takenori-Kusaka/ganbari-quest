/**
 * scripts/capture-specs/flows/admin-analytics.mjs (#1639)
 *
 * /admin/analytics の DynamoDB ベース 4 種可視化スクリーンショット撮影フロー。
 * AUTH_MODE=cognito (npm run dev:cognito) で動作。owner ロールでログインしてから撮影する。
 *
 * 使用例:
 *   node scripts/capture.mjs \
 *     --flow admin-analytics \
 *     --url /admin/analytics \
 *     --actions scripts/capture-specs/flows/admin-analytics.mjs \
 *     --server-mode cognito \
 *     --presets desktop,mobile \
 *     --out tmp/screenshots/pr-1639/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// owner でログイン (Cognito dev mock)
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	const emailInput = page.getByLabel('メールアドレス');
	await emailInput.click();
	await emailInput.pressSequentially('owner@example.com', { delay: 5 });
	const pwdInput = page.getByLabel('パスワード', { exact: true });
	await pwdInput.click();
	await pwdInput.pressSequentially('Gq!Dev#Owner2026x', { delay: 5 });
	// 送信ボタンが enabled になるまで明示的に待つ
	await page.locator('button[type="submit"]:not([disabled])').first().waitFor({
		state: 'visible',
		timeout: 10_000,
	});
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/admin/, { timeout: 30_000 });

	// /admin/analytics へ遷移
	await page.goto(`${BASE_URL}/admin/analytics`);
	await page.locator('h1').waitFor({ state: 'visible', timeout: 10_000 });
	// 4 セクション全部レンダー後を確認
	await page.getByText('アクティベーションファネル').waitFor({ state: 'visible', timeout: 5_000 });
	await page.getByText('リテンションコホート').waitFor({ state: 'visible', timeout: 5_000 });
	await page.getByText('Sean Ellis').waitFor({ state: 'visible', timeout: 5_000 });
	await page.getByText('解約理由分布').waitFor({ state: 'visible', timeout: 5_000 });

	// 上半分 (activation funnel + retention cohort)
	await capture('admin-analytics-top');

	// 下半分 (sean ellis + cancellation reasons)
	await page.getByText('Sean Ellis').scrollIntoViewIfNeeded();
	await capture('admin-analytics-bottom');
};
