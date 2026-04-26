// tests/e2e/child-shop-exchange.spec.ts
// #1335: ごほうびショップ 交換フロー E2E テスト
//
// テスト前提:
//   - global-setup.ts でたろうくん(preschool)に以下のシードデータが投入済み:
//     - ポイント残高: 100pt
//     - 交換可能なごほうび（交換可）: 50pt — 交換フローテスト専用
//     - 交換可能なごほうび（キャンセル確認用）: 50pt — キャンセルテスト専用（独立）
//     - 交換不可なごほうび: 200pt（残高 < コスト）

import { expect, test } from '@playwright/test';
import { dismissOverlays, selectKinderChild } from './helpers';

// 交換フローで DB を変更するため直列実行
test.describe.configure({ mode: 'serial' });

test.describe('#1335: ごほうびショップ 交換フロー', () => {
	test('ショップページが表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		const shopPage = page.getByTestId('shop-page');
		await expect(shopPage).toBeVisible();
	});

	test('ポイント残高が表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		const balance = page.getByTestId('point-balance');
		await expect(balance).toBeVisible();

		// 残高が数値（ゼロ以上）として表示される
		const balanceText = await balance.textContent();
		const balanceNum = Number.parseInt(balanceText?.replace(/[^\d]/g, '') ?? '', 10);
		expect(balanceNum).toBeGreaterThanOrEqual(0);
	});

	test('ポイント不足のごほうびは交換ボタンが disabled', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		// 200pt のごほうびカードを探す（E2Eテスト用ごほうび（交換不可））
		const expensiveCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（交換不可）',
		});
		await expect(expensiveCard).toBeVisible();

		// そのカード内の交換ボタンが disabled であることを確認
		const disabledBtn = expensiveCard.locator('button[data-testid^="exchange-btn-"]');
		await expect(disabledBtn).toBeDisabled();
	});

	test('交換フロー全体: 確認 → 申請作成 → 申請中バッジ表示', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		// 50pt の交換可能なごほうびカードを探す（E2Eテスト用ごほうび（交換可））
		// hasText で部分一致（「交換可）」が「交換不可）」に含まれないことを前提）
		const affordableCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（交換可）',
		});
		await expect(affordableCard).toBeVisible();

		// 交換ボタン（enabled）をクリック
		const exchangeBtn = affordableCard.locator('button[data-testid^="exchange-btn-"]');
		await expect(exchangeBtn).toBeEnabled();
		await exchangeBtn.click();

		// 確認ダイアログが表示される（Ark UI が Portal 経由で描画するため page 全体で探す）
		const confirmYes = page.getByTestId('confirm-exchange-yes');
		await expect(confirmYes).toBeVisible({ timeout: 10000 });

		// 「はい」をクリックして申請
		await confirmYes.click();

		// ダイアログが閉じるのを待つ
		await expect(confirmYes).not.toBeVisible();

		// 申請後は「申請中」バッジが表示されるか、交換ボタンが非表示になる
		// どちらかの状態になることを確認（UIの実装に応じて）
		const pendingBadge = affordableCard.getByText('申請中');
		const exchangeBtnAfter = affordableCard.locator('button[data-testid^="exchange-btn-"]');

		const hasPendingBadge = await pendingBadge.isVisible().catch(() => false);
		const hasExchangeBtn = await exchangeBtnAfter.isVisible().catch(() => false);

		// 申請後は「申請中」バッジが表示されるか交換ボタンが消えるかのどちらか
		expect(hasPendingBadge || !hasExchangeBtn).toBe(true);
	});

	test('キャンセルでダイアログが閉じる', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		// キャンセル確認用ごほうびを直接ターゲット（交換フローテストとは独立したシードデータ）
		const cancelTestCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（キャンセル確認用）',
		});
		await expect(cancelTestCard).toBeVisible();

		const exchangeBtn = cancelTestCard.locator('button[data-testid^="exchange-btn-"]');
		await expect(exchangeBtn).toBeEnabled();
		await exchangeBtn.click();

		// 確認ダイアログが表示される
		const confirmCancel = page.getByTestId('confirm-exchange-cancel');
		await expect(confirmCancel).toBeVisible();

		// キャンセルをクリック
		await confirmCancel.click();

		// ダイアログが閉じる
		await expect(confirmCancel).not.toBeVisible();

		// ショップページは引き続き表示されている
		await expect(page.getByTestId('shop-page')).toBeVisible();
	});
});
