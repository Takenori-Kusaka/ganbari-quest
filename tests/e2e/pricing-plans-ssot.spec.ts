// tests/e2e/pricing-plans-ssot.spec.ts
// #765: /pricing の plans 配列が SSOT を参照し、プラン名・価格・CTA 文言が
// ハードコードされていないことを確認する。
//
// 補足: #792 の features 棚卸しは pricing-features.spec.ts でカバー済み。
// こちらはメタ情報（名前・価格・CTA・バッジ）と #749 ブランドガイドライン準拠を検証。

import { expect, test } from '@playwright/test';

test.describe('#765 /pricing プランメタ情報 SSOT', () => {
	test.beforeEach(async ({ page }) => {
		test.slow();
		await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
	});

	test('3 プランカードが表示順で並ぶ（free → standard → family）', async ({ page }) => {
		const cards = page.getByTestId('pricing-plan-card');
		await expect(cards).toHaveCount(3);
		await expect(cards.nth(0)).toHaveAttribute('data-plan', 'free');
		await expect(cards.nth(1)).toHaveAttribute('data-plan', 'standard');
		await expect(cards.nth(2)).toHaveAttribute('data-plan', 'family');
	});

	test('プラン名は #749 §7.1 ブランド表記（フリー / スタンダード / ファミリー）', async ({
		page,
	}) => {
		const names = page.getByTestId('pricing-plan-name');
		await expect(names.nth(0)).toHaveText('フリー');
		await expect(names.nth(1)).toHaveText('スタンダード');
		await expect(names.nth(2)).toHaveText('ファミリー');
	});

	test('価格表記は半角 ¥（#749 §7.2）', async ({ page }) => {
		const prices = page.getByTestId('pricing-plan-price');
		await expect(prices.nth(0)).toHaveText('¥0');
		await expect(prices.nth(1)).toHaveText('¥500');
		await expect(prices.nth(2)).toHaveText('¥780');

		// 全角 ￥ は画面上どこにも出ない
		const body = await page.locator('body').textContent();
		expect(body).not.toMatch(/￥/);
	});

	test('年額表記は standard / family にのみ表示される', async ({ page }) => {
		const standardCard = page.locator('[data-plan="standard"]');
		const familyCard = page.locator('[data-plan="family"]');
		const freeCard = page.locator('[data-plan="free"]');

		await expect(standardCard.getByTestId('pricing-yearly-price')).toContainText('年額 ¥5,000');
		await expect(familyCard.getByTestId('pricing-yearly-price')).toContainText('年額 ¥7,800');
		// free には yearly-price 要素が存在しない
		await expect(freeCard.getByTestId('pricing-yearly-price')).toHaveCount(0);
	});

	test('おすすめバッジは standard のみに表示される（#749 §7.4）', async ({ page }) => {
		const badges = page.getByTestId('pricing-badge');
		await expect(badges).toHaveCount(1);
		await expect(badges.first()).toHaveText('おすすめ');

		const standardCard = page.locator('[data-plan="standard"]');
		await expect(standardCard.getByTestId('pricing-badge')).toBeVisible();
	});

	test('CTA 文言は「無料体験」統一、「トライアル」「お試し」を含まない（#749 §7.3）', async ({
		page,
	}) => {
		const freeCta = page.locator('[data-plan="free"]').getByTestId('pricing-cta');
		const standardCta = page.locator('[data-plan="standard"]').getByTestId('pricing-cta');
		const familyCta = page.locator('[data-plan="family"]').getByTestId('pricing-cta');

		await expect(freeCta).toHaveText('無料ではじめる');
		await expect(standardCta).toHaveText('7日間 無料体験');
		await expect(familyCta).toHaveText('7日間 無料体験');

		// CTA href
		await expect(freeCta).toHaveAttribute('href', '/auth/signup');
		await expect(standardCta).toHaveAttribute('href', '/auth/signup?plan=standard');
		await expect(familyCta).toHaveAttribute('href', '/auth/signup?plan=family');
	});

	test('ページ全体に「無料トライアル」などの禁止用語が含まれない（#749 §7.3）', async ({
		page,
	}) => {
		const body = await page.locator('body').textContent();
		// #749 で禁止された用語
		expect(body).not.toMatch(/無料トライアル/);
		expect(body).not.toMatch(/お試し期間/);
		expect(body).not.toMatch(/おためし/);
		// 「無料体験」は含まれている
		expect(body).toMatch(/無料体験/);
	});
});
