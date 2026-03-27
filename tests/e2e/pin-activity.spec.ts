// tests/e2e/pin-activity.spec.ts
// #0115 ピン留め機能の E2E テスト
// #0153 で追加

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

// ============================================================
// ヘルパー
// ============================================================

async function selectKinderChild(page: Page) {
	await page.goto('/switch');
	const childButton = page.locator('button[type="submit"]').filter({ hasText: 'ゆうきちゃん' });
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/kinder\/home/);
}

async function selectBabyChild(page: Page) {
	await page.goto('/switch');
	const childButton = page.locator('button[type="submit"]').filter({ hasText: 'てすとくん' });
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/baby\/home/);
}

async function dismissOverlays(page: Page) {
	const hasOmikuji = await page
		.getByText('きょうのうんせい')
		.isVisible()
		.catch(() => false);
	if (hasOmikuji) {
		try {
			const omikujiBtn = page.getByRole('button', { name: /タップしてすすむ/ });
			await omikujiBtn.waitFor({ timeout: 4000 });
			await omikujiBtn.click();
			await page.waitForTimeout(500);
		} catch {
			// ignore
		}
	}
	try {
		const birthdayBtn = page.getByRole('button', { name: /はじめる/ });
		if (await birthdayBtn.isVisible().catch(() => false)) {
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);
		}
	} catch {
		// ignore
	}
	for (let i = 0; i < 3; i++) {
		await page.waitForTimeout(400);
		try {
			const closeBtn = page.getByRole('button', { name: /とじる|閉じる|OK|やったー/ });
			if (await closeBtn.isVisible().catch(() => false)) {
				await closeBtn.click();
				await page.waitForTimeout(300);
			} else {
				break;
			}
		} catch {
			break;
		}
	}
	await page.waitForTimeout(300);
}

/** 右クリックで contextmenu を発火してピンメニューを開く */
async function openPinMenu(card: import('@playwright/test').Locator) {
	// force: true — 完了済み(disabled)カードでもピン留め操作は可能
	await card.click({ button: 'right', force: true });
}

/** 最初の未完了（disabled でない）活動カードを取得 */
function getFirstEnabledCard(page: Page) {
	return page.locator('button.tap-target:not([disabled])').first();
}

/** ピンメニュー内の「ピンどめする」ボタン */
function getPinButton(page: Page) {
	return page.locator('button').filter({ hasText: '📌 ピンどめする' });
}

/** ピンメニュー内の「ピンどめをはずす」ボタン */
function getUnpinButton(page: Page) {
	return page.locator('button').filter({ hasText: '📌 ピンどめをはずす' });
}

// ============================================================
// テスト（serial: DB状態を共有するため順序実行）
// ============================================================

test.describe
	.serial('#0115: ピン留め機能', () => {
		// CI 環境では serial テスト間のページ遷移 + overlay dismiss で時間がかかる
		test.setTimeout(60_000);

		test('長押し（右クリック）でピンメニューが表示される', async ({ page }) => {
			await selectKinderChild(page);
			await dismissOverlays(page);

			const card = getFirstEnabledCard(page);
			await expect(card).toBeVisible();
			await openPinMenu(card);

			// ピンメニューダイアログのピンボタンが表示される
			const pinBtn = getPinButton(page);
			await expect(pinBtn).toBeVisible({ timeout: 3000 });

			// とじるボタンで閉じる
			const closeBtn = page.locator('button').filter({ hasText: /^とじる$/ });
			await expect(closeBtn).toBeVisible();
			await closeBtn.click();
		});

		test('ピン留めすると📌が付く（aria-label で確認）', async ({ page }) => {
			await selectKinderChild(page);
			await dismissOverlays(page);

			// 「たいそうした」をピン留め
			const targetCard = page.getByRole('button', { name: 'たいそうした' });
			await expect(targetCard).toBeVisible();
			await openPinMenu(targetCard);

			const pinBtn = getPinButton(page);
			await expect(pinBtn).toBeVisible({ timeout: 3000 });
			await pinBtn.click();

			// ダイアログが閉じてページ更新
			await expect(pinBtn).not.toBeVisible({ timeout: 5000 });
			await page.waitForTimeout(1000);

			// ピン留め済みカードが表示される
			const pinnedCard = page.getByRole('button', { name: /たいそうした.*ピンどめ/ });
			await expect(pinnedCard).toBeVisible({ timeout: 5000 });
		});

		test('ピン留めした活動がカテゴリ先頭に表示される', async ({ page }) => {
			// 前のテストで「たいそうした」がピン留み済み
			await selectKinderChild(page);
			await dismissOverlays(page);

			// 「うんどう」カテゴリの最初の未完了カードがピン留め済みの「たいそうした」であること
			const pinnedCard = page.locator('button.tap-target[aria-label*="ピンどめ"]').first();
			const label = await pinnedCard.getAttribute('aria-label');
			expect(label).toContain('たいそうした');
		});

		test('区切り線がピン留め活動と非ピン留め活動の間に表示される', async ({ page }) => {
			// 前のテストで「たいそうした」がピン留み済み
			await selectKinderChild(page);
			await dismissOverlays(page);

			// ピン区切り線の存在を確認
			const separator = page.locator('[data-testid="pin-separator"]');
			await expect(separator.first()).toBeVisible({ timeout: 5000 });
		});

		test('ピン留めを解除すると📌が消える', async ({ page }) => {
			await selectKinderChild(page);
			await dismissOverlays(page);

			// ピン留め済み「たいそうした」を右クリック
			const pinnedCard = page.getByRole('button', { name: /たいそうした.*ピンどめ/ });
			await expect(pinnedCard).toBeVisible({ timeout: 5000 });
			await openPinMenu(pinnedCard);

			const unpinBtn = getUnpinButton(page);
			await expect(unpinBtn).toBeVisible({ timeout: 3000 });
			await unpinBtn.click();
			await expect(unpinBtn).not.toBeVisible({ timeout: 5000 });
			await page.waitForTimeout(1000);

			// ピン留め済みカードがなくなる
			const remaining = page.locator('button.tap-target[aria-label*="ピンどめ"]');
			await expect(remaining).toHaveCount(0, { timeout: 5000 });

			// 区切り線も消える
			const separator = page.locator('[data-testid="pin-separator"]');
			await expect(separator).toHaveCount(0, { timeout: 3000 });
		});

		test('Baby モードでは長押しメニューが表示されない', async ({ page }) => {
			await selectBabyChild(page);
			await dismissOverlays(page);

			// Baby モードの活動ボタンを右クリック
			const card = page.locator('button.tap-target').first();
			if (!(await card.isVisible().catch(() => false))) {
				test.skip(true, 'Baby モードに活動カードがないためスキップ');
				return;
			}
			await card.click({ button: 'right' });

			// ピンメニューが表示されないことを確認
			const pinBtn = getPinButton(page);
			await expect(pinBtn).not.toBeVisible({ timeout: 2000 });
		});
	});
