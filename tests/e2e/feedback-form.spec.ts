// tests/e2e/feedback-form.spec.ts
// #2904: フィードバック導線 E2E (旧 #839 FeedbackFab + FeedbackDialog は撤去済)
//
// - 右下常設 FeedbackFab が admin 画面に存在しない (イルカ問題の根治、research §4)
// - 各リソース画面の ︙ overflow menu 末尾「ご意見を送る」(AdminResourceHeader 自動 append)
//   から /admin/settings/support へ 1 hop で遷移できる (NN/G 隠し導線半減の補填、research §5-3)
// - 設定 > サポートのご意見フォーム (SSOT) で送信が goal 完遂する
//   (act → outcome assert、tests/CLAUDE.md「render-only 禁止」)

import { expect, type Page, test } from '@playwright/test';

/**
 * Ark UI Menu trigger を開く helper (admin-activities-add-ux.spec.ts と同型)。
 * Ark UI Menu は hydration 完了後に listener を attach するため、`data-state="open"` に
 * 遷移するまで rAF 間隔で再 click する (#2260 Fix-6 で確立した安定化パターン)。
 */
async function openMenu(page: Page, triggerTestid: string): Promise<void> {
	const trigger = page.getByTestId(triggerTestid);
	await expect(trigger).toBeVisible({ timeout: 15_000 });
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
	const MAX_ATTEMPTS = 30;
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		await trigger.click();
		const state = await trigger.evaluate((el) => el.getAttribute('data-state'));
		if (state === 'open') return;
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
	}
	await expect(trigger).toHaveAttribute('data-state', 'open');
}

test.describe('#2904 フィードバック導線 (FAB 撤去 + ︙ ご意見を送る + 設定 > サポート SSOT)', () => {
	test('admin 画面に右下常設 FeedbackFab が存在しない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('feedback-fab')).toHaveCount(0);
		// FAB が消えてもフィードバック経路自体は維持されている (設定ナビにサポートが残る) — AC2
		await page.goto('/admin/settings/support', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('[data-tutorial="feedback-section"]')).toBeVisible();
	});

	test('activities ︙ menu 末尾「ご意見を送る」→ /admin/settings/support へ 1 hop 遷移', async ({
		page,
	}) => {
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		await openMenu(page, 'header-overflow-menu-btn');
		const feedbackItem = page.getByTestId('menu-item-feedback');
		await expect(feedbackItem).toBeVisible();
		await Promise.all([
			page.waitForURL(/\/admin\/settings\/support/, { timeout: 15_000 }),
			feedbackItem.click(),
		]);
		// 遷移先 = ご意見フォーム SSOT (act → outcome)
		await expect(page.locator('[data-tutorial="feedback-section"]')).toBeVisible();
	});

	test('rewards ︙ menu (overflowSnippet 経路) にも「ご意見を送る」が末尾 append される', async ({
		page,
	}) => {
		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		await openMenu(page, 'rewards-overflow-menu');
		await expect(page.getByTestId('menu-item-feedback')).toBeVisible();
	});

	test('checklists ︙ menu (OverflowMenu primitive 経路) にも「ご意見を送る」が末尾 append される', async ({
		page,
	}) => {
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await openMenu(page, 'checklists-overflow-menu');
		await expect(page.getByTestId('overflow-menu-item-feedback')).toBeVisible();
	});

	test('設定 > サポートのご意見フォームで送信が完遂する (act → outcome)', async ({ page }) => {
		await page.goto('/admin/settings/support', { waitUntil: 'domcontentloaded' });
		// カテゴリ選択 (NativeSelect = native <select>)
		await page.locator('#feedbackCategory').selectOption('bug');
		// 内容入力
		await page.locator('#feedbackText').fill('E2E テスト用のフィードバック内容です (#2904)');
		const submitBtn = page.getByRole('button', { name: 'フィードバックを送信' });
		await expect(submitBtn).toBeEnabled();
		// 送信 → form action (?/sendFeedback) の成功反映 (SuccessAlert) まで検証
		await submitBtn.click();
		await expect(
			page.getByText(/お問い合わせを受け付けました|今後の参考とさせていただきます/),
		).toBeVisible({ timeout: 15_000 });
	});

	test('内容未入力では送信ボタンが無効 (空送信 dead-end 防止)', async ({ page }) => {
		await page.goto('/admin/settings/support', { waitUntil: 'domcontentloaded' });
		const submitBtn = page.getByRole('button', { name: 'フィードバックを送信' });
		await expect(submitBtn).toBeDisabled();
	});
});
