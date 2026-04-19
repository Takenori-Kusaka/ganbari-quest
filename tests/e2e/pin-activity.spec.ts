// tests/e2e/pin-activity.spec.ts
// #0115 ピン留め機能の E2E テスト
// #0153 で追加

import { expect, test } from '@playwright/test';
import {
	dismissOverlays,
	expandFirstCategory,
	selectBabyChild,
	selectKinderChild,
} from './helpers';

type Page = import('@playwright/test').Page;

/** 右クリックで contextmenu を発火してピンメニューを開く（#1213: 長押し待ちの安定化） */
async function openPinMenu(card: import('@playwright/test').Locator) {
	await card.scrollIntoViewIfNeeded();
	await expect(card).toBeVisible();
	await card.click({ button: 'right' });
}

/** ピン API の invalidateAll 完了まで待機（#1213: waitForTimeout(1000) の置換） */
function waitForPinApi(page: Page) {
	return page.waitForResponse(
		(res) => /\/api\/v1\/children\/\d+\/activities\/\d+\/pin/.test(res.url()) && res.ok(),
		{ timeout: 10_000 },
	);
}

/** 最初の未完了（disabled でない）活動カードを取得 */
function getFirstEnabledCard(page: Page) {
	return page.locator('[data-testid^="activity-card-"]:not([disabled])').first();
}

/** 最初の未完了カードの aria-label からアクティビティ名を取得 */
async function getFirstEnabledCardName(page: Page): Promise<string> {
	const card = getFirstEnabledCard(page);
	const label = await card.getAttribute('aria-label');
	// aria-label は "たいそうした" や "たいそうした（ミッション）" の形式
	return label?.replace(/（.*）/g, '').trim() ?? '';
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

		// テスト間で共有: ピン留め対象の活動名（未完了カードを動的に選択）
		let pinnedActivityName = '';

		test('長押し（右クリック）でピンメニューが表示される', async ({ page }) => {
			await selectKinderChild(page);
			await dismissOverlays(page);
			await expandFirstCategory(page);

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
			await expandFirstCategory(page);

			// 未完了の活動カードを動的に選択してピン留め
			pinnedActivityName = await getFirstEnabledCardName(page);
			const targetCard = getFirstEnabledCard(page);
			await expect(targetCard).toBeVisible();
			await openPinMenu(targetCard);

			const pinBtn = getPinButton(page);
			await expect(pinBtn).toBeVisible({ timeout: 3000 });

			// API レスポンス + invalidateAll を明示待機（#1213）
			const pinResp = waitForPinApi(page);
			await pinBtn.click();
			await pinResp;

			// ダイアログが閉じてページ更新
			await expect(pinBtn).not.toBeVisible({ timeout: 5000 });

			// ピン留め済みカードが表示される（locator 自体がポーリングするので固定待機は不要）
			const pinnedCard = page.locator(
				`[data-testid^="activity-card-"][aria-label*="${pinnedActivityName}"][aria-label*="ピンどめ"]`,
			);
			await expect(pinnedCard).toBeVisible({ timeout: 5000 });
		});

		test('ピン留めした活動がカテゴリ先頭に表示される', async ({ page }) => {
			await selectKinderChild(page);
			await dismissOverlays(page);
			await expandFirstCategory(page);

			// ピン留め済みカードが存在すること
			const pinnedCard = page
				.locator('[data-testid^="activity-card-"][aria-label*="ピンどめ"]')
				.first();
			await expect(pinnedCard).toBeVisible({ timeout: 5000 });
			const label = await pinnedCard.getAttribute('aria-label');
			expect(label).toContain(pinnedActivityName);
		});

		test('区切り線がピン留め活動と非ピン留め活動の間に表示される', async ({ page }) => {
			await selectKinderChild(page);
			await dismissOverlays(page);
			await expandFirstCategory(page);

			// ピン区切り線の存在を確認
			const separator = page.locator('[data-testid="pin-separator"]');
			await expect(separator.first()).toBeVisible({ timeout: 5000 });
		});

		test('ピン留めを解除すると📌が消える', async ({ page }) => {
			await selectKinderChild(page);
			await dismissOverlays(page);
			await expandFirstCategory(page);

			// ピン留め済みカードを右クリック
			const pinnedCard = page
				.locator('[data-testid^="activity-card-"][aria-label*="ピンどめ"]')
				.first();
			await expect(pinnedCard).toBeVisible({ timeout: 5000 });
			await openPinMenu(pinnedCard);

			const unpinBtn = getUnpinButton(page);
			await expect(unpinBtn).toBeVisible({ timeout: 3000 });

			// API レスポンス + invalidateAll を明示待機（#1213）
			const unpinResp = waitForPinApi(page);
			await unpinBtn.click();
			await unpinResp;

			await expect(unpinBtn).not.toBeVisible({ timeout: 5000 });

			// ピン留め済みカードがなくなる（toHaveCount もポーリングする）
			const remaining = page.locator('[data-testid^="activity-card-"][aria-label*="ピンどめ"]');
			await expect(remaining).toHaveCount(0, { timeout: 5000 });

			// 区切り線も消える
			const separator = page.locator('[data-testid="pin-separator"]');
			await expect(separator).toHaveCount(0, { timeout: 3000 });
		});

		test('Baby モードでは長押しメニューが表示されない', async ({ page }) => {
			await selectBabyChild(page);
			await dismissOverlays(page);
			await expandFirstCategory(page);

			// Baby モードの活動ボタンを右クリック
			const card = page.locator('[data-testid^="activity-card-"]').first();
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
