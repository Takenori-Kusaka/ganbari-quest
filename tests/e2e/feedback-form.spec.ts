// tests/e2e/feedback-form.spec.ts
// #839: アプリ内フィードバック送信フォームの E2E テスト
// デモモードでの UI 検証（Discord 送信なしでモック挙動を確認）

import { expect, test } from '@playwright/test';

test.describe('#839 フィードバック送信フォーム (デモ)', () => {
	test.describe.configure({ mode: 'serial' });

	test('フィードバックFABボタンが表示される', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('feedback-fab')).toBeVisible();
	});

	test('FABクリックでフィードバックダイアログが開く', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();
		await expect(page.getByTestId('feedback-form')).toBeVisible();
	});

	test('種別未選択・本文未入力では送信ボタンが無効', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();
		await expect(page.getByTestId('feedback-submit')).toBeDisabled();
	});

	test('種別選択＋本文入力で送信でき、成功メッセージが表示される', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();

		// Select category - click the trigger, then the item
		const selectTrigger = page.getByTestId('feedback-dialog').locator('button[role="combobox"]');
		await selectTrigger.click();
		// Wait for dropdown and select "ご意見"
		await page.getByRole('option', { name: 'ご意見' }).click();

		// Enter feedback text
		await page.getByTestId('feedback-text').fill('テスト用のフィードバックです');

		// Submit should now be enabled
		await expect(page.getByTestId('feedback-submit')).toBeEnabled();
		await page.getByTestId('feedback-submit').click();

		// Wait for success message (demo mode has 500ms delay)
		await expect(page.getByTestId('feedback-success')).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId('feedback-success')).toContainText('ありがとうございます');
		await expect(page.getByTestId('feedback-success')).toContainText('デモ');
	});

	test('1000文字超過でエラー表示＆送信不可', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();

		// Select category
		const selectTrigger = page.getByTestId('feedback-dialog').locator('button[role="combobox"]');
		await selectTrigger.click();
		await page.getByRole('option', { name: '不具合報告' }).click();

		// Enter text over 1000 characters
		const longText = 'あ'.repeat(1001);
		await page.getByTestId('feedback-text').fill(longText);

		// Submit should be disabled due to over-limit
		await expect(page.getByTestId('feedback-submit')).toBeDisabled();

		// Error message about character limit should appear
		await expect(page.getByTestId('feedback-dialog').getByText('1000文字以内')).toBeVisible();
	});

	test('ダイアログを閉じるとフォームがリセットされる', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();

		// Enter some text
		await page.getByTestId('feedback-text').fill('some text');

		// Close dialog via close button
		await page.getByTestId('feedback-dialog').getByLabel('とじる').click();
		await expect(page.getByTestId('feedback-dialog')).toBeHidden();

		// Re-open — form should be reset
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();
		await expect(page.getByTestId('feedback-text')).toHaveValue('');
	});
});
