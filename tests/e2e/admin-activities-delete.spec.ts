/**
 * #2744 AC4 — admin/activities Delete UI (family scope) E2E 回帰
 *
 * 既存 `?/delete` server action (`+page.server.ts:266-289`) を UI から呼ぶ動線を verify する。
 * delete action は活動ログがあれば hidden 化 (soft) / なければ deleteActivityWithCleanup (hard)
 * の二段階分岐するため、UI 側完了後の state 変化を **render-only でなく goal 完遂** で assert する
 * (tests/CLAUDE.md §「interactive flow は『操作 → 結果』を必須検証する」)。
 *
 * 検証する 3 sequence (act → outcome assert):
 *   1. 削除 confirm → 確定 click → family 一覧件数が -1 (toHaveCount(before - 1)) + Toast success
 *   2. 削除 confirm → キャンセル click → Dialog close + 件数不変
 *   3. activity-delete-btn が family 各行に visible (entry point 担保)
 *
 * deterministic completion signal: 件数の `toHaveCount` 比較 + Toast の text assertion で
 * waitForTimeout を一切使わず web-first assertion で完遂を verify
 * (memory feedback_no_manual_fallback_for_automation_failure 整合)。
 */

import { expect, type Locator, test } from '@playwright/test';

/**
 * Ark UI Dialog primitive の trigger button を click し dialog が data-state="open" に
 * 遷移するまで最大 5 attempt retry。`admin-activities-add-ux.spec.ts:openMenu` と同じ
 * 設計思想 (hydration 直後の click が data-state を切り替えないことがある race の吸収)。
 * ADR-0006 適合: assertion 自体は強化 (`toBeVisible` の hard signal を assert)、
 * interaction の retry のみで安定化 (skip / weakening ではない)。
 */
async function openDeleteDialog(triggerBtn: Locator, dialog: Locator): Promise<void> {
	await expect(triggerBtn).toBeVisible();
	await expect(triggerBtn).toBeEnabled();
	await triggerBtn.scrollIntoViewIfNeeded();
	for (let attempt = 0; attempt < 5; attempt++) {
		await triggerBtn.click();
		try {
			await expect(dialog).toBeVisible({ timeout: 2_000 });
			return;
		} catch {
			// hydration race / 再 click で吸収
		}
	}
	await expect(dialog, 'delete confirm dialog not visible after 5 attempts').toBeVisible({
		timeout: 5_000,
	});
}

/**
 * test isolation: 各 test で API 経由で dedicated activity を新規作成 → その特定 id を削除。
 * seed 済 activity (id=1 等) を破壊して `features.spec.ts:135` 等の後続 spec を壊さない。
 */
async function createDedicatedActivity(
	request: import('@playwright/test').APIRequestContext,
	suffix: string,
): Promise<number> {
	const res = await request.post('/api/v1/activities', {
		data: {
			name: `#2744-delete-test-${suffix}-${Date.now()}`,
			icon: '🗑',
			basePoints: 1,
			categoryId: 1,
			ageMin: null,
			ageMax: null,
		},
	});
	expect(res.status()).toBe(201);
	const body = await res.json();
	expect(body.id).toBeDefined();
	return body.id;
}

test.describe('#2744 admin/activities Delete UI (AC4 family scope)', () => {
	test('family 一覧の各行に「削除」button が visible (entry point 担保)', async ({
		page,
		request,
	}) => {
		// dedicated activity を 1 件作成して a) 一覧 >= 1 件保証 b) seed 非破壊
		const testId = await createDedicatedActivity(request, 'entry');
		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');

		const dedicatedBtn = page.getByTestId(`activity-delete-btn-${testId}`);
		await expect(dedicatedBtn).toBeVisible();
		await expect(dedicatedBtn).toBeEnabled();

		// cleanup: API 経由で削除 (UI 経由は他 test で verify、entry point test 自体は破壊不要)
		await request.delete(`/api/v1/activities/${testId}`);
	});

	test('削除 button click → 確認 Dialog 表示 → 確定 → 一覧件数 -1 + Toast success', async ({
		page,
		request,
	}) => {
		// dedicated activity を作成 → その特定 id を UI から削除する (seed 非破壊)
		const testId = await createDedicatedActivity(request, 'confirm');
		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');

		const dedicatedBtn = page.getByTestId(`activity-delete-btn-${testId}`);
		const beforeCount = await page.locator('[data-testid^="activity-delete-btn-"]').count();
		await expect(dedicatedBtn).toBeVisible();

		const dialog = page.getByTestId(`activity-delete-confirm-${testId}`);
		await openDeleteDialog(dedicatedBtn, dialog);
		await expect(page.getByTestId(`activity-delete-confirm-body-${testId}`)).toBeVisible();

		// 確定 click → action 完了まで wait (act → outcome assert)
		const confirmBtn = page.getByTestId(`activity-delete-confirm-submit-${testId}`);
		await expect(confirmBtn).toBeVisible();
		await Promise.all([
			page.waitForResponse(
				(resp) => resp.url().includes('/admin/activities') && resp.request().method() === 'POST',
			),
			confirmBtn.click(),
		]);

		// outcome 1: Dialog が閉じる (cancel 経路と区別、AC-4 確定 path 担保)
		await expect(dialog).toBeHidden();

		// outcome 2: Toast success が表示 (DL.deleteSuccess、labels.ts SSOT 参照)
		// #3233: #3221/ADR-0062 で success Toast は role="status"(polite) に変更 (WCAG 4.1.3 —
		//   成功通知は assertive=alert ではなく polite=status。error のみ role="alert")。
		await expect(page.getByRole('status').filter({ hasText: '活動を削除しました' })).toBeVisible();

		// outcome 3: 一覧件数が確実に -1 (delete action は activity ログがあれば hidden 化、
		//           なければ hard delete、いずれも一覧表示からは消える)
		// web-first assertion `toHaveCount` で auto-retry、waitForTimeout 不使用
		await expect(page.locator('[data-testid^="activity-delete-btn-"]')).toHaveCount(
			beforeCount - 1,
		);
	});

	test('削除 button click → キャンセル click → Dialog 閉じる + 件数不変', async ({
		page,
		request,
	}) => {
		// dedicated activity を作成 → その特定 id の削除を cancel する (seed 非破壊)
		const testId = await createDedicatedActivity(request, 'cancel');
		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');

		const dedicatedBtn = page.getByTestId(`activity-delete-btn-${testId}`);
		const beforeCount = await page.locator('[data-testid^="activity-delete-btn-"]').count();
		await expect(dedicatedBtn).toBeVisible();

		const dialog = page.getByTestId(`activity-delete-confirm-${testId}`);
		await openDeleteDialog(dedicatedBtn, dialog);

		// キャンセル click → Dialog close (act → outcome assert)
		const cancelBtn = page.getByTestId(`activity-delete-cancel-${testId}`);
		await expect(cancelBtn).toBeVisible();
		await cancelBtn.click();

		// outcome 1: Dialog 閉じる
		await expect(dialog).toBeHidden();

		// outcome 2: 件数は不変 (キャンセル経路の dead-end 検出)
		// web-first assertion で auto-retry
		await expect(page.locator('[data-testid^="activity-delete-btn-"]')).toHaveCount(beforeCount);

		// cleanup: API 経由で削除 (cancel test は cancel path 検証のみ、後始末は API で)
		await request.delete(`/api/v1/activities/${testId}`);
	});
});
