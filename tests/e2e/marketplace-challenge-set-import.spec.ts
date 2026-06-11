/**
 * #2896: marketplace を活動 / ごほうび / チェックリストの 3 type に絞った後の
 * challenge-set 非陳列 回帰テスト
 *
 * 旧 #2297 では challenge-set (japan-annual-events) が marketplace に陳列され取込できることを
 * 検証していたが、2026-06-11 PO 判断で marketplace を 3 type に絞り、唯一の challenge-set preset を
 * 廃止した。本 spec は以下の「陳列されない」ことを assert する:
 *
 * 1. /marketplace の type filter に challenge-set / rule-preset が出ない (活動 / ごほうび / チェックリストのみ)
 * 2. ?type=challenge-set を指定しても陳列対象外として無視され、3 type の全件が表示される
 * 3. 廃止 preset の詳細ページ /marketplace/challenge-set/japan-annual-events は 404
 *
 * 認証: 公開ルート (marketplace は未認証でも閲覧可能)
 */

import { expect, test } from '@playwright/test';

test.describe('#2896 marketplace 3 type 化 — challenge-set / rule-preset 非陳列', () => {
	test.setTimeout(120_000);

	test('/marketplace の type filter は活動 / ごほうび / チェックリストの 3 type のみ', async ({
		page,
	}) => {
		const res = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);

		// 陳列対象 3 type は表示される
		await expect(page.getByTestId('filter-type-activity-pack')).toBeVisible();
		await expect(page.getByTestId('filter-type-reward-set')).toBeVisible();
		await expect(page.getByTestId('filter-type-checklist')).toBeVisible();

		// 陳列対象外 2 type は表示されない (#2896)
		await expect(page.getByTestId('filter-type-challenge-set')).toHaveCount(0);
		await expect(page.getByTestId('filter-type-rule-preset')).toHaveCount(0);
	});

	test('?type=challenge-set を指定しても challenge-set は陳列されない (陳列外 filter は無視)', async ({
		page,
	}) => {
		await page.goto('/marketplace?type=challenge-set', { waitUntil: 'domcontentloaded' });

		// 陳列外 type filter は無視され、3 type の全件が表示される (0 件 empty にはならない)。
		const resultCount = page.getByTestId('result-count');
		await expect(resultCount).toBeVisible();
		await expect(resultCount).toContainText(/\d+件/);

		// challenge-set type card は存在しない
		await expect(page.getByTestId('filter-type-challenge-set')).toHaveCount(0);

		// 一覧カードに challenge-set への詳細リンクが出ないこと
		await expect(page.locator('a[href^="/marketplace/challenge-set/"]')).toHaveCount(0);
	});

	test('廃止 preset の詳細ページ /marketplace/challenge-set/japan-annual-events は 404', async ({
		page,
	}) => {
		const res = await page.goto('/marketplace/challenge-set/japan-annual-events', {
			waitUntil: 'domcontentloaded',
		});
		// preset 廃止により getMarketplaceItem が null → 404。
		expect(res?.status()).toBe(404);
	});
});
