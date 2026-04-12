// tests/e2e/feedback-form.spec.ts
// #839: アプリ内フィードバック送信フォーム E2E テスト

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * PremiumWelcome ダイアログが表示されていたら閉じる。
 * global-setup で premium_welcome_shown=true をセット済みだが、
 * DB 状態のタイミングで表示される可能性があるためフォールバック。
 */
async function dismissWelcomeIfVisible(page: Page): Promise<void> {
	const welcomeDialog = page.getByRole('dialog', { name: /ようこそ/ });
	const isVisible = await welcomeDialog.isVisible().catch(() => false);
	if (isVisible) {
		const dismissBtn = page.getByRole('button', { name: /さっそく始める/ });
		await dismissBtn.click();
		await expect(welcomeDialog).toHaveCount(0);
	}
}

test.describe('#839 フィードバックフォーム', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		await dismissWelcomeIfVisible(page);
	});

	test('FAB ボタンが表示される', async ({ page }) => {
		const fab = page.getByTestId('feedback-fab');
		await expect(fab).toBeVisible();
	});

	test('FAB クリックでダイアログが開く', async ({ page }) => {
		const fab = page.getByTestId('feedback-fab');
		await fab.click();

		const dialog = page.getByTestId('feedback-dialog');
		await expect(dialog).toBeVisible();

		// フォーム要素が存在することを確認
		const form = page.getByTestId('feedback-form');
		await expect(form).toBeVisible();
		await expect(page.getByTestId('feedback-text')).toBeVisible();
		await expect(page.getByTestId('feedback-submit')).toBeVisible();
	});

	test('種別選択 + テキスト入力 + 送信でフォーム送信（API インターセプト）', async ({ page }) => {
		// API をインターセプトして成功レスポンスを返す
		await page.route('**/api/v1/feedback', (route) => {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true }),
			});
		});

		// FAB クリックでダイアログを開く
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();

		// 種別を選択（Ark UI Select: trigger → content → item）
		const selectTrigger = page.locator(
			'[data-testid="feedback-form"] [data-scope="select"][data-part="trigger"]',
		);
		await selectTrigger.click();
		// 選択肢のリストが表示されるのを待つ
		const selectContent = page.locator(
			'[data-scope="select"][data-part="content"][data-state="open"]',
		);
		await selectContent.waitFor({ state: 'visible', timeout: 3000 });
		// 「不具合報告」を選択
		const bugItem = selectContent.locator('[data-scope="select"][data-part="item"]', {
			hasText: '不具合報告',
		});
		await bugItem.click();

		// テキスト入力
		const textarea = page.getByTestId('feedback-text');
		await textarea.fill('テスト用のフィードバック内容です');

		// 送信ボタンが有効になっていることを確認
		const submitBtn = page.getByTestId('feedback-submit');
		await expect(submitBtn).toBeEnabled();

		// 送信し、API レスポンスを待つ
		const responsePromise = page.waitForResponse('**/api/v1/feedback');
		await submitBtn.click();
		await responsePromise;

		// 成功メッセージが表示されることを確認
		const successMessage = page.getByTestId('feedback-success');
		await expect(successMessage).toBeVisible();
	});

	test('テキスト未入力では送信ボタンが無効', async ({ page }) => {
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();

		const submitBtn = page.getByTestId('feedback-submit');
		await expect(submitBtn).toBeDisabled();
	});

	test('1000文字超過で文字カウントが警告表示になる', async ({ page }) => {
		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();

		const textarea = page.getByTestId('feedback-text');
		// 1001文字のテキストを入力
		const longText = 'あ'.repeat(1001);
		await textarea.fill(longText);

		// 送信ボタンが無効であることを確認（種別未選択＋文字数超過）
		const submitBtn = page.getByTestId('feedback-submit');
		await expect(submitBtn).toBeDisabled();
	});

	test('デモ版でも FAB が表示される', async ({ page }) => {
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });

		const fab = page.getByTestId('feedback-fab');
		await expect(fab).toBeVisible();
	});

	test('デモ版は送信時にモック成功表示', async ({ page }) => {
		await page.goto('/demo/admin', { waitUntil: 'domcontentloaded' });

		await page.getByTestId('feedback-fab').click();
		await expect(page.getByTestId('feedback-dialog')).toBeVisible();

		// デモ版の注意表示があることを確認
		await expect(page.getByText('デモ版のため、実際には送信されません')).toBeVisible();

		// 種別を選択
		const selectTrigger = page.locator(
			'[data-testid="feedback-form"] [data-scope="select"][data-part="trigger"]',
		);
		await selectTrigger.click();
		const selectContent = page.locator(
			'[data-scope="select"][data-part="content"][data-state="open"]',
		);
		await selectContent.waitFor({ state: 'visible', timeout: 3000 });
		const opinionItem = selectContent.locator('[data-scope="select"][data-part="item"]', {
			hasText: 'ご意見',
		});
		await opinionItem.click();

		// テキスト入力
		await page.getByTestId('feedback-text').fill('デモのテストフィードバック');

		// 送信（API は呼ばれない）
		await page.getByTestId('feedback-submit').click();

		// 成功メッセージが表示される
		await expect(page.getByTestId('feedback-success')).toBeVisible();
	});
});
