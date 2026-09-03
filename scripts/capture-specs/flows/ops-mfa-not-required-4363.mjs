/**
 * scripts/capture-specs/flows/ops-mfa-not-required-4363.mjs (#4363)
 *
 * MFA を設定していない運営者 (`ops` group 所属) が `/ops` を開いたときの画面を撮る。
 * 2 度実行して before / after を作る (`SS_PHASE` で切り替える):
 *
 *   SS_PHASE=before … `capabilities.ts` の `OPS_MFA_REQUIRED` を `true` にした状態
 *                     = **本 PR 前 (#4266) の挙動**。403 になり設定導線 (#4282) に着地する
 *   SS_PHASE=after  … 本 PR の状態 (`OPS_MFA_REQUIRED = false`)。
 *                     同じアカウント・同じ URL で運営ダッシュボードが開く
 *
 * どちらも同一アカウント (`ops-no-mfa@example.com`) / 同一 URL (`/ops`) で撮り分ける。
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例 (起動済みサーバーに向ける):
 *   SS_PHASE=after BASE_URL=http://localhost:5194 node scripts/capture.mjs --pr 4368 \
 *     --flow ops-mfa-not-required \
 *     --url /ops \
 *     --actions scripts/capture-specs/flows/ops-mfa-not-required-4363.mjs \
 *     --presets desktop,mobile
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/** cognito-dev のログインフォームを通す (ops-mfa-setup-notice-4282.mjs と同型) */
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
		// OPS_MFA_REQUIRED = true (= #4266 の挙動) で 403 → 設定導線に着地する
		await page.getByTestId('ops-mfa-setup-notice').waitFor({ state: 'visible', timeout: 15_000 });
		await capture('before-ops-no-mfa-denied');
		return;
	}

	// 本 PR: 同じアカウントで運営ダッシュボードが開く
	await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('after-ops-no-mfa-allowed');

	// 回帰: MFA 済 ops も従来どおり入れる (緩めた側で壊していないこと)
	await login(page, 'ops@example.com', devPassword('ops@example.com'));
	await page.goto(`${BASE_URL}/ops`);
	await page.waitForLoadState('domcontentloaded');
	await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('ops-with-mfa-still-allowed');
};
