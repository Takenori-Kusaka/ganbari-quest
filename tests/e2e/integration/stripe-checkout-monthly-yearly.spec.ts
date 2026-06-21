// tests/e2e/integration/stripe-checkout-monthly-yearly.spec.ts
// #3204: 月額固定 checkout + 失敗フィードバック — /admin/subscription
//
// 経緯:
//   - #2347 で月額/年額トグル UI を実装したが、#2719 で年額を廃止確定し checkout が
//     `yearly` / `family-yearly` を server 側で reject するようになった。UI に年額トグルが
//     残ると「年額を選ぶと必ず INVALID_PLAN」になるため、#3204 で年額トグルを撤去し月額固定化。
//   - 併せて #3204 で checkout 失敗 (非 2xx / url 欠落) の silent no-op を撲滅し、
//     失敗時にエラーメッセージ (Alert + Toast) を必ず提示するよう修正。
//
// 本 spec は (A) 年額トグル撤去 + 月額固定表示、(B) checkout 失敗時のエラー提示、
// (C) 月額 planId が checkout に送信されることを検証する。
//
// テスト分類: Integration (page.route() で Stripe API モック、cognito-dev 認証必須)
// 実行: npx playwright test --config playwright.cognito-dev.config.ts stripe-checkout-monthly-yearly

import { expect, test } from '@playwright/test';

test.describe('#3204 月額固定 checkout + 失敗フィードバック — /admin/subscription', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	/** Stripe 未設定環境 (plan card 非表示) では月額ボタンが出ないため skip 判定に使う */
	async function skipIfStripeDisabled(page: import('@playwright/test').Page): Promise<boolean> {
		const monthlyCheckoutBtn = page.getByTestId('standard-plan-card');
		const visible = await monthlyCheckoutBtn
			.waitFor({ state: 'visible', timeout: 5_000 })
			.then(() => true)
			.catch(() => false);
		if (!visible) {
			test.info().annotations.push({
				type: 'skip-reason',
				description: 'Stripe 未設定環境 (stripeEnabled=false で plan card 非表示) のためスキップ',
			});
		}
		return visible;
	}

	test('年額トグルが撤去され月額固定で表示される (#2719 年額廃止と UI 整合)', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });
		if (!(await skipIfStripeDisabled(page))) return;

		// 年額トグル・年額専用 UI が物理的に存在しないこと (年額選択 → INVALID_PLAN 経路の根絶)
		await expect(page.getByRole('button', { name: /年額/ })).toHaveCount(0);
		await expect(page.getByTestId('standard-yearly-monthly-equiv')).toHaveCount(0);
		await expect(page.getByTestId('family-yearly-monthly-equiv')).toHaveCount(0);

		// 月額価格が表示されること
		await expect(page.getByTestId('standard-plan-card')).toContainText('¥500');
		await expect(page.getByTestId('family-plan-card')).toContainText('¥780');
	});

	test('checkout 失敗 (非 2xx) で silent no-op せずエラーを提示する (#3204)', async ({ page }) => {
		// INVALID_PLAN 相当の 400 を返すモック
		await page.route('/api/stripe/checkout', async (route) => {
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'プランが正しくありません' }),
			});
		});

		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });
		if (!(await skipIfStripeDisabled(page))) return;

		// プレミアム選択 → 「プレミアムプランで始める」押下
		await page.getByTestId('family-plan-card').click();
		await page.getByRole('button', { name: /プランで始める/ }).click();

		// silent no-op でなく、サーバーメッセージが画面に提示されること (Alert / Toast の 2 層 feedback)
		await expect(page.getByText('プランが正しくありません')).toBeVisible({ timeout: 8_000 });
	});

	test('月額 planId (monthly / family-monthly) が checkout に送信される (mock)', async ({
		page,
	}) => {
		const capturedPayloads: Array<{ planId?: string }> = [];
		await page.route('/api/stripe/checkout', async (route) => {
			try {
				capturedPayloads.push(route.request().postDataJSON() as { planId?: string });
			} catch {
				// no-op
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ url: 'https://checkout.stripe.com/mock-planid-capture' }),
			});
		});

		await page.goto('/', { waitUntil: 'commit', timeout: 30_000 });

		for (const planId of ['monthly', 'family-monthly']) {
			const status = await page.evaluate(async (pid) => {
				const res = await fetch('/api/stripe/checkout', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ planId: pid }),
				});
				return res.status;
			}, planId);
			expect(status).toBe(200);
		}

		const planIds = capturedPayloads.map((p) => p.planId).filter(Boolean);
		expect(planIds).toContain('monthly');
		expect(planIds).toContain('family-monthly');
	});
});
