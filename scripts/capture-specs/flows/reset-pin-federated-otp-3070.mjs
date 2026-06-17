/**
 * scripts/capture-specs/flows/reset-pin-federated-otp-3070.mjs
 *
 * #3070: federated (Google) PIN reset の email-OTP フロー SS。
 * 共有端末で親の Google session が生きていると silent SSO で recent-login が無入力通過し得るため、
 * 登録メールへ 6 桁コードを送る email-OTP で本人確認する方式に置換した。
 * 本フローは render-only で以下を撮る (onclick interaction は unit + CI e2e で検証):
 *   - federated stage 1 (送信ボタン、パスワード欄なし)
 *   - password ユーザの reset 画面 (現状維持、比較用)
 *
 * 認証は dev cognito の federated 相当ユーザ google-owner@example.com / password ユーザ owner@example.com。
 * `npm run dev:cognito` 同型 env で起動した server 前提。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow reset-pin-federated-otp-3070 \
 *     --url /auth/reset-pin \
 *     --actions scripts/capture-specs/flows/reset-pin-federated-otp-3070.mjs \
 *     --server-mode cognito --presets desktop,mobile --pr 3071
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function login(page, email, password) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.locator('form button[type="submit"]').first().click();
	await page.waitForURL(/\/(admin|switch)/, { timeout: 15_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) federated stage 1: 確認コード送信前 (送信ボタンが出る・パスワード欄なし) ---
	await login(page, 'google-owner@example.com', 'Gq!Dev#Goog2026xy');
	await page.goto(`${BASE_URL}/auth/reset-pin`);
	await page.getByTestId('pin-reset-verified-form').waitFor({ state: 'visible', timeout: 15_000 });
	await page
		.getByTestId('pin-reset-verified-send-code')
		.waitFor({ state: 'visible', timeout: 10_000 });
	await capture('issue-3070-reset-pin-federated-stage1-send-code');

	// --- 2) password ユーザの reset 画面 (現状維持、email-OTP 分岐は federated のみ) ---
	await page.context().clearCookies();
	await login(page, 'owner@example.com', 'Gq!Dev#Owner2026x');
	await page.goto(`${BASE_URL}/auth/reset-pin`);
	await page.getByTestId('pin-reset-verified-form').waitFor({ state: 'visible', timeout: 15_000 });
	await page
		.getByTestId('pin-reset-verified-password')
		.waitFor({ state: 'visible', timeout: 10_000 });
	await capture('issue-3070-reset-pin-password-unchanged');
};
