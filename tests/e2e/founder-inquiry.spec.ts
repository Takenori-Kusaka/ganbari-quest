// tests/e2e/founder-inquiry.spec.ts
// #1594 ADR-0023 I8: founder 1:1 ヒアリング動線
//
// /inquiry/founder ページでフォーム送信〜成功表示までを検証する。
// Discord webhook 送信は server 側 API endpoint を route intercept でモックする。

import { expect, test } from '@playwright/test';

test.describe('#1594 founder 直接相談 (/inquiry/founder)', () => {
	test('ページが表示され、必須フォーム要素が存在する', async ({ page }) => {
		await page.goto('/inquiry/founder', { waitUntil: 'domcontentloaded' });

		await expect(page.getByRole('heading', { name: /開発者に直接相談/ })).toBeVisible();
		await expect(page.getByTestId('founder-inquiry-form')).toBeVisible();
		await expect(page.getByTestId('founder-inquiry-name')).toBeVisible();
		await expect(page.getByTestId('founder-inquiry-email')).toBeVisible();
		await expect(page.getByTestId('founder-inquiry-message')).toBeVisible();
		await expect(page.getByTestId('founder-inquiry-submit')).toBeVisible();
	});

	test('mailto fallback リンクが表示される', async ({ page }) => {
		await page.goto('/inquiry/founder', { waitUntil: 'domcontentloaded' });
		const mailto = page.getByTestId('founder-inquiry-mailto');
		await expect(mailto).toBeVisible();
		const href = await mailto.getAttribute('href');
		expect(href).toMatch(/^mailto:/);
		expect(href).toContain('ganbari.quest.support@gmail.com');
	});

	test('必須項目未入力で submit するとブラウザバリデーションが走る', async ({ page }) => {
		await page.goto('/inquiry/founder', { waitUntil: 'domcontentloaded' });

		await page.getByTestId('founder-inquiry-submit').click();

		// HTML5 required により submit がブロックされ、フォームはまだ表示されているはず
		await expect(page.getByTestId('founder-inquiry-form')).toBeVisible();
	});

	test('フォーム送信成功時に Alert success が表示される (POST 成功モック)', async ({ page }) => {
		// SvelteKit form action の POST レスポンスを横取りして success を返す。
		// progressive enhancement (use:enhance) は __data.json で response を受け取るため、
		// それを fulfill する。
		await page.route('**/inquiry/founder?/**', async (route, request) => {
			if (request.method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						type: 'success',
						status: 200,
						data: '[{"success":true},true]',
					}),
				});
				return;
			}
			await route.continue();
		});

		await page.goto('/inquiry/founder', { waitUntil: 'domcontentloaded' });

		await page.getByTestId('founder-inquiry-name').fill('山田 太郎');
		await page.getByTestId('founder-inquiry-email').fill('parent@example.com');
		await page.getByTestId('founder-inquiry-message').fill('導入前に相談させてください');

		await page.getByTestId('founder-inquiry-submit').click();

		await expect(page.getByTestId('founder-inquiry-success')).toBeVisible({ timeout: 5000 });
	});

	test('admin/settings/support の統合フォームに「相談・困りごと」用件が存在する', async ({
		page,
	}) => {
		// E2E は AUTH_MODE=local 前提。`admin-settings-export-gate.spec.ts` 等と同じ想定で
		// 直接アクセスし、認証は通る前提で進める（ローカルでは plan-limit-service の
		// 早期 return で family プラン相当となり 200 OK で返る）。
		// #support-unify: 旧 founder CTA カード (admin-founder-inquiry-cta) は廃止し、
		// 「開発者に直接相談」の用件は統合サポートフォームの「相談・困りごと」intent に集約。
		// 独立ページ /inquiry/founder は LP / ライセンス導線から到達するため存続 (上記テスト群で担保)。
		test.slow(); // Vite dev コールドコンパイル
		await page.goto('/admin/settings/support', { waitUntil: 'domcontentloaded' });

		// PremiumWelcome dialog が出ることがあるので閉じる
		const welcomeBtn = page.getByRole('button', { name: /さっそく始める/ });
		if (await welcomeBtn.isVisible().catch(() => false)) {
			await welcomeBtn.click();
		}

		await expect(page.locator('[data-tutorial="feedback-section"]')).toBeVisible();
		await expect(page.getByRole('radio', { name: /相談・困りごと/ })).toBeVisible();
	});
});
