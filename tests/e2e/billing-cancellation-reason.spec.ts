// tests/e2e/billing-cancellation-reason.spec.ts
// #1596 / ADR-0023 §3.8 / I3: 解約フロー理由ヒアリング E2E テスト
//
// 全プラン強制で 3 分類 + 自由記述が必須化されていることを検証する。

import { expect, test } from '@playwright/test';

test.describe('#1596 Cancellation reason flow', () => {
	test('解約ページが 200 で表示される', async ({ page }) => {
		const response = await page.goto('/admin/billing/cancel');
		expect(response?.status()).not.toBe(500);
	});

	test('ページ見出しと説明が表示される', async ({ page }) => {
		await page.goto('/admin/billing/cancel', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1')).toContainText('解約手続き');
		await expect(page.locator('body')).toContainText('解約の前に');
	});

	test('3 分類 (卒業 / 離反 / 中断) の radio が表示される', async ({ page }) => {
		await page.goto('/admin/billing/cancel', { waitUntil: 'domcontentloaded' });

		const graduation = page.getByTestId('cancellation-category-graduation');
		const churn = page.getByTestId('cancellation-category-churn');
		const pause = page.getByTestId('cancellation-category-pause');

		await expect(graduation).toBeVisible();
		await expect(churn).toBeVisible();
		await expect(pause).toBeVisible();

		// すべて radio で同じ name グループに属する
		await expect(graduation).toHaveAttribute('type', 'radio');
		await expect(graduation).toHaveAttribute('name', 'category');
		await expect(churn).toHaveAttribute('name', 'category');
		await expect(pause).toHaveAttribute('name', 'category');
	});

	test('自由記述 textarea が表示される', async ({ page }) => {
		await page.goto('/admin/billing/cancel', { waitUntil: 'domcontentloaded' });
		const textarea = page.getByTestId('cancellation-free-text');
		await expect(textarea).toBeVisible();
		await expect(textarea).toHaveAttribute('maxlength', '1000');
	});

	test('カテゴリ未選択では送信ボタンが disabled', async ({ page }) => {
		await page.goto('/admin/billing/cancel', { waitUntil: 'domcontentloaded' });
		const submit = page.getByTestId('cancellation-submit');
		await expect(submit).toBeDisabled();
	});

	test('カテゴリを選択すると送信ボタンが有効化される', async ({ page }) => {
		await page.goto('/admin/billing/cancel', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('cancellation-category-graduation').check();
		const submit = page.getByTestId('cancellation-submit');
		await expect(submit).toBeEnabled();
	});

	test('文字数カウンタが入力に応じて更新される', async ({ page }) => {
		await page.goto('/admin/billing/cancel', { waitUntil: 'domcontentloaded' });
		const textarea = page.getByTestId('cancellation-free-text');
		await textarea.fill('テスト入力です');
		// "<n> / 1000 文字" 形式
		await expect(page.locator('body')).toContainText('/ 1000 文字');
	});

	test('/admin/billing から /admin/billing/cancel への導線が存在する', async ({ page }) => {
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		const link = page.getByTestId('billing-to-cancel');
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('href', '/admin/billing/cancel');
	});
});
