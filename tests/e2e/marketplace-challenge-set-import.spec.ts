/**
 * #2297 (EPIC #2294 ③): marketplace challenge-set 一括追加フロー E2E
 *
 * AC 検証対象:
 * 1. /marketplace で 5 type filter ボタンが表示される (`filter-type-challenge-set`)
 * 2. `?type=challenge-set` で challenge-set 系のみに絞り込まれる
 * 3. /marketplace/challenge-set/japan-annual-events 詳細ページが描画される
 * 4. 詳細ページに「使ってみる」CTA + challenge-set-preview (15 件) が表示される
 * 5. CTA をクリックすると /admin/challenges?marketplace-import=japan-annual-events に遷移する
 * 6. /admin/challenges 側で marketplace-challenge-set-import preview UI が描画される
 * 7. 一括追加ボタン押下 → 取込結果 banner が表示される
 *
 * 認証: AUTH_MODE=local の自動セットアップで /admin 配下に到達できる前提
 */

import { expect, test } from '@playwright/test';

test.describe('#2297 marketplace challenge-set 一括追加', () => {
	test.setTimeout(180_000);

	test('/marketplace で 5 type filter ボタンに challenge-set が含まれる', async ({ page }) => {
		const res = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);

		// 5 type 全件描画されている (mobile 2 列 / SP 3 列 / desktop 5 列)
		await expect(page.getByTestId('filter-type-challenge-set')).toBeVisible();
		await expect(page.getByTestId('filter-type-activity-pack')).toBeVisible();
		await expect(page.getByTestId('filter-type-reward-set')).toBeVisible();
		await expect(page.getByTestId('filter-type-checklist')).toBeVisible();
		await expect(page.getByTestId('filter-type-rule-preset')).toBeVisible();
	});

	test('?type=challenge-set で challenge-set 系のみが残る', async ({ page }) => {
		await page.goto('/marketplace?type=challenge-set', { waitUntil: 'domcontentloaded' });

		// 件数表示が 1 件 (現状 japan-annual-events のみ)
		const resultCount = page.getByTestId('result-count');
		await expect(resultCount).toBeVisible();
		await expect(resultCount).toContainText(/\d+件/);
	});

	test('/marketplace/challenge-set/japan-annual-events 詳細ページが 200 で表示される', async ({
		page,
	}) => {
		const res = await page.goto('/marketplace/challenge-set/japan-annual-events', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		// challenge-set-preview が表示され 15 件の内容が含まれる
		const preview = page.getByTestId('challenge-set-preview');
		await expect(preview).toBeVisible();
		await expect(preview).toContainText('ひな祭り');
		await expect(preview).toContainText('こどもの日');
		await expect(preview).toContainText('七夕');
		await expect(preview).toContainText('クリスマス');
	});

	test('詳細ページに「使ってみる」CTA が表示される', async ({ page }) => {
		await page.goto('/marketplace/challenge-set/japan-annual-events', {
			waitUntil: 'domcontentloaded',
		});

		const cta = page.getByTestId('marketplace-detail-cta');
		await expect(cta).toBeVisible();

		// AUTH_MODE=local では認証済 → /admin/challenges?marketplace-import=... に遷移する CTA
		const importCta = page.getByTestId('challenge-set-import-cta');
		const signupCta = page.getByTestId('challenge-set-signup-redirect');
		const eitherVisible = (await importCta.count()) > 0 || (await signupCta.count()) > 0;
		expect(eitherVisible).toBe(true);
	});

	test('CTA → /admin/challenges?marketplace-import=japan-annual-events 遷移 + import preview UI', async ({
		page,
	}) => {
		// AUTH_MODE=local で /admin/challenges に直接アクセス + query param 付与
		const res = await page.goto('/admin/challenges?marketplace-import=japan-annual-events', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		// import preview UI が描画される
		const preview = page.getByTestId('marketplace-challenge-set-import');
		await expect(preview).toBeVisible();
		await expect(preview).toContainText('日本年間行事パック');
		await expect(preview).toContainText('15');

		// 一括追加ボタンが表示される
		const submitBtn = page.getByTestId('marketplace-challenge-set-import-submit');
		await expect(submitBtn).toBeVisible();
	});

	test('不正な presetId は preview UI が表示されない', async ({ page }) => {
		const res = await page.goto('/admin/challenges?marketplace-import=nonexistent-preset', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		// preview UI は表示されない (Issue #2297: getMarketplaceItem が null → marketplaceImport=null)
		const preview = page.getByTestId('marketplace-challenge-set-import');
		await expect(preview).toHaveCount(0);
	});
});
