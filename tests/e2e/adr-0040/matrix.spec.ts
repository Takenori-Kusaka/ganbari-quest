/**
 * ADR-0040 P5 (#1221): mode × plan マトリクス smoke test。
 *
 * playwright.matrix.config.ts から 5 project 並行で実行される。各 project は
 * 異なる APP_MODE + DEBUG_* env で起動した dev server に対して 1 つずつ smoke を打つ。
 *
 * ここで確認したいのは「3 層アーキテクチャが境界条件で crash せず、ホームが描画される」こと。
 * capability 単位の deep 検証は unit test (`tests/unit/policy/capabilities.test.ts`) 側で行う。
 */
import { expect, test } from '@playwright/test';

test.describe('ADR-0040 matrix smoke', () => {
	test('ホームがエラーなく描画される', async ({ page }, testInfo) => {
		const response = await page.goto('/');
		expect(response, `project=${testInfo.project.name}: GET / が応答しない`).not.toBeNull();
		expect(
			response?.status(),
			`project=${testInfo.project.name}: GET / が ${response?.status()} を返した`,
		).toBeLessThan(500);

		// 少なくとも <html> は描画されていること
		await expect(page.locator('html')).toBeAttached();
	});

	test('静的アセット (favicon) が 5xx を返さない', async ({ request }, testInfo) => {
		const res = await request.get('/favicon.ico');
		expect(
			res.status(),
			`project=${testInfo.project.name}: /favicon.ico が ${res.status()}`,
		).toBeLessThan(500);
	});
});
