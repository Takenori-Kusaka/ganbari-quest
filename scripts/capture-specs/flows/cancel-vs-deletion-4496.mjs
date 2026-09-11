/**
 * scripts/capture-specs/flows/cancel-vs-deletion-4496.mjs (#4496)
 *
 * 解約 / 退会の概念分離でアプリ側の文言が変わる 2 画面を撮影する。
 *   - /admin/subscription/cancel      … 解約確認画面。手続き **前** に「期末まで利用可能 /
 *                                       日割り返金なし」を述べる notice (paidPlanNotice /
 *                                       freePlanNotice) を差し替えた
 *   - /admin/settings/account         … 退会 Danger Zone。プラン別の削除猶予を手続き前に
 *                                       述べる notice (accountDeleteGraceNotice) を追加した
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr <N> \
 *     --flow cancel-vs-deletion-4496 \
 *     --url /admin/subscription/cancel \
 *     --actions scripts/capture-specs/flows/cancel-vs-deletion-4496.mjs \
 *     --server-mode cognito --presets desktop,mobile
 *
 * 注: notice の出し分けは `data.isPaidPlan` に従うが、その実体は
 * `!!license?.stripeSubscriptionId` (cancel/+page.server.ts) である。ローカルの DEV_USERS は
 * Stripe subscription を持たないため、プラン badge が「スタンダードプラン」(= license.plan)
 * を表示していても `isPaidPlan` は false になり、撮れるのは **freePlanNotice 側**である。
 * 有料プラン文言 (paidPlanNotice) は unit test
 * (tests/unit/domain/cancel-vs-deletion-terminology.test.ts) が担保する。
 *
 * この plan badge と notice の不一致 (同一 load が plan=standard と isPaidPlan=false を同時に
 * 返す) は本 flow の撮影結果にもそのまま現れる。本 PR 以前からある挙動で、Stripe 未連携の
 * 有料プラン tenant では本番でも起こりうるため、別 Issue で追う。
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

/** cognito-dev のログインフォームを通す (cancel-period-end-3991.mjs と同型) */
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

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAsOwner(page);

	// 1. 解約確認画面 (手続き前の notice)
	await page.goto(`${BASE_URL}/admin/subscription/cancel`, { waitUntil: 'domcontentloaded' });
	await page
		.getByTestId('cancellation-form')
		.waitFor({ state: 'visible', timeout: 30_000 })
		.catch(() => {});
	await capture('cancel-confirm-notice');

	// 2. 退会 Danger Zone (プラン別猶予の事前説明)
	await page.goto(`${BASE_URL}/admin/settings/account`, { waitUntil: 'domcontentloaded' });
	await page
		.getByTestId('account-danger-zone')
		.waitFor({ state: 'visible', timeout: 30_000 })
		.catch(() => {});
	await page
		.getByTestId('account-danger-zone')
		.scrollIntoViewIfNeeded()
		.catch(() => {});
	await capture('account-delete-grace-notice');
};
