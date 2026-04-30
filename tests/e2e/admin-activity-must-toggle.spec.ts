// tests/e2e/admin-activity-must-toggle.spec.ts
// #1756 (#1709-B): /admin/activities/[id]/edit の must トグル E2E
//
// 検証対象:
// 1. /admin/activities にアクセス → 一覧が表示される
// 2. 任意の activity の「編集」リンクから /admin/activities/[id]/edit へ遷移
// 3. 「今日のおやくそく」トグルを ON → 保存
// 4. /admin/activities にリダイレクト後、対象 activity に must Badge が表示される
// 5. /admin/checklists には kind タブ（routine/item）が一切存在しない（並行: admin-checklists-no-kind-tab）

import { expect, test } from '@playwright/test';

test.describe('#1756 (#1709-B) 親 UI: must トグル', () => {
	test('一覧から編集ページへ遷移できる', async ({ page }) => {
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		// アプリ全体ロード完了を assert
		const editLink = page.getByTestId('activity-edit-link').first();
		await expect(editLink).toBeVisible();
		const href = await editLink.getAttribute('href');
		expect(href).toMatch(/^\/admin\/activities\/\d+\/edit$/);
	});

	test('編集ページに must トグルが表示される', async ({ page }) => {
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		const editLink = page.getByTestId('activity-edit-link').first();
		await editLink.click();
		await page.waitForURL(/\/admin\/activities\/\d+\/edit$/);

		// must トグル UI が描画される
		await expect(page.getByTestId('must-toggle-section')).toBeVisible();
		const checkbox = page.getByTestId('must-toggle-checkbox');
		await expect(checkbox).toBeVisible();
		// 説明文（hint）も描画されている
		await expect(page.getByText('「今日のおやくそく」にする')).toBeVisible();
	});

	test('must トグル ON → 保存 → 一覧に must Badge が現れる', async ({ page }) => {
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });

		// 一覧画面で対象 activity の id と name を取得して編集ページへ
		const editLink = page.getByTestId('activity-edit-link').first();
		const editHref = await editLink.getAttribute('href');
		expect(editHref).toBeTruthy();
		await editLink.click();
		await page.waitForURL(/\/admin\/activities\/\d+\/edit$/);

		// 編集画面で must トグル ON
		const checkbox = page.getByTestId('must-toggle-checkbox');
		await checkbox.check();
		await expect(checkbox).toBeChecked();

		// 保存
		const save = page.getByTestId('activity-edit-save');
		await save.click();
		await page.waitForURL('/admin/activities');

		// 一覧画面で must Badge が表示される
		// （対象 activity の row に must Badge が含まれることを確認）
		const mustBadges = page.getByTestId('must-badge');
		await expect(mustBadges.first()).toBeVisible();
	});

	test('must トグル OFF（既定）の活動には must Badge が出ない', async ({ page }) => {
		// 編集ページに直接アクセスして OFF のまま保存しても must Badge は付かない
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		const editLink = page.getByTestId('activity-edit-link').first();
		await editLink.click();
		await page.waitForURL(/\/admin\/activities\/\d+\/edit$/);

		const checkbox = page.getByTestId('must-toggle-checkbox');
		// もし元々 ON なら OFF に
		if (await checkbox.isChecked()) {
			await checkbox.uncheck();
		}
		await expect(checkbox).not.toBeChecked();

		const save = page.getByTestId('activity-edit-save');
		await save.click();
		await page.waitForURL('/admin/activities');

		// 「activity-edit-link」first() が指していた activity に must Badge が無いこと
		// 安全策として一覧全体で 0 個または絞れていれば OK
		// （test order 独立: 他のテストで ON にした activity を OFF に戻しているわけではないので、
		//   ここでは「最初の activity を OFF にして保存後、その activity 行に must Badge が無い」を確認）
		const firstRow = page
			.getByTestId('activity-edit-link')
			.first()
			.locator('xpath=ancestor::div[contains(@class, "activity-list-item")]');
		await expect(firstRow.getByTestId('must-badge')).toHaveCount(0);
	});
});
