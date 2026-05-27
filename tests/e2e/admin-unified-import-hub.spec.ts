/**
 * UnifiedImportHub E2E — Issue #2370 / EPIC #2362 P4 / #2558 bug-1 goal 完遂昇格
 *
 * #2558 で **rendering-only → goal 完遂 (act → outcome)** に昇格 (tests/CLAUDE.md
 * §interactive flow / goal-flows helper)。初顧客レビューで「追加ボタン無反応・dialog
 * 閉じない」(機能 dead-end) を 1 分で発見した経路を、render proxy ではなく
 * 「import click → dialog 閉じる / 一覧反映」= ユーザーの goal 完遂で検証する。
 *
 * 設計原則 (ADR-0006 整合):
 *   - 旧 ActivityImportPanel testid `activity-import-panel` を新 UnifiedImportHub が
 *     `activity-pack` モード時に維持 (E2E 互換のため、Strangler Fig パターン)
 *   - 新 testid `data-active-type` 属性で type 切替検証可能性を提供
 *   - import 系 test は必ず act → outcome (dialog close / 一覧反映) を assert する
 *     (render-only 禁止、tests/CLAUDE.md)
 */

import { expect, test } from '@playwright/test';
import { openMenu } from './helpers/goal-flows';

test.describe('UnifiedImportHub — #2370 / #2558 (admin/activities)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('header-add-activity-btn')).toBeVisible({ timeout: 15000 });
	});

	test('header + dropdown menu → menu-item-import で UnifiedImportHub が render される', async ({
		page,
	}) => {
		await openMenu(page, 'header-add-activity-btn', 'menu-item-import');
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
		await openMenu(page, 'header-add-activity-btn', 'menu-item-import');
		await page.getByTestId('menu-item-import').click();
		await expect(page.getByTestId('activity-import-panel')).toBeVisible();
		// typeCode prop 指定時は tabs を出さない (isSingleType branch)
		await expect(page.getByTestId('unified-import-hub-tabs')).toHaveCount(0);
	});

	// ============================================================
	// #2558 bug-1: 機能 dead-end (追加無反応・cancel 不能) の goal 完遂検証
	// ============================================================

	test('bug-1: import preset を click → dialog が閉じる (追加が完遂する。無反応なら fail)', async ({
		page,
	}) => {
		test.slow();
		// import dialog を開き、最初の preset を取得する
		await openMenu(page, 'header-add-activity-btn', 'menu-item-import');
		await page.getByTestId('menu-item-import').click();
		await expect(page.getByTestId('activity-import-panel')).toBeVisible();

		const presetBtns = page.locator('[data-testid^="marketplace-preset-import-"]');
		await expect(presetBtns.first()).toBeVisible({ timeout: 15000 });
		const presetTestid = (await presetBtns.first().getAttribute('data-testid')) as string;
		expect(presetTestid, 'preset import button testid が取得できること').toBeTruthy();

		const btn = page.getByTestId(presetTestid);
		// dead-end 前提: ボタンが押下可能であること
		await expect(btn).toBeEnabled();

		// ACT: import を実行。
		//   - 副作用 A (network): ?/importPack form action が発火する
		//   - 副作用 B (UI): add-activity-dialog が閉じる (onclose 発火)
		// ボタン無反応 (旧 dead-end) なら dialog が閉じず必ず fail する。
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\/admin\/activities\?\/importPack/.test(r.url())),
			btn.click(),
		]);
		expect(resp.ok(), `importPack response not OK (status ${resp.status()})`).toBeTruthy();

		// 副作用 B: dialog が閉じる (= onclose 発火、追加完遂)。
		// Ark Dialog は閉じても DOM に残り hidden 化するため toBeHidden() で検証する
		// (toHaveCount(0) は不可)。旧 dead-end (ボタン無反応) なら dialog が開いたままで fail する。
		await expect(page.getByTestId('add-activity-dialog')).toBeHidden({ timeout: 30_000 });
	});

	test('bug-1: import dialog は cancel / close で必ず閉じられる (cancel 不能なら fail)', async ({
		page,
	}) => {
		// dialog を開く → ESC で閉じる (Dialog primitive の close 経路)。
		// 今回 bug の 1 つ「cancel 不能」を検出する。
		await openMenu(page, 'header-add-activity-btn', 'menu-item-import');
		await page.getByTestId('menu-item-import').click();
		const dialog = page.getByTestId('add-activity-dialog');
		await expect(dialog).toBeVisible();

		await page.keyboard.press('Escape');
		// Ark Dialog は閉じても DOM に残り hidden 化する → toBeHidden() で検証 (cancel 不能なら fail)。
		await expect(dialog).toBeHidden({ timeout: 30_000 });
	});
});
