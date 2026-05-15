// tests/e2e/demo-back-to-lp.spec.ts
// #705: デモ画面 → HP動線追加 — ホームページに戻るボタン + ガイド完了後のプラン比較リンク
//
// ADR-0039 Phase 2 (#2097, 2026-05-15): 旧 `src/routes/demo/+layout.svelte` 削除済。
// demo-back-to-lp testid は旧 layout に存在していたが、root DemoBanner には未統合。
// follow-up Issue で本番 root layout に demo banner / plan switcher / floating CTA を
// 統合してから本テストを再有効化する。

import { expect, test } from '@playwright/test';

test.describe.skip('#705 デモ画面 → HP 導線 (ADR-0039 Phase 2 で skip)', () => {
	test('デモバナーに「HPに戻る」リンクがあり、www.ganbari-quest.com を指す', async ({ page }) => {
		await page.goto('/switch?mode=demo', { waitUntil: 'domcontentloaded' });
		const back = page.getByTestId('demo-back-to-lp');
		await expect(back).toBeVisible();
		await expect(back).toHaveAttribute('href', 'https://www.ganbari-quest.com/');
		await expect(back).toContainText('HPに戻る');
	});

	test('「本番で使ってみる」CTA と共存しており、両方同時に表示される', async ({ page }) => {
		await page.goto('/switch?mode=demo', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-back-to-lp')).toBeVisible();
		// 既存 signup CTA も依然として表示されていること（UX 阻害のない共存）
		await expect(page.getByRole('link', { name: '本番で使ってみる' })).toBeVisible();
	});

	test('デモ配下のどのページからも HP に戻れる（banner は fixed layout で常時表示）', async ({
		page,
	}) => {
		for (const path of ['/switch?mode=demo', '/admin?mode=demo', '/auth/signup']) {
			await page.goto(path, { waitUntil: 'domcontentloaded' });
			await expect(
				page.getByTestId('demo-back-to-lp'),
				`${path} にも HPに戻る リンクがあるべき`,
			).toHaveAttribute('href', 'https://www.ganbari-quest.com/');
		}
	});
});
