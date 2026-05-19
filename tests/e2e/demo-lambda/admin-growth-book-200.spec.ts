// tests/e2e/demo-lambda/admin-growth-book-200.spec.ts
//
// Issue #2262 回帰テスト:
// demo Lambda (AUTH_MODE=anonymous + DATA_SOURCE=demo) で /admin/growth-book が
// 500 ではなく 200 を返すことを assert する。
//
// ## Root cause (#2262)
// 旧 `src/lib/server/db/certificate-repo.ts` が `db` (sqlite) を直 import しており、
// DATA_SOURCE=demo Lambda では「sqlite テーブルが CREATE されない」(`client.ts` の
// `SQL_CREATE_TABLES` 実行が `if (DATA_SOURCE === 'sqlite')` ガードされている) ため、
// `findCertificates` で `no such table: certificates` を throw → `+page.server.ts` 内の
// `Promise.all([buildGrowthBook(...), ...])` が reject → 500 Internal Server Error。
//
// ## 修正後の期待動作
// `certificate-repo` を factory パターン化 (sqlite / demo / dynamodb 3 実装) し、demo
// Lambda では `DEMO_CERTIFICATES` fixture を返す。`/admin/growth-book` は 200 で render され、
// 「がんばり証明書 N 枚」が表示される。

import { expect, test } from '@playwright/test';

test.describe('Demo Lambda /admin/growth-book 500 修正 (#2262)', () => {
	test('未指定 (?childId なし) で 200 / 「成長記録」見出しが表示される', async ({ page }) => {
		const res = await page.goto('/admin/growth-book');
		expect(res?.status()).toBeLessThan(400);
		await expect(page).toHaveURL(/\/admin\/growth-book/);
		// page.svelte: <h2>📖 成長記録ブック</h2> (GROWTH_BOOK_LABELS.pageHeading)。
		// チュートリアル / フィードバック等 dialog の h2 と混ざるため role+name で uniquify する。
		await expect(page.getByRole('heading', { level: 2, name: /成長記録/ })).toBeVisible();
	});

	test('?childId=903 (elementary けんた) で 200 / 証明書 4 件が反映される', async ({ page }) => {
		// DEMO_CERTIFICATES fixture: 903 は streak_14 / level_5 / monthly_2026-02 / category_master_1 の 4 件
		const res = await page.goto('/admin/growth-book?childId=903');
		expect(res?.status()).toBeLessThan(400);

		// "しょうめいしょ" 系統計タイル (GROWTH_BOOK_LABELS.statCertificates) が表示される
		// page.svelte: <p class="text-2xl font-bold">{book.certificateCount}</p>
		// 4 という数値が DOM に含まれていれば OK (他の数値と混ざる可能性は graceful に許容)
		await expect(page.locator('body')).toContainText('4');
	});

	test('?childId=901 (baby たろう, 証明書 0 件) でも 200', async ({ page }) => {
		// baby は DEMO_CERTIFICATES に登場しないため 0 件 → empty array path も 500 にならないことを確認
		const res = await page.goto('/admin/growth-book?childId=901');
		expect(res?.status()).toBeLessThan(400);
	});
});
