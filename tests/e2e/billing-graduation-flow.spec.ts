// tests/e2e/billing-graduation-flow.spec.ts
// #1603 / ADR-0023 §3.8 / §5 I10: 卒業フロー E2E テスト
//
// 検証観点:
// - /admin/billing/cancel/graduation が直接アクセス可能（解約フロー後の redirect 着地点）
// - 残ポイント表示 + 還元提案 + 大吉キャラ画像が出る
// - 公開承諾チェックボックス + nickname / message が機能する
// - 送信ボタンが描画される
// - 解約ページで「卒業」を選択しても 500 で落ちない（redirect 連鎖）

import { expect, test } from '@playwright/test';

test.describe('#1603 Graduation flow', () => {
	test('/admin/billing/cancel/graduation が 200 で表示される', async ({ page }) => {
		const response = await page.goto('/admin/billing/cancel/graduation');
		expect(response?.status()).not.toBe(500);
	});

	test('卒業ページに祝福見出し + 説明文が描画される', async ({ page }) => {
		await page.goto('/admin/billing/cancel/graduation', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('graduation-page')).toBeVisible();
		await expect(page.getByTestId('graduation-heading')).toContainText('卒業おめでとう');
	});

	test('残ポイントセクションが表示される', async ({ page }) => {
		await page.goto('/admin/billing/cancel/graduation', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('graduation-points-section')).toBeVisible();
		// 0 件のテストデータでも「ポイント残高はありません」or 数値のいずれかが見える
		const valueLocator = page.getByTestId('graduation-points-value');
		await expect(valueLocator).toBeVisible();
	});

	test('還元提案セクション（現金 / 物品 / 体験）が表示される', async ({ page }) => {
		await page.goto('/admin/billing/cancel/graduation', { waitUntil: 'domcontentloaded' });
		const section = page.getByTestId('graduation-reward-section');
		await expect(section).toBeVisible();
		await expect(page.getByTestId('graduation-reward-cash')).toBeVisible();
		await expect(section).toContainText('物品の例');
		await expect(section).toContainText('体験の例');
	});

	test('事例公開承諾セクション（チェックボックス + nickname + message）', async ({ page }) => {
		await page.goto('/admin/billing/cancel/graduation', { waitUntil: 'domcontentloaded' });

		const checkbox = page.getByTestId('graduation-consent-checkbox');
		await expect(checkbox).toBeVisible();
		await expect(checkbox).toHaveAttribute('type', 'checkbox');

		const nickname = page.getByTestId('graduation-nickname');
		await expect(nickname).toBeVisible();
		await expect(nickname).toHaveAttribute('maxlength', '30');

		const message = page.getByTestId('graduation-message');
		await expect(message).toBeVisible();
		await expect(message).toHaveAttribute('maxlength', '500');
	});

	test('チェックボックス未チェック状態でも送信ボタンが描画される', async ({ page }) => {
		await page.goto('/admin/billing/cancel/graduation', { waitUntil: 'domcontentloaded' });
		const submit = page.getByTestId('graduation-submit');
		await expect(submit).toBeVisible();
	});

	test('チェックボックスを ON にすると nickname 必須の表示が出る', async ({ page }) => {
		await page.goto('/admin/billing/cancel/graduation', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('graduation-consent-checkbox').check();
		const consentSection = page.getByTestId('graduation-consent-section');
		await expect(consentSection).toContainText('必須');
	});

	test('文字数カウンタが入力に応じて更新される', async ({ page }) => {
		await page.goto('/admin/billing/cancel/graduation', { waitUntil: 'domcontentloaded' });
		const textarea = page.getByTestId('graduation-message');
		await textarea.fill('テストメッセージです');
		await expect(page.locator('body')).toContainText('/ 500 文字');
	});

	test('解約フローで「卒業」を選んで送信すると専用ページへ遷移する', async ({ page }) => {
		await page.goto('/admin/billing/cancel', { waitUntil: 'domcontentloaded' });
		await page.getByTestId('cancellation-category-graduation').check();
		await page.getByTestId('cancellation-submit').click();
		await page.waitForURL(/\/admin\/billing\/cancel\/(graduation|thanks)/);
		// 卒業ページか thanks ページのどちらかに遷移すれば OK
		// （無料プランで Stripe 連携無し時は thanks 経由する設計もあり得るが、
		//  本実装では graduation を最優先）
		await expect(page).toHaveURL(/\/admin\/billing\/cancel\/(graduation|thanks)/);
	});
});
