/**
 * EPIC #2253 admin/activities add UX 構造的整理 — E2E 回帰テスト
 *
 * 子 ② (#2255): header + dropdown menu (manual / ai / import)
 * 子 ③ (#2256): empty state secondary import link (bulk import bridge)
 * 子 ④ (#2257): ︙ overflow menu (introduce / export / clear-all)
 *
 * #2260 Fix-3: 弱い assertion (`add-activity-dialog` の visible のみ) を、
 *              `activity-import-panel` / `activity-create-form` / `ai-suggest-panel` の
 *              panel 固有 testid 直接 assertion に強化 (ADR-0006)。
 * #2260 Fix-4: AC #2256 `empty-state-import-link` の visibility + click 動作を、
 *              search filter で全件除外したうえで「filter 外し → empty 表示 → click → import dialog」
 *              という E2E 経路で検証する方式は #2256 AC1-3 に整合しないため、
 *              **Storybook + Unit 経由で empty fixture の挙動を SSOT カバー**しつつ、
 *              E2E では `data-testid="empty-state-import-link"` が DOM 内に存在しうるかの
 *              代替として **filter empty 経由でない無条件 visibility** を直接確認可能なよう
 *              fixture-route stub で empty を再現するアプローチを採用する。
 */

import { expect, test } from '@playwright/test';

test.describe('EPIC #2253 — admin/activities add UX', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');
	});

	// --- 子 ② / 子 ⑤: AddActivityFab が撤去され FeedbackFab のみが残る ---
	test('AddActivityFab が撤去され、画面 FAB は FeedbackFab のみ (M3 単一 FAB / DESIGN §10)', async ({
		page,
	}) => {
		// 旧 add-activity-fab は撤去済
		await expect(page.getByTestId('add-activity-fab')).toHaveCount(0);
		// header の + 追加 ボタンが代替経路
		const addBtn = page.getByTestId('header-add-activity-btn');
		await expect(addBtn).toBeVisible();
	});

	// --- 子 ②: header + dropdown menu の 3 経路 ---
	test('header + ボタンで manual / ai / import 3 menu item が出現', async ({ page }) => {
		const addBtn = page.getByTestId('header-add-activity-btn');
		await addBtn.click();
		await expect(page.getByTestId('menu-item-manual')).toBeVisible();
		await expect(page.getByTestId('menu-item-ai')).toBeVisible();
		await expect(page.getByTestId('menu-item-import')).toBeVisible();
	});

	test('menu-item-manual click で manual Dialog + ActivityCreateForm が直接起動 (#2260 Fix-3)', async ({
		page,
	}) => {
		await page.getByTestId('header-add-activity-btn').click();
		await page.getByTestId('menu-item-manual').click();
		// Fix-3: Dialog の generic visibility ではなく ActivityCreateForm 固有 testid を assert
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		await expect(page.getByTestId('activity-create-form')).toBeVisible();
		// AddActivityModeSelector の card UI は撤去済 (撤去確認)
		await expect(page.locator('.add-mode-grid')).toHaveCount(0);
		// import panel / ai panel は同時表示されない
		await expect(page.getByTestId('activity-import-panel')).toHaveCount(0);
		await expect(page.getByTestId('ai-suggest-panel')).toHaveCount(0);
	});

	test('menu-item-import click で ActivityImportPanel が直接起動 (#2260 Fix-3)', async ({
		page,
	}) => {
		await page.getByTestId('header-add-activity-btn').click();
		await page.getByTestId('menu-item-import').click();
		// Fix-3: ActivityImportPanel 固有 testid を assert (Dialog 一般可視性のみだと
		//        manual / ai / import の区別が付かず ADR-0006 assertion 弱体に該当)
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		await expect(page.getByTestId('activity-import-panel')).toBeVisible();
		// 他 panel は同時表示されない
		await expect(page.getByTestId('activity-create-form')).toHaveCount(0);
		await expect(page.getByTestId('ai-suggest-panel')).toHaveCount(0);
	});

	test('menu-item-ai click で AiSuggestPanel が直接起動 (#2260 Fix-3)', async ({ page }) => {
		await page.getByTestId('header-add-activity-btn').click();
		await page.getByTestId('menu-item-ai').click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		await expect(page.getByTestId('ai-suggest-panel')).toBeVisible();
		await expect(page.getByTestId('activity-create-form')).toHaveCount(0);
		await expect(page.getByTestId('activity-import-panel')).toHaveCount(0);
	});

	// --- 子 ④: ︙ overflow menu ---
	test('header ︙ ボタンで introduce / export / clear-all overflow menu が出現', async ({
		page,
	}) => {
		const overflowBtn = page.getByTestId('header-overflow-menu-btn');
		await overflowBtn.click();
		await expect(page.getByTestId('menu-item-introduce')).toBeVisible();
		await expect(page.getByTestId('menu-item-export')).toBeVisible();
		await expect(page.getByTestId('menu-item-clear-all')).toBeVisible();
	});

	test('menu-item-introduce click で /admin/activities/introduce へ遷移', async ({ page }) => {
		await page.getByTestId('header-overflow-menu-btn').click();
		await page.getByTestId('menu-item-introduce').click();
		await page.waitForURL(/\/admin\/activities\/introduce$/);
	});
});

/**
 * #2260 Fix-4 (AC #2256 E2E): ActivityEmptyState `empty-state-import-link`
 * の visibility + click 動作検証。本 NUC SQLite fixture では 100+ 件 seed されており
 * 真の empty 状態は通常作れないため、**全活動 array を空にする route stub** で
 * `data.activities = []` を作る方式を採用。元 fixture を壊さないため test 内に
 * scope された route stub を mount し、test 後は自動解除される。
 *
 * AC1: empty 状態 (canAdd && !hasFilter) で `empty-state-import-link` が visible
 * AC2: click で import dialog + ActivityImportPanel が直接起動 (manual ではなく import mode)
 */

/** SvelteKit `__data.json` の dehydrated 配列内で activity 風 array を空にする helper */
function emptifyActivitiesInData(json: unknown): void {
	if (!json || typeof json !== 'object' || !('nodes' in json)) return;
	const nodes = (json as { nodes?: unknown[] }).nodes;
	if (!Array.isArray(nodes)) return;
	for (const node of nodes) {
		emptifyNode(node);
	}
}

function emptifyNode(node: unknown): void {
	if (!node || typeof node !== 'object' || !('data' in node)) return;
	const data = (node as { data?: unknown }).data;
	if (!Array.isArray(data)) return;
	for (let i = 0; i < data.length; i++) {
		if (isActivityRecordArray(data[i])) {
			data[i] = [];
		}
	}
}

function isActivityRecordArray(v: unknown): boolean {
	if (!Array.isArray(v) || v.length === 0) return false;
	const first = v[0];
	if (!first || typeof first !== 'object') return false;
	return 'isVisible' in first || 'categoryId' in first;
}

test.describe('EPIC #2253 #2256 — empty state import bridge (Fix-4)', () => {
	test('empty 状態で empty-state-import-link が表示され click で ActivityImportPanel が起動する', async ({
		page,
	}) => {
		await page.route(/\/admin\/activities\/__data\.json/, async (route) => {
			const resp = await route.fetch();
			const json = await resp.json();
			emptifyActivitiesInData(json);
			await route.fulfill({
				response: resp,
				body: JSON.stringify(json),
				headers: { ...resp.headers(), 'content-type': 'application/json' },
			});
		});

		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');

		const link = page.getByTestId('empty-state-import-link');
		// AC #2256 AC1: empty 状態 (canAdd && !hasFilter) で link が visible
		await expect(link).toBeVisible();

		// AC #2256 AC2: click で import panel が直接起動 (manual ではなく import mode で開く)
		await link.click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		await expect(page.getByTestId('activity-import-panel')).toBeVisible();
	});
});
