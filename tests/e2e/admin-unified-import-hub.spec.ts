/**
 * UnifiedImportHub E2E — Issue #2370 / EPIC #2362 P4 / PO 指摘 ② 直接解決
 *
 * `/admin/activities` の add dialog で UnifiedImportHub が render され、
 * 旧 ActivityImportPanel と同等の testid (`activity-import-panel`) と
 * 新 testid (`data-active-type="activity-pack"`) の両方が同時に取得可能であることを確認する。
 *
 * 設計原則 (ADR-0006 整合):
 *   - 旧 ActivityImportPanel testid `activity-import-panel` を新 UnifiedImportHub が
 *     `activity-pack` モード時に維持 (E2E 互換のため、Strangler Fig パターン)
 *   - 新 testid `data-active-type` 属性で type 切替検証可能性を提供
 */

import { expect, type Page, test } from '@playwright/test';

async function openMenu(page: Page, triggerTestid: string): Promise<void> {
	const trigger = page.getByTestId(triggerTestid);
	await expect(trigger).toBeVisible();
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				if (document.readyState === 'complete') {
					requestAnimationFrame(() => resolve());
				} else {
					window.addEventListener('load', () => requestAnimationFrame(() => resolve()), {
						once: true,
					});
				}
			}),
	);
	for (let attempt = 0; attempt < 30; attempt++) {
		await trigger.click({ force: true });
		const state = await trigger.getAttribute('data-state');
		if (state === 'open') return;
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
	}
	const finalState = await trigger.getAttribute('data-state');
	expect(finalState, `menu trigger ${triggerTestid} not open after 30 attempts`).toBe('open');
}

test.describe('UnifiedImportHub — #2370 (admin/activities)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin/activities');
		await expect(page.getByTestId('activities-header-title')).toBeVisible({ timeout: 15000 });
	});

	test('header + dropdown menu → menu-item-import で UnifiedImportHub が render される', async ({
		page,
	}) => {
		await openMenu(page, 'header-add-activity-btn');
		await page.getByTestId('menu-item-import').click();

		// Dialog が visible
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();

		// 新 UnifiedImportHub が activity-pack モードで render されている
		// 旧 testid `activity-import-panel` を維持 (Strangler Fig)
		const hub = page.getByTestId('activity-import-panel');
		await expect(hub).toBeVisible();
		await expect(hub).toHaveAttribute('data-active-type', 'activity-pack');

		// 統一 UI 固有のセクション 2 つが存在 (marketplace / file)
		await expect(page.getByTestId('unified-import-hub-marketplace')).toBeVisible();
		await expect(page.getByTestId('unified-import-hub-file')).toBeVisible();
		// type hint も表示される
		await expect(page.getByTestId('unified-import-hub-hint')).toBeVisible();

		// 他 panel は同時表示されない
		await expect(page.getByTestId('activity-create-form')).toHaveCount(0);
		await expect(page.getByTestId('ai-suggest-panel')).toHaveCount(0);
	});

	test('UnifiedImportHub は activity-pack 単一 type モードでは tabs を出さない', async ({
		page,
	}) => {
		await openMenu(page, 'header-add-activity-btn');
		await page.getByTestId('menu-item-import').click();
		await expect(page.getByTestId('activity-import-panel')).toBeVisible();
		// typeCode prop 指定時は tabs を出さない (isSingleType branch)
		await expect(page.getByTestId('unified-import-hub-tabs')).toHaveCount(0);
	});
});
