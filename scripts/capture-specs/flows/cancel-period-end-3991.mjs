/**
 * scripts/capture-specs/flows/cancel-period-end-3991.mjs (#3991 / #3986)
 *
 * 期末解約 (cancel_at_period_end) 対応で見た目が変わる 2 画面を撮影する。
 *   - /admin/subscription  … 解約手続き中バナー + 「ご利用いただける最終日」行を追加した画面
 *   - /admin/settings      … grace_period バナー (支払い確認) の文言 + CTA を差し替えた hub
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr 4096 \
 *     --flow cancel-period-end \
 *     --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/cancel-period-end-3991.mjs \
 *     --server-mode cognito --presets desktop,mobile
 *
 * 注: 解約手続き中バナー自体は Stripe 上に `cancel_at_period_end=true` の subscription が
 * 存在するときだけ描画される。local backend は `STRIPE_SECRET_KEY` を持たないため
 * `getCancellationState()` が必ず null を返し、**ローカルでは表示状態を再現できない**
 * (docs/CLAUDE.md §「local 検証不可」と同型)。本フローは「バナー非表示時の回帰なし」を担保する。
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

/** cognito-dev のログインフォームを通す (billing-graduation.mjs と同型) */
async function loginAsOwner(page) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type('owner@example.com', { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type(devPassword('owner@example.com'), { delay: 20 });

	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/** 初回 welcome overlay / ページガイドが被る場合は閉じる */
async function dismissOverlays(page) {
	const welcome = page.locator('.welcome-overlay');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) {
		await welcome
			.locator('.welcome-cta')
			.click()
			.catch(() => {});
		await welcome.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAsOwner(page);

	await page.goto(`${BASE_URL}/admin/subscription`);
	await page.waitForLoadState('domcontentloaded');
	await dismissOverlays(page);
	await page.getByTestId('saas-license-panel').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('admin-subscription');

	await page.goto(`${BASE_URL}/admin/settings`);
	await page.waitForLoadState('domcontentloaded');
	await dismissOverlays(page);
	await page
		.locator('[data-tutorial="settings-hub-intro"]')
		.waitFor({ state: 'visible', timeout: 15_000 });
	await capture('admin-settings-hub');
};
