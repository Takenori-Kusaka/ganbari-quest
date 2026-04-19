// tests/e2e/demo-screenshot-mode.spec.ts
// #1209: `?screenshot=1` による demo 固有 UI 非表示機構が、layout / page の 2 箇所で
// context 経由で同期していることを E2E で担保する。リグレッションで再び別々に再導出
// されるのを検出する。
//
// - layout (`+layout.svelte`) 由来の UI: demo-back-to-lp banner, demo-plan-switcher
// - page 由来の UI: /demo/checklist の黄色デモ注意書き（"これはデモです"）

import { expect, test } from '@playwright/test';

test.describe('#1209 demo screenshot mode', () => {
	test('通常アクセス（?screenshot なし）では layout の demo UI が表示される', async ({ page }) => {
		await page.goto('/demo', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-back-to-lp')).toBeVisible();
		await expect(page.getByTestId('demo-plan-switcher')).toBeVisible();
	});

	test('?screenshot=1 で layout の demo UI（banner / plan switcher）が非表示になる', async ({
		page,
	}) => {
		await page.goto('/demo?screenshot=1', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-back-to-lp')).toHaveCount(0);
		await expect(page.getByTestId('demo-plan-switcher')).toHaveCount(0);
	});

	test('?screenshot=1 で /demo/checklist の黄色デモ注意書きも同時に非表示（context 同期）', async ({
		page,
	}) => {
		// childId=904 は /demo/checklist 撮影で使っているデフォルト（scripts/capture-hp-screenshots.mjs）
		await page.goto('/demo/checklist?childId=904&screenshot=1', {
			waitUntil: 'domcontentloaded',
		});

		// layout 側も同期して消えている（同一 context の getter 経由）
		await expect(page.getByTestId('demo-back-to-lp')).toHaveCount(0);

		// page 側の黄色注意書きも消えている
		const notice = page.getByText('これはデモです。チェックは保存されません。');
		await expect(notice).toHaveCount(0);
	});

	test('?screenshot なしで /demo/checklist の黄色デモ注意書きは表示される', async ({ page }) => {
		await page.goto('/demo/checklist?childId=904', { waitUntil: 'domcontentloaded' });
		const notice = page.getByText('これはデモです。チェックは保存されません。');
		await expect(notice).toBeVisible();
	});
});
