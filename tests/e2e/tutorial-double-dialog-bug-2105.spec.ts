// tests/e2e/tutorial-double-dialog-bug-2105.spec.ts
// #2105: ガイドモードの終了確認ダイアログ表示時に元の TutorialBubble が背景に被る
// 二重ダイアログバグの再発防止 E2E。
//
// 修正方針:
// - TutorialOverlay.svelte L43 の {#if} ガードに `&& !showExitConfirm` を追加
// - tutorial-step-controller.svelte.ts の handleOverlayClick に FSM 排他ガード追加
//
// AC4: dark backdrop click → 終了確認ダイアログのみ表示 (TutorialBubble は非表示)
// AC5: 「続ける」(キャンセル) → TutorialBubble 再表示 → チュートリアル続行可能
// AC6: 「終了する」(確定) → チュートリアル終了 (overlay / bubble 共に dismiss)
// AC7: 修正前: 二重ダイアログ / 修正後: 終了確認のみ visible
// AC8: 既存ガイドモード正常系の回帰なし
//
// 実行: npx playwright test tests/e2e/tutorial-double-dialog-bug-2105.spec.ts

import { expect, test } from '@playwright/test';

async function dismissWelcome(page: import('@playwright/test').Page) {
	const welcomeDialog = page.locator('.welcome-overlay');
	if (await welcomeDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
		const dismissBtn = welcomeDialog.locator('button:has-text("さっそく始める")');
		if (await dismissBtn.isVisible().catch(() => false)) {
			await dismissBtn.click();
			await welcomeDialog.waitFor({ state: 'hidden', timeout: 3000 });
		}
	}
}

/**
 * tutorial-restart ボタンは PageGuide 対応ページ (例: /admin) では非表示。
 * PageGuide 非対応ページ (/admin/license) に遷移してから取得する。
 * (tutorial-dialog-primitive-screenshots.spec.ts と同パターン)
 */
async function gotoPageWithRestartBtn(page: import('@playwright/test').Page) {
	await page.goto('/admin/license');
	await dismissWelcome(page);
	await page.evaluate(() => {
		localStorage.removeItem('tutorial-progress-chapter');
		localStorage.removeItem('tutorial-progress-step');
	});
}

async function startTutorialAndOpenExitConfirm(page: import('@playwright/test').Page) {
	const restartBtn = page.locator('[data-tutorial="tutorial-restart"]').first();
	await restartBtn.waitFor({ state: 'visible', timeout: 15_000 });
	await restartBtn.click();

	// overlay 出現待ち
	await page.waitForSelector('.tutorial-overlay-bg', { state: 'visible', timeout: 10_000 });

	// bubble 出現も待つ (重畳検証の前提)
	const bubble = page.locator('.tutorial-bubble');
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });

	// dark backdrop click で exitConfirm 発火 (spotlight 外の左上を狙う)
	await page.locator('.tutorial-overlay-bg').click({ position: { x: 20, y: 20 } });

	const exitDlg = page
		.locator('[role="dialog"]')
		.filter({ hasText: 'チュートリアルを終了しますか' });
	await exitDlg.waitFor({ state: 'visible', timeout: 10_000 });
	await exitDlg.evaluate((el) =>
		Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))),
	);
	return { exitDlg, bubble };
}

test.describe('#2105 ガイドモード二重ダイアログ防止', () => {
	test.setTimeout(90_000);

	test('AC4 / AC7: backdrop click → 終了確認ダイアログのみ表示、TutorialBubble は非表示', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoPageWithRestartBtn(page);

		const { exitDlg, bubble } = await startTutorialAndOpenExitConfirm(page);

		// AC4 / AC7: 終了確認ダイアログが表示されている
		await expect(exitDlg).toBeVisible();

		// 二重ダイアログバグの主検証:
		// TutorialBubble は DOM から削除されているはず ({#if !showExitConfirm} ガード追加で)
		await expect(bubble).toBeHidden();

		// 念のため: TutorialBubble 内の「次へ / 戻る / 終了」ボタンも非表示
		await expect(page.locator('.tutorial-bubble button:has-text("次へ")')).toBeHidden();
	});

	test('AC5: 「続ける」(キャンセル) → TutorialBubble 再表示 / チュートリアル続行', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoPageWithRestartBtn(page);

		const { exitDlg, bubble } = await startTutorialAndOpenExitConfirm(page);

		// 「続ける」(キャンセル) クリック
		const cancelBtn = exitDlg.locator('button:has-text("続ける")');
		await cancelBtn.waitFor({ state: 'visible' });
		await cancelBtn.click();

		// 終了確認ダイアログが消える
		await expect(exitDlg).toBeHidden();

		// TutorialBubble が再表示される
		await expect(bubble).toBeVisible({ timeout: 5_000 });

		// チュートリアル続行可能 (次へボタンが押せる)
		const nextBtn = bubble.locator('button:has-text("次へ")');
		await expect(nextBtn).toBeVisible();
	});

	test('AC6: 「終了する」(確定) → チュートリアル終了 (overlay / bubble 共に dismiss)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoPageWithRestartBtn(page);

		const { exitDlg, bubble } = await startTutorialAndOpenExitConfirm(page);

		// 「終了する」(確定) クリック
		const confirmBtn = exitDlg.locator('button:has-text("終了する")');
		await confirmBtn.waitFor({ state: 'visible' });
		await confirmBtn.click();

		// 終了確認ダイアログが消える
		await expect(exitDlg).toBeHidden();

		// TutorialBubble / overlay が消える
		await expect(bubble).toBeHidden();
		await expect(page.locator('.tutorial-overlay')).toBeHidden();
	});

	test('AC4 補強: backdrop の二重 click でも exitConfirm が二重表示されない (FSM 排他)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoPageWithRestartBtn(page);

		const { exitDlg } = await startTutorialAndOpenExitConfirm(page);

		// もう一度 backdrop を click しようとする (exitConfirm 表示中)
		// ただし overlay 自体が hidden になっているため click は failure になる可能性あり。
		// dispatchEvent で強制的に handleOverlayClick を発火させる。
		await page.evaluate(() => {
			const bg = document.querySelector('.tutorial-overlay-bg');
			if (bg) {
				const ev = new MouseEvent('click', { bubbles: true });
				bg.dispatchEvent(ev);
			}
		});

		// exitDlg は引き続き 1 件のみ visible (重複表示なし)
		const exitDialogs = page
			.locator('[role="dialog"]')
			.filter({ hasText: 'チュートリアルを終了しますか' });
		await expect(exitDialogs).toHaveCount(1);
		await expect(exitDlg).toBeVisible();
	});
});
