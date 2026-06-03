// tests/e2e/a11y-critical-cuj.spec.ts
// CX-DoR #10 Accessibility — critical CUJ × axe-core WCAG 2.2 AA gate (A-5)
//
// 背景 (tmp/round18-dor-audit-integrated-2026-06-03.md §A-5):
//   axe-core E2E 統合ゼロ + CI gate ゼロ。本 spec で marketplace 5 type 取込 CUJ の主要 page と
//   子供 home 代表 2 mode を axe-core で scan し、critical / serious 違反 0 件を機械検証する。
//
// scope (Pre-PMF / ADR-0010、重い full-matrix でなく critical CUJ のみ):
//   - marketplace 一覧 / 詳細 (取込 entry)
//   - 受領 admin 3 page (activities / checklists / rewards)
//   - 子供 home 代表 2 mode (preschool / elementary)
//
// 認証: AUTH_MODE=local の自動セットアップで /admin・/marketplace・/(child) に到達できる前提
//   (hooks.server.ts + tests/e2e/global-setup.ts の tenant seed)。
//
// baseline pin: tests/e2e/a11y-baseline.json に rule id 単位で既知違反を pin (silent cap 禁止、log で件数明示)。

import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';

// Vite dev コールドコンパイル + axe-core 1.2MB inject 耐性。
test.describe('CX-DoR #10 Accessibility — critical CUJ (WCAG 2.2 AA)', () => {
	test.describe.configure({ timeout: 180_000 });

	// ============================================================
	// 1. marketplace 取込 entry (一覧 / 詳細)
	// ============================================================
	test('marketplace 一覧 (/marketplace) に critical/serious a11y 違反がない', async ({ page }) => {
		test.slow();
		const res = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);
		// 件数表示が描画されるまで待つ (動的 list 描画完了の signal)
		await expect(page.locator('[data-testid="result-count"]').first()).toBeVisible();
		await expectNoA11yViolations(page, '/marketplace');
	});

	test('marketplace 詳細 (/marketplace/checklist/event-pool) に critical/serious a11y 違反がない', async ({
		page,
	}) => {
		test.slow();
		const res = await page.goto('/marketplace/checklist/event-pool', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);
		// 取込 CTA が描画されるまで待つ
		await expect(page.getByTestId('marketplace-detail-cta')).toBeVisible();
		await expectNoA11yViolations(page, '/marketplace/checklist/event-pool');
	});

	// ============================================================
	// 2. 受領 admin 3 page (activities / checklists / rewards)
	// ============================================================
	for (const adminPath of ['/admin/activities', '/admin/checklists', '/admin/rewards']) {
		test(`受領 admin (${adminPath}) に critical/serious a11y 違反がない`, async ({ page }) => {
			test.slow();
			const res = await page.goto(adminPath, { waitUntil: 'domcontentloaded' });
			expect(res?.status()).toBe(200);
			// admin layout の main 領域が描画されるまで待つ
			await expect(page.locator('main').first()).toBeVisible();
			await expectNoA11yViolations(page, adminPath);
		});
	}

	// ============================================================
	// 3. 子供 home 代表 2 mode (preschool / elementary)
	// ============================================================
	for (const childPath of ['/preschool/home', '/elementary/home']) {
		test(`子供 home (${childPath}) に critical/serious a11y 違反がない`, async ({ page }) => {
			test.slow();
			const res = await page.goto(childPath, { waitUntil: 'domcontentloaded' });
			expect(res?.status()).toBe(200);
			await expect(page.locator('main, [data-testid="child-home"]').first()).toBeVisible();
			await expectNoA11yViolations(page, childPath);
		});
	}
});
