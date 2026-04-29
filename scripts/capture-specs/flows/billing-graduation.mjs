/**
 * scripts/capture-specs/flows/billing-graduation.mjs (#1603 / ADR-0023 §3.8 / §5 I10)
 *
 * 卒業フロー専用ページ + ops 卒業セクションのスクリーンショット撮影フロー。
 * AUTH_MODE=cognito (npm run dev:cognito) で動作。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow billing-graduation \
 *     --url /admin/billing/cancel/graduation \
 *     --actions scripts/capture-specs/flows/billing-graduation.mjs \
 *     --server-mode cognito \
 *     --presets desktop,mobile \
 *     --out docs/screenshots/pr-1603/
 *
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow ops-graduation \
 *     --url /ops/analytics \
 *     --actions scripts/capture-specs/flows/billing-graduation.mjs \
 *     --server-mode cognito \
 *     --presets desktop,mobile \
 *     --out docs/screenshots/pr-1603/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function loginAs(page, email, password) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	// hydration が完了するまで少し待つ（Svelte 5 runes の reactivity が動き始める）
	await page.waitForFunction(
		() => {
			const input = document.querySelector('input[name="email"]');
			// Svelte 5 では window 上の何らかの hydration マーカーは無いが、
			// FormField primitive の input が type="email" になっていれば hydrated
			return input?.getAttribute('type') === 'email';
		},
		{ timeout: 15_000 },
	);

	// pressSequentially で 1 文字ずつ送信（Svelte 5 runes の reactivity を確実にトリガー）
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

	// submit ボタンが enabled になるまで待つ
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
	// graduation page は parent ロール (owner) で表示
	// ops/analytics は ops グループの owner で表示
	// 両方を1セッションで撮るため、まず graduation を owner で撮る
	const url = page.url();
	const isOpsCapture = url.includes('/ops/');

	if (isOpsCapture) {
		// ops 用: ops@example.com でログイン
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.goto(`${BASE_URL}/ops/analytics`);
		await page.locator('h1').waitFor({ state: 'visible', timeout: 10_000 });
		// 卒業セクションが見えるまで scroll
		const section = page.getByTestId('ops-graduation-section');
		await section.waitFor({ state: 'visible', timeout: 10_000 });
		await section.scrollIntoViewIfNeeded();
		await capture('ops-graduation-section');
		return;
	}

	// graduation page 用: owner@example.com でログイン
	await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x');
	await page.goto(`${BASE_URL}/admin/billing/cancel/graduation`);
	await page.getByTestId('graduation-page').waitFor({ state: 'visible', timeout: 15_000 });
	// ヘッダー + ポイントセクション
	await capture('graduation-page-top');
	// 還元提案セクション
	await page.getByTestId('graduation-reward-section').scrollIntoViewIfNeeded();
	await capture('graduation-page-rewards');
	// 事例公開承諾セクション
	await page.getByTestId('graduation-consent-section').scrollIntoViewIfNeeded();
	await capture('graduation-page-consent');
	// チェックボックスを ON にした状態
	await page.getByTestId('graduation-consent-checkbox').check();
	await page.getByTestId('graduation-nickname').fill('たろう家');
	await capture('graduation-page-consent-filled');
};
