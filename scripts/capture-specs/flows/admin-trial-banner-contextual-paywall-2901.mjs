/**
 * scripts/capture-specs/flows/admin-trial-banner-contextual-paywall-2901.mjs
 *
 * #2901 AC2 (contextual paywall): free / trial 未使用ユーザーの admin ホームで
 * TrialBanner (not-started) が「全機能無料」だけでなく「無料版で制限される機能」を
 * 機能名込みで列挙する (PO 指摘 #4) ことを SS で確認する。
 *
 * 前提: dev:cognito サーバ (port 5174) を
 *   DEBUG_PLAN=free DEBUG_TRIAL=not-started AUTH_MODE=cognito COGNITO_DEV_MODE=true
 * で起動し、free dev user (free@example.com) でログインする。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5174 node scripts/capture.mjs \
 *     --flow admin-trial-banner-contextual-paywall-2901 \
 *     --url /auth/login \
 *     --actions scripts/capture-specs/flows/admin-trial-banner-contextual-paywall-2901.mjs \
 *     --presets desktop,mobile --pr 2901
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const FREE_EMAIL = 'free@example.com';
const FREE_PASSWORD = 'Gq!Dev#Free2026xy';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) free dev user でログイン ---
	await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' });
	await page
		.getByLabel(/メール|email/i)
		.first()
		.fill(FREE_EMAIL);
	await page
		.getByLabel(/パスワード|password/i)
		.first()
		.fill(FREE_PASSWORD);
	await Promise.all([
		page.waitForURL(/\/admin/, { timeout: 30_000 }).catch(() => {}),
		page
			.getByRole('button', { name: /ログイン|サインイン|signin|login/i })
			.first()
			.click(),
	]);

	// --- 2) admin ホームへ遷移し TrialBanner (not-started) を待つ ---
	await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
	const banner = page.getByTestId('trial-banner-not-started');
	await banner.waitFor({ state: 'visible', timeout: 30_000 });
	const gated = page.getByTestId('trial-banner-gated-features');
	await gated.waitFor({ state: 'visible', timeout: 10_000 });
	await gated.scrollIntoViewIfNeeded();

	// --- 3) contextual paywall (制限機能の列挙) を含む banner を撮影 ---
	await capture('2901-trial-banner-contextual-paywall');
};
