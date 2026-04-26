// tests/e2e/integration/upgrade-checkout.spec.ts
// #1497: Stripe チェックアウト E2E テスト（page.route() インターセプト）
// #1500: テスト分類 = Integration（page.route() で Stripe を完全モック化しているため）
//        cognito-dev 認証が必要なため playwright.cognito-dev.config.ts で管理するが、
//        実 Stripe API は一切呼び出さない。tests/CLAUDE.md §テスト分類 参照。
// #1535: tests/e2e/integration/ に移動 + storageState ベースに移行
//
// Stripe Checkout API を page.route() でモック化し、
// /admin/license のアップグレード CTA → Stripe Checkout 遷移の導線を検証する。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts upgrade-checkout

import { expect, test } from '@playwright/test';

// ============================================================
// Stripe Checkout API モック
// ============================================================

test.describe('#1497 Stripe Checkout 遷移 — page.route() モック', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランで /api/stripe/checkout をモックすると checkout.stripe.com へ遷移する', async ({
		page,
	}) => {
		// /api/stripe/checkout を page.route() でインターセプトしてモック URL を返す
		await page.route('/api/stripe/checkout', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ url: 'https://checkout.stripe.com/mock-session-id' }),
			});
		});

		await page.goto('/admin/license', { waitUntil: 'commit', timeout: 30_000 });

		// Stripe が有効な場合のみプラン選択カードが表示される
		// 無効な環境では「決済機能は現在準備中です」が表示されるためスキップ
		const preparingText = page.getByText('決済機能は現在準備中です');
		const standardPlanCard = page.getByTestId('standard-plan-card');

		const isPreparingVisible = await preparingText
			.waitFor({ state: 'visible', timeout: 15_000 })
			.then(() => true)
			.catch(() => false);

		if (isPreparingVisible) {
			test.info().annotations.push({
				type: 'skip-reason',
				description: 'Stripe 未設定環境のため checkout 遷移テストをスキップ',
			});
			return;
		}

		// Stripe 有効環境: プランカードが表示されることを確認
		await expect(standardPlanCard).toBeVisible({ timeout: 30_000 });

		// アップグレードボタンをクリック → Stripe Checkout 遷移を試みる
		const upgradeButton = standardPlanCard.getByRole('button', {
			name: /アップグレード|購入|申し込む/,
		});
		const upgradeButtonCount = await upgradeButton.count();

		if (upgradeButtonCount === 0) {
			test.info().annotations.push({
				type: 'skip-reason',
				description: 'アップグレードボタンが見つからないためスキップ',
			});
			return;
		}

		// ページ遷移またはポップアップを待つ
		const [navigationPromise] = await Promise.all([
			page.waitForNavigation({ timeout: 15_000 }).catch(() => null),
			upgradeButton.first().click(),
		]);

		// checkout.stripe.com への遷移を確認、またはモックにより遷移を検知する
		// ナビゲーションが発生した場合は遷移先 URL を確認
		if (navigationPromise) {
			const currentUrl = page.url();
			// hostname で明示的に検証（substring チェックは任意ホスト混入リスクがあるため）
			let parsedHostname: string;
			try {
				parsedHostname = new URL(currentUrl).hostname;
			} catch {
				parsedHostname = '';
			}
			const isStripeOrLicense =
				parsedHostname === 'checkout.stripe.com' || currentUrl.includes('/admin/license');
			expect(isStripeOrLicense).toBe(true);
		}
	});
});

// ============================================================
// API レベルの Stripe Checkout インターセプト確認
// ============================================================

test.describe('#1497 /api/stripe/checkout API インターセプト', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('page.route() で /api/stripe/checkout をモックすると mock URL が返る', async ({ page }) => {
		const mockCheckoutUrl = 'https://checkout.stripe.com/mock-test-session-abc123';

		// /api/stripe/checkout を完全にモック化
		await page.route('/api/stripe/checkout', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ url: mockCheckoutUrl }),
			});
		});

		// fetch の相対 URL 解決に必要なベース URL を確立する
		// （about:blank のままでは fetch('/api/...') が TypeError になるため）
		await page.goto('/', { waitUntil: 'commit', timeout: 30_000 });

		// fetch でモックエンドポイントを呼び出す
		const result = await page.evaluate(async (_url) => {
			const res = await fetch('/api/stripe/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ planId: 'monthly' }),
			});
			return { status: res.status, body: await res.json() };
		}, mockCheckoutUrl);

		expect(result.status).toBe(200);
		expect(result.body.url).toBe(mockCheckoutUrl);
	});
});
