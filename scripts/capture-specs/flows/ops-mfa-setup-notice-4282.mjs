/**
 * scripts/capture-specs/flows/ops-mfa-setup-notice-4282.mjs (#4282)
 *
 * `ops` group に居るが MFA 未設定の運営者が `/ops` を開いたときの画面を撮る。
 * 2 度実行して before / after を作る（`SS_PHASE` で切り替える）:
 *
 *   SS_PHASE=before … `+error.svelte` の分岐を無効化した状態で撮る = 本 PR 前の描画
 *                     （汎用 403「アクセスが きょか されていません」+「ログインし直す」。
 *                     押しても同じ 403 に戻るだけで復旧できない）
 *   SS_PHASE=after  … 本 PR の描画（`OpsMfaSetupNotice` = 設定手順 + 出口 + 依頼先）。
 *                     あわせて MFA 済 ops が従来どおり `/ops` に入れることも撮る（回帰確認）
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例（起動済みサーバーに向ける）:
 *   SS_PHASE=after BASE_URL=http://localhost:5194 node scripts/capture.mjs --pr 4282 \
 *     --flow ops-mfa-setup-notice \
 *     --url /ops \
 *     --actions scripts/capture-specs/flows/ops-mfa-setup-notice-4282.mjs \
 *     --presets desktop,mobile
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/** cognito-dev のログインフォームを通す (cancel-period-end-3991.mjs と同型) */
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
	// ops group に居るが MFA 未設定の運営者 (dev SSOT: DEV_USERS)
	await login(page, 'ops-no-mfa@example.com', devPassword('ops-no-mfa@example.com'));
	await page.goto(`${BASE_URL}/ops`);
	await page.waitForLoadState('domcontentloaded');

	if (PHASE === 'before') {
		await page.locator('.error-page').waitFor({ state: 'visible', timeout: 15_000 });
		await capture('before-ops-mfa-denied');
		return;
	}

	await page.getByTestId('ops-mfa-setup-notice').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('after-ops-mfa-denied');

	// 回帰: MFA 済 ops は従来どおり /ops に入れる (締めすぎて運用が止まっていないこと)
	await login(page, 'ops@example.com', devPassword('ops@example.com'));
	await page.goto(`${BASE_URL}/ops`);
	await page.waitForLoadState('domcontentloaded');
	await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('ops-with-mfa-still-allowed');
};
