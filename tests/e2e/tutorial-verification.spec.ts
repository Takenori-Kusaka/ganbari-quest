// tests/e2e/tutorial-verification.spec.ts
// #534: チュートリアル全ステップの実機検証
// デスクトップ（1280px）とモバイル（390px）で全ステップをスクリーンショット撮影

import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = 'test-results/tutorial-screenshots';

test.describe('チュートリアル全ステップ検証', () => {
	test.beforeEach(async ({ page }) => {
		// チュートリアル進捗をクリアして最初から開始できるようにする
		await page.goto('/admin');
		await page.evaluate(() => {
			localStorage.removeItem('tutorial-progress-chapter');
			localStorage.removeItem('tutorial-progress-step');
		});
	});

	test('デスクトップ: 全ステップのスクリーンショット撮影と検証', async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'デスクトップはChromiumのみ');
		test.skip(test.info().project.name === 'mobile', 'デスクトップテストはtabletプロジェクトのみ');

		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin');

		// PremiumWelcome ダイアログが表示されている場合は先に閉じる
		const welcomeDialog = page.locator('.welcome-overlay');
		if (await welcomeDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
			const dismissBtn = welcomeDialog.locator('button:has-text("さっそく始める")');
			if (await dismissBtn.isVisible()) {
				await dismissBtn.click();
				await welcomeDialog.waitFor({ state: 'hidden', timeout: 3000 });
			}
		}

		// チュートリアル開始ボタン（ヘッダーの ? ボタン）をクリック
		// PageGuide 対応ページでは tutorial-restart が非表示のため、page-guide-btn も考慮
		const tutorialBtn = page.locator('[data-tutorial="tutorial-restart"]');
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		if (await tutorialBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await tutorialBtn.click();
		} else if (await pageGuideBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
			// PageGuide 対応ページ: ガイドなしページに移動してチュートリアルボタンを探す
			await page.goto('/admin/license');
			const btn = page.locator('[data-tutorial="tutorial-restart"]');
			if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
				await btn.click();
			}
		} else {
			// バナーから開始
			const startBtn = page.locator('[data-tutorial="tutorial-banner"] button:has-text("開始")');
			if (await startBtn.isVisible()) {
				await startBtn.click();
			}
		}

		// 再開プロンプトが出た場合は「最初から」を選択
		const restartBtn = page.locator('button:has-text("最初から")');
		if (await restartBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await restartBtn.click();
		}

		// チュートリアルオーバーレイが表示されるまで待機
		await page.waitForSelector('.tutorial-overlay', { timeout: 5000 });

		let stepNum = 0;
		const maxSteps = 30; // 無限ループ防止

		while (stepNum < maxSteps) {
			stepNum++;

			// バブルが表示されるまで待機（ページ遷移+MutationObserver+アニメーション考慮）
			const bubble = page.locator('.tutorial-bubble');
			await bubble.waitFor({ state: 'visible', timeout: 8000 });

			// ステップ情報を取得
			const title = await bubble.locator('.tutorial-title').textContent();
			const _description = await bubble.locator('.tutorial-description').textContent();
			const progress = await bubble.locator('.tutorial-progress-text').textContent();

			console.log(`[Step ${stepNum}] ${title} (${progress})`);

			// スクリーンショット撮影
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/desktop-step-${String(stepNum).padStart(2, '0')}-${sanitize(title ?? '')}.png`,
				fullPage: false,
			});

			// 検証1: バブルがビューポート内に収まっているか
			const bubbleBox = await bubble.boundingBox();
			expect(bubbleBox, `Step ${stepNum}: バブルが表示されている`).not.toBeNull();
			if (bubbleBox) {
				expect(bubbleBox.x, `Step ${stepNum}: バブル左端がビューポート内`).toBeGreaterThanOrEqual(
					0,
				);
				expect(
					bubbleBox.x + bubbleBox.width,
					`Step ${stepNum}: バブル右端がビューポート内`,
				).toBeLessThanOrEqual(1280);
				expect(bubbleBox.y, `Step ${stepNum}: バブル上端がビューポート内`).toBeGreaterThanOrEqual(
					0,
				);
				expect(
					bubbleBox.y + bubbleBox.height,
					`Step ${stepNum}: バブル下端がビューポート内`,
				).toBeLessThanOrEqual(800);
			}

			// 検証2: スポットライトリングが表示されているか（セレクタありステップのみ）
			const ring = page.locator('.tutorial-spotlight-ring');
			const ringVisible = await ring.isVisible();

			if (ringVisible) {
				const ringBox = await ring.boundingBox();
				if (ringBox && bubbleBox) {
					// 検証3: スポットライトとバブルが重なっていないか
					const overlaps =
						bubbleBox.x < ringBox.x + ringBox.width &&
						bubbleBox.x + bubbleBox.width > ringBox.x &&
						bubbleBox.y < ringBox.y + ringBox.height &&
						bubbleBox.y + bubbleBox.height > ringBox.y;

					if (overlaps) {
						console.warn(`  ⚠️ Step ${stepNum} "${title}": バブルとスポットライトが重なっている`);
					}
				}
			}

			// 検証4: ボトムナビがバブルに被っていないか（デスクトップでは非表示だが念のため）
			const bottomNav = page.locator('[data-tutorial="nav-primary"]');
			if (await bottomNav.isVisible()) {
				const navBox = await bottomNav.boundingBox();
				if (navBox && bubbleBox) {
					const navOverlap =
						bubbleBox.y + bubbleBox.height > navBox.y && bubbleBox.y < navBox.y + navBox.height;
					expect(navOverlap, `Step ${stepNum}: バブルがボトムナビに被っていない`).toBe(false);
				}
			}

			// 「次へ」ボタンで次のステップへ
			const nextBtn = bubble.locator('button:has-text("次へ"), button:has-text("完了")');
			if (await nextBtn.isVisible()) {
				const btnText = await nextBtn.textContent();
				if (btnText?.includes('完了')) {
					// 最後のステップ
					await nextBtn.click();
					console.log(`[Complete] 全 ${stepNum} ステップ完了`);
					break;
				}
				await nextBtn.click();

				// #955 / #1259: クイック完了ダイアログが出るまで 2.5s polling で待つ (出なければ次ループ先頭の bubble.waitFor が担保)
				const continueBtn = page.locator('button:has-text("もっと詳しく見る")');
				if (await continueBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
					console.log(`  → クイック完了ダイアログ: 「もっと詳しく見る」で全ステップ継続`);
					await continueBtn.click();
					// 次のバブル出現は次ループ先頭で待機
				}
			} else {
				console.log(`[End] 次へボタンが見つからない (step ${stepNum})`);
				break;
			}
		}

		expect(stepNum, '少なくとも5ステップ以上あること').toBeGreaterThanOrEqual(5);
	});

	test('モバイル: 全ステップのスクリーンショット撮影と検証', async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'モバイルはChromiumのみ');
		test.skip(test.info().project.name !== 'mobile', 'モバイルテストはmobileプロジェクトのみ');

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/admin');

		// PremiumWelcome ダイアログが表示されている場合は先に閉じる
		const welcomeDialog = page.locator('.welcome-overlay');
		if (await welcomeDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
			const dismissBtn = welcomeDialog.locator('button:has-text("さっそく始める")');
			if (await dismissBtn.isVisible()) {
				await dismissBtn.click();
				await welcomeDialog.waitFor({ state: 'hidden', timeout: 3000 });
			}
		}

		// チュートリアル開始（PageGuide 対応ページでは tutorial-restart が非表示のため考慮）
		const tutorialBtn = page.locator('[data-tutorial="tutorial-restart"]');
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		if (await tutorialBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await tutorialBtn.click();
		} else if (await pageGuideBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
			await page.goto('/admin/license');
			const btn = page.locator('[data-tutorial="tutorial-restart"]');
			if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
				await btn.click();
			}
		}

		const restartBtn = page.locator('button:has-text("最初から")');
		if (await restartBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await restartBtn.click();
		}

		await page.waitForSelector('.tutorial-overlay', { timeout: 5000 });

		let stepNum = 0;
		const maxSteps = 30;

		while (stepNum < maxSteps) {
			stepNum++;

			const bubble = page.locator('.tutorial-bubble');
			await bubble.waitFor({ state: 'visible', timeout: 8000 });

			const title = await bubble.locator('.tutorial-title').textContent();
			const progress = await bubble.locator('.tutorial-progress-text').textContent();
			console.log(`[Mobile Step ${stepNum}] ${title} (${progress})`);

			await page.screenshot({
				path: `${SCREENSHOT_DIR}/mobile-step-${String(stepNum).padStart(2, '0')}-${sanitize(title ?? '')}.png`,
				fullPage: false,
			});

			// モバイル固有検証: バブルがビューポート内に収まっているか
			const bubbleBox = await bubble.boundingBox();
			expect(bubbleBox, `Mobile Step ${stepNum}: バブルが表示されている`).not.toBeNull();
			if (bubbleBox) {
				expect(bubbleBox.x, `Mobile Step ${stepNum}: 左端`).toBeGreaterThanOrEqual(0);
				expect(bubbleBox.x + bubbleBox.width, `Mobile Step ${stepNum}: 右端`).toBeLessThanOrEqual(
					390,
				);
			}

			// モバイル固有検証: ボトムナビとバブルの重なり
			const bottomNav = page.locator('[data-tutorial="nav-primary"]');
			if (await bottomNav.isVisible()) {
				const navBox = await bottomNav.boundingBox();
				if (navBox && bubbleBox) {
					const navOverlap =
						bubbleBox.y + bubbleBox.height > navBox.y && bubbleBox.y < navBox.y + navBox.height;
					expect(
						navOverlap,
						`Mobile Step ${stepNum} "${title}": バブルがボトムナビに被っていない`,
					).toBe(false);
				}
			}

			const nextBtn = bubble.locator('button:has-text("次へ"), button:has-text("完了")');
			if (await nextBtn.isVisible()) {
				const btnText = await nextBtn.textContent();
				if (btnText?.includes('完了')) {
					await nextBtn.click();
					console.log(`[Mobile Complete] 全 ${stepNum} ステップ完了`);
					break;
				}
				await nextBtn.click();

				// #955 / #1259: クイック完了ダイアログが出るまで 2.5s polling で待つ (出なければ次ループ先頭の bubble.waitFor が担保)
				const continueBtn = page.locator('button:has-text("もっと詳しく見る")');
				if (await continueBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
					console.log(`  → クイック完了ダイアログ: 「もっと詳しく見る」で全ステップ継続`);
					await continueBtn.click();
					// 次のバブル出現は次ループ先頭で待機
				}
			} else {
				break;
			}
		}

		expect(stepNum, 'モバイルでも5ステップ以上').toBeGreaterThanOrEqual(5);
	});
});

/** ファイル名に使えない文字を除去 */
function sanitize(s: string): string {
	return s
		.replace(/[/\\?%*:|"<>]/g, '')
		.replace(/\s+/g, '-')
		.slice(0, 40);
}
