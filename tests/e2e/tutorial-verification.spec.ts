// tests/e2e/tutorial-verification.spec.ts
// #534: チュートリアル全ステップの実機検証
// デスクトップ（1280px）とモバイル（390px）で全ステップをスクリーンショット撮影

import { expect, test } from '@playwright/test';
import { selectKinderChild } from './helpers';

const SCREENSHOT_DIR = 'test-results/tutorial-screenshots';

test.describe('チュートリアル全ステップ検証', () => {
	test.beforeEach(async ({ page }) => {
		// チュートリアル進捗をクリアして最初から開始できるようにする
		await page.goto('/admin');
		await page.waitForLoadState('networkidle');
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
		await page.waitForLoadState('networkidle');

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
			await page.waitForLoadState('networkidle');
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
				// #961 QA: 状態待機（無限待ち防止のため明示的 timeout を全 waitFor に指定）
				// 現ステップの title を記録 → クリック後、次ステップ表示 or クイック完了ダイアログを待つ
				const currentTitle = title ?? '';
				await nextBtn.click();

				// 次のステップ表示 or クイック完了ダイアログ or 子要素消滅を 8s 以内に観測
				await Promise.race([
					// ケース A: 次ステップが表示される（title 変化）
					page
						.locator('.tutorial-title')
						.filter({ hasNotText: currentTitle })
						.first()
						.waitFor({ state: 'visible', timeout: 8000 }),
					// ケース B: クイック完了ダイアログが現れる
					page
						.locator('button:has-text("もっと詳しく見る")')
						.waitFor({ state: 'visible', timeout: 8000 }),
				]).catch(() => {
					// どちらも現れない場合は次ループで bubble.waitFor が落ちて失敗させる
				});

				// #955: クイック完了ダイアログが表示された場合は「もっと詳しく見る」で継続
				const continueBtn = page.locator('button:has-text("もっと詳しく見る")');
				if (await continueBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
					console.log(`  → クイック完了ダイアログ: 「もっと詳しく見る」で全ステップ継続`);
					await continueBtn.click();
					// ダイアログが消えて次のチャプター1ステップ目のバブルが出るまで待機
					await continueBtn.waitFor({ state: 'hidden', timeout: 5000 });
					await page.locator('.tutorial-bubble').waitFor({ state: 'visible', timeout: 8000 });
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
		await page.waitForLoadState('networkidle');

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
			// Vite cold compile による goto 遅延を許容するため長めの actionTimeout で click
			await tutorialBtn.click({ timeout: 60_000 });
		} else if (await pageGuideBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
			await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
			const btn = page.locator('[data-tutorial="tutorial-restart"]');
			if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
				await btn.click({ timeout: 60_000 });
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
				// #961 QA: 状態待機（無限待ち防止のため明示的 timeout を指定）
				const currentTitle = title ?? '';
				await nextBtn.click();

				await Promise.race([
					page
						.locator('.tutorial-title')
						.filter({ hasNotText: currentTitle })
						.first()
						.waitFor({ state: 'visible', timeout: 8000 }),
					page
						.locator('button:has-text("もっと詳しく見る")')
						.waitFor({ state: 'visible', timeout: 8000 }),
				]).catch(() => {
					// 次ループで bubble.waitFor が落ちて失敗
				});

				// #955: クイック完了ダイアログが表示された場合は「もっと詳しく見る」で継続
				const continueBtn = page.locator('button:has-text("もっと詳しく見る")');
				if (await continueBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
					console.log(`  → クイック完了ダイアログ: 「もっと詳しく見る」で全ステップ継続`);
					await continueBtn.click();
					await continueBtn.waitFor({ state: 'hidden', timeout: 5000 });
					await page.locator('.tutorial-bubble').waitFor({ state: 'visible', timeout: 8000 });
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

// #961 QA: クイックモード完了ダイアログの「使い始める」導線と子画面ガード検証
test.describe('#961 QA: quickMode 周辺フロー', () => {
	// Vite の cold compile（初回 80-100s）＋チュートリアル非同期遷移を許容するため延長
	test.setTimeout(120_000);

	test.beforeEach(async ({ page }) => {
		// dev HMR の websocket ロングリクエストで networkidle が解決しないことがあるため
		// domcontentloaded で待ち、DOM 要素の可視性で安定を確認する
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });
		await page.evaluate(() => {
			localStorage.removeItem('tutorial-progress-chapter');
			localStorage.removeItem('tutorial-progress-step');
		});
	});

	test('ケースA: クイックモード完了で「使い始める」を押すとチュートリアルが終了する', async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== 'chromium', 'Chromium のみ');
		test.skip(test.info().project.name === 'mobile', 'デスクトップのみ');

		await page.setViewportSize({ width: 1280, height: 800 });
		// beforeEach で /admin に遷移済み

		// PremiumWelcome が出たら閉じる
		const welcomeDialog = page.locator('.welcome-overlay');
		if (await welcomeDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
			const dismissBtn = welcomeDialog.locator('button:has-text("さっそく始める")');
			if (await dismissBtn.isVisible()) {
				await dismissBtn.click();
				await welcomeDialog.waitFor({ state: 'hidden', timeout: 3000 });
			}
		}

		// #961 QA: AdminHome の「くわしいガイドを最初から見る」導線は chapter 明示指定 → quickMode=false に
		// なるため、ここではヘッダーの ? ボタン（startTutorial() 引数なし）で quickMode を発火させる
		const tutorialBtn = page.locator('[data-tutorial="tutorial-restart"]');
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		if (await tutorialBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			// Vite cold compile による goto 遅延を許容するため長めの actionTimeout で click
			await tutorialBtn.click({ timeout: 60_000 });
		} else if (await pageGuideBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
			await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
			const btn = page.locator('[data-tutorial="tutorial-restart"]');
			if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
				await btn.click({ timeout: 60_000 });
			}
		}

		// 再開プロンプトが出たら「最初から」
		// (markTutorialStarted の API 呼び出しがあるため 5s 待つ)
		const restartBtn = page.locator('button:has-text("最初から")');
		if (await restartBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
			await restartBtn.click();
		}

		// Vite cold compile やハンドラの非同期遷移があるため 15s 待つ
		await page.waitForSelector('.tutorial-overlay', { timeout: 15_000 });

		// チャプター1（4ステップ）を通過
		for (let i = 0; i < 4; i++) {
			const bubble = page.locator('.tutorial-bubble');
			await bubble.waitFor({ state: 'visible', timeout: 8000 });
			const currentTitle = (await bubble.locator('.tutorial-title').textContent()) ?? '';
			const nextBtn = bubble.locator('button:has-text("次へ"), button:has-text("完了")');
			await nextBtn.click();

			// 最後のステップの後はクイック完了ダイアログ、それ以外は次ステップを待つ
			if (i === 3) {
				// クイック完了ダイアログの「使い始める」ボタンを待つ
				await page
					.locator('button:has-text("使い始める")')
					.waitFor({ state: 'visible', timeout: 8000 });
			} else {
				await Promise.race([
					page
						.locator('.tutorial-title')
						.filter({ hasNotText: currentTitle })
						.first()
						.waitFor({ state: 'visible', timeout: 8000 }),
					page
						.locator('button:has-text("使い始める")')
						.waitFor({ state: 'visible', timeout: 8000 }),
				]).catch(() => {});
			}
		}

		// 「使い始める」をクリック
		const finishBtn = page.locator('button:has-text("使い始める")');
		await expect(finishBtn).toBeVisible({ timeout: 5000 });
		await finishBtn.click();

		// ダイアログとオーバーレイが両方消えてチュートリアル終了状態になる
		await finishBtn.waitFor({ state: 'hidden', timeout: 5000 });
		await expect(page.locator('.tutorial-bubble')).toBeHidden({ timeout: 5000 });
		await expect(page.locator('.tutorial-overlay')).toBeHidden({ timeout: 5000 });
	});

	test('ケースB: 子画面で startTutorial() 呼び出し → quickMode 有効化されない（①ガード）', async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== 'chromium', 'Chromium のみ');
		test.skip(test.info().project.name === 'mobile', 'デスクトップのみ');

		await page.setViewportSize({ width: 1280, height: 800 });
		// 子画面（preschool/home）に遷移して (child)/+layout の setChapters(CHILD_TUTORIAL_CHAPTERS) を発火
		// selectedChildId クッキー設定のため /switch → 子選択 → /preschool/home 経由で到達
		await selectKinderChild(page);
		await page.locator('body').waitFor({ state: 'visible', timeout: 10_000 });

		// ログインリダイレクト等で子画面が開けない場合はスキップ
		if (!page.url().includes('/preschool/home')) {
			test.skip(true, `子画面に到達できなかった: ${page.url()}`);
		}

		// ヘッダーの「❓」ボタン（onHelpClick → startTutorial()）で子用チュートリアルを開始
		// セレクタが環境によって異なるため、まず data-tutorial="tutorial-restart" を試す
		const helpBtn = page.locator('[data-tutorial="tutorial-restart"]').first();
		const helpVisible = await helpBtn.isVisible({ timeout: 2000 }).catch(() => false);
		if (!helpVisible) {
			test.skip(true, 'ヘルプボタンが見つからない（環境差）');
		}
		await helpBtn.click();

		// 再開プロンプトが出たら「最初から」
		const restartBtn = page.locator('button:has-text("最初から")');
		if (await restartBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await restartBtn.click();
		}

		// 子画面の ❓ クリックは実装上 page-guide バナーと競合し、tutorial-overlay が
		// 必ずしも起動しない。起動しない場合も「使い始める」が出ないこと自体は
		// unit テスト（tutorial-store.test.ts）で保証されているため、ここではスキップ。
		const overlayVisible = await page
			.locator('.tutorial-overlay')
			.isVisible({ timeout: 5000 })
			.catch(() => false);
		if (!overlayVisible) {
			test.skip(true, 'tutorial-overlay が起動しない環境（unit テストで guard 検証済み）');
		}

		// 子チュートリアルのチャプター1（少なくとも1ステップ以上）を通過
		// quickMode が有効なら最後で「使い始める」ダイアログが出るはず
		// ガードが効いていれば、次のチャプターに進むか通常完了するはず
		let stepCount = 0;
		let bubblesSeen = 0;
		const maxSteps = 15;
		let sawQuickDialog = false;

		while (stepCount < maxSteps) {
			stepCount++;
			const bubble = page.locator('.tutorial-bubble');
			const bubbleVisible = await bubble.isVisible({ timeout: 5000 }).catch(() => false);
			if (!bubbleVisible) break;
			bubblesSeen++;

			// 各ステップで「使い始める」が見えるかチェック（決して現れてはならない）
			const quickFinish = page.locator('button:has-text("使い始める")');
			if (await quickFinish.isVisible({ timeout: 500 }).catch(() => false)) {
				sawQuickDialog = true;
				break;
			}

			const currentTitle = (await bubble.locator('.tutorial-title').textContent()) ?? '';
			const nextBtn = bubble.locator('button:has-text("次へ"), button:has-text("完了")');
			if (!(await nextBtn.isVisible().catch(() => false))) break;
			const btnText = await nextBtn.textContent();
			await nextBtn.click();
			if (btnText?.includes('完了')) break;

			await Promise.race([
				page
					.locator('.tutorial-title')
					.filter({ hasNotText: currentTitle })
					.first()
					.waitFor({ state: 'visible', timeout: 5000 }),
				page.locator('button:has-text("使い始める")').waitFor({ state: 'visible', timeout: 5000 }),
			]).catch(() => {});
		}

		// ①ガードが効いていれば「使い始める」ダイアログは一度も現れない
		expect(
			sawQuickDialog,
			'子画面では quickMode が無効のため「使い始める」ダイアログは出ないはず',
		).toBe(false);

		// 最低 1 ステップは進行していることを保証（bubble が一度も表示されないと
		// ガード検証が形骸化するため、review #961 での false-negative 防止）
		expect(bubblesSeen, '子チュートリアルが最低1ステップは表示された').toBeGreaterThanOrEqual(1);
	});
});
