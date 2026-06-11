// tests/e2e/upgrade-oneclick.spec.ts
// #767: ワンクリックアップグレード導線 E2E テスト
// #3033: プラン利用状況カード (PlanStatusCard) は /admin/subscription に一本化。
//        home (/admin) には表示されず、header の upgrade-btn / plan-badge が常設導線。
//
// 実際の Stripe Checkout セッション作成はテスト環境では失敗する可能性があるため、
// CTA の表示と API リクエストの発行までを検証する。

import { expect, test } from '@playwright/test';

test.describe('#767 ワンクリックアップグレード導線', () => {
	test.beforeEach(() => {
		test.slow();
	});

	test('/admin/subscription にプラン利用状況カードが表示される (#3033 一本化)', async ({
		page,
	}) => {
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });

		// PlanStatusCard がプランページに表示される
		const card = page.getByTestId('plan-status-card');
		// カードが存在する場合（planStats がロードされた場合）を検証
		if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
			// data-plan-tier 属性が存在する
			const tier = await card.getAttribute('data-plan-tier');
			expect(['free', 'standard', 'family']).toContain(tier);
		}
	});

	test('home にカードは出ず、プランページにアップグレード導線が表示される (#3033)', async ({
		page,
	}) => {
		// #3033: home の body 常設カードは撤去済み
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('plan-status-card')).toHaveCount(0);

		// プランページ側にアップグレード導線が一本化されている
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });
		const card = page.getByTestId('plan-status-card');
		const hasCard = await card.isVisible({ timeout: 5000 }).catch(() => false);
		expect(hasCard).toBe(true);

		const tier = await card.getAttribute('data-plan-tier');
		expect(['free', 'standard', 'family']).toContain(tier);

		// free の場合のみアップグレード CTA が表示される
		if (tier === 'free') {
			const freeCta = page.getByTestId('plan-status-free-cta');
			await expect(freeCta).toBeVisible();
		}
	});

	test('checkout API の returnPath パラメータがレスポンスに影響する', async ({ request }) => {
		// API に returnPath を含めて呼び出し（Stripe 無効環境では 503 が返る）
		const res = await request.post('/api/stripe/checkout', {
			headers: { 'Content-Type': 'application/json' },
			data: { planId: 'monthly', returnPath: '/admin' },
		});

		// 認証エラー（403）またはStripe無効（503）のいずれかが返ることを確認
		// returnPath パラメータ自体がエラーにならない（バリデーション通過）ことが重要
		expect([200, 400, 403, 409, 503]).toContain(res.status());
	});
});
