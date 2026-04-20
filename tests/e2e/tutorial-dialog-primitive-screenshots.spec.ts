// tests/e2e/tutorial-dialog-primitive-screenshots.spec.ts
// #1192 / PR #1225: TutorialQuickCompleteDialog の 3 ダイアログの視覚証跡を撮影する E2E
// 実行: npx playwright test tests/e2e/tutorial-dialog-primitive-screenshots.spec.ts --project=tablet
// 出力: docs/screenshots/1192-tutorial-dialog-primitive/
//
// 注意: tutorial-verification.spec.ts の動作パターンに準拠
// - page.goto の既定 waitUntil='load' + dismissWelcome + restartBtn.waitFor で同期
// - welcome-overlay の先行ディスミス
// - .tutorial-overlay 出現待ち

import path from 'node:path';
import { test } from '@playwright/test';

const OUT = path.resolve('docs/screenshots/1192-tutorial-dialog-primitive');

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
 */
async function gotoPageWithRestartBtn(page: import('@playwright/test').Page) {
	await page.goto('/admin/license');
	await dismissWelcome(page);
}

test.describe('#1192 TutorialQuickCompleteDialog 3 ダイアログ撮影', () => {
	test.setTimeout(120_000);

	test('01 Resume prompt', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoPageWithRestartBtn(page);

		// 保存進捗をセットし reload → resume prompt を発火させる
		await page.evaluate(() => {
			localStorage.setItem('tutorial-progress-chapter', '2');
			localStorage.setItem('tutorial-progress-step', '0');
		});
		await page.reload();
		await dismissWelcome(page);

		const restartBtn = page.locator('[data-tutorial="tutorial-restart"]').first();
		await restartBtn.waitFor({ state: 'visible', timeout: 15_000 });
		await restartBtn.click();

		// Resume prompt の dialog を text ベースで取得 (data-testid propagation 不確実)
		const resume = page.locator('[role="dialog"]').filter({ hasText: '前回の途中から続けますか' });
		await resume.waitFor({ state: 'visible', timeout: 10_000 });
		await page.waitForTimeout(400);
		await page.screenshot({
			path: path.join(OUT, '01-resume-prompt.png'),
			fullPage: false,
		});
	});

	test('02 Quick complete', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoPageWithRestartBtn(page);
		await page.evaluate(() => {
			localStorage.removeItem('tutorial-progress-chapter');
			localStorage.removeItem('tutorial-progress-step');
		});

		const restartBtn = page.locator('[data-tutorial="tutorial-restart"]').first();
		await restartBtn.waitFor({ state: 'visible', timeout: 15_000 });
		await restartBtn.click();

		// overlay 出現待ち
		await page.waitForSelector('.tutorial-overlay', { state: 'visible', timeout: 10_000 });

		const qcLocator = page
			.locator('[role="dialog"]')
			.filter({ hasText: '基本の使い方を確認しました' });

		// tutorial-verification と同じパターンで chapter1 を完走
		const maxSteps = 30;
		for (let i = 0; i < maxSteps; i++) {
			if (await qcLocator.isVisible({ timeout: 500 }).catch(() => false)) break;

			const bubble = page.locator('.tutorial-bubble');
			const bubbleVisible = await bubble.isVisible({ timeout: 1500 }).catch(() => false);
			if (!bubbleVisible) break;

			const nextBtn = bubble.locator('button:has-text("次へ"), button:has-text("完了")');
			if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
				await nextBtn.click();
				await page.waitForTimeout(500);
			} else {
				break;
			}
		}

		await qcLocator.waitFor({ state: 'visible', timeout: 10_000 });
		await page.waitForTimeout(400);
		await page.screenshot({
			path: path.join(OUT, '02-quick-complete.png'),
			fullPage: false,
		});
	});

	test('03 Exit confirm', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoPageWithRestartBtn(page);
		await page.evaluate(() => {
			localStorage.removeItem('tutorial-progress-chapter');
			localStorage.removeItem('tutorial-progress-step');
		});

		const restartBtn = page.locator('[data-tutorial="tutorial-restart"]').first();
		await restartBtn.waitFor({ state: 'visible', timeout: 15_000 });
		await restartBtn.click();

		// overlay 出現待ち → 背景クリックで exitConfirm 発火
		await page.waitForSelector('.tutorial-overlay-bg', { state: 'visible', timeout: 10_000 });
		await page.locator('.tutorial-overlay-bg').click({ position: { x: 20, y: 20 } });

		const exitDlg = page
			.locator('[role="dialog"]')
			.filter({ hasText: 'チュートリアルを終了しますか' });
		await exitDlg.waitFor({ state: 'visible', timeout: 10_000 });
		await page.waitForTimeout(400);
		await page.screenshot({
			path: path.join(OUT, '03-exit-confirm.png'),
			fullPage: false,
		});
	});
});
