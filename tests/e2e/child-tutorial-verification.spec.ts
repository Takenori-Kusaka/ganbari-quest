// tests/e2e/child-tutorial-verification.spec.ts
// #2393 (PR #2388 admin v1 tutorial 撤去 follow-up):
// 子供画面 (CHILD_TUTORIAL_CHAPTERS) で全ステップ動作 + SS 撮影 E2E。
//
// 旧 tests/e2e/tutorial-verification.spec.ts の代替:
//   - 旧 spec は /admin で 6 chapter × 19 step を desktop + mobile で撮影 + 検証
//   - 本 spec は子供画面 4 chapter × 9 step を 4 年齢モード (preschool/elementary/junior/senior) で撮影
//   - admin v1 tutorial 撤去 (PR #2388) で旧 spec は到達不能化、子供画面 spec として再構築
//
// AC4 (全ステップ動作): chapter 1〜4 を順次進行 → 最後のステップで「完了」ボタンで終了
// AC5 (バブル表示): 各ステップで TutorialBubble が visible (selector 不在は中央表示 fallback)
// AC6 (全ステップ SS): docs/screenshots/2393-child-tutorial-verification/<mode>/step-N.png
// AC7 (twin dialog 回避): 各ステップで .tutorial-bubble は 1 件のみ
//
// 実行: npx playwright test tests/e2e/child-tutorial-verification.spec.ts

import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const SCREENSHOT_DIR = path.resolve('docs/screenshots/2393-child-tutorial-verification');
const MODES = ['preschool', 'elementary', 'junior', 'senior'] as const;

/** CHILD_TUTORIAL_CHAPTERS = 4 chapter × 合計 9 step (cf. tutorial-chapters-child.ts) */
const EXPECTED_TOTAL_STEPS = 9;

/**
 * /switch から指定 mode の子供を選択して home に遷移する。
 * 詳細は child-tutorial-dialog-screenshots.spec.ts の同名関数を参照。
 */
async function gotoChildHome(page: Page, uiMode: string) {
	await page.goto('/switch', { waitUntil: 'domcontentloaded' });
	const childButtons = page.locator('[data-testid^="child-select-"]');
	await childButtons.first().waitFor({ state: 'visible', timeout: 15_000 });
	const count = await childButtons.count();
	let arrived = false;
	for (let i = 0; i < count; i++) {
		if (i > 0) {
			await page.goto('/switch', { waitUntil: 'domcontentloaded' });
			await childButtons.first().waitFor({ state: 'visible', timeout: 15_000 });
		}
		await childButtons.nth(i).click();
		try {
			await page.waitForURL(new RegExp(`/${uiMode}(/|$)`), { timeout: 5_000 });
			await page.locator('[data-testid="header-help-btn"]').waitFor({
				state: 'visible',
				timeout: 10_000,
			});
			arrived = true;
			break;
		} catch {
			// 別 mode → 次を試す
		}
	}
	if (!arrived) {
		throw new Error(`[gotoChildHome] uiMode=${uiMode} の子供が seed に存在しない`);
	}
	await dismissChildHomeOverlays(page);
	await page.evaluate(() => {
		localStorage.removeItem('tutorial-progress-chapter');
		localStorage.removeItem('tutorial-progress-step');
	});
}

/**
 * 子供 home 到達時に auto-open する複数 overlay を best-effort dismiss + pointer-events 抑制で
 * tutorial 起動を妨げないようにする。詳細は child-tutorial-dialog-screenshots.spec.ts 参照。
 */
async function dismissChildHomeOverlays(page: Page) {
	const candidates: Array<() => ReturnType<Page['locator']>> = [
		() => page.getByTestId('login-bonus-confirm'),
		() => page.getByTestId('pin-gate-onboarding-close'),
		() => page.getByTestId('weekly-redeem-confirm'),
		() => page.locator('button:has-text("うれしい！")'),
		() => page.locator('button:has-text("ありがとう！")'),
		() => page.locator('button:has-text("やったね！")'),
	];
	for (let pass = 0; pass < 5; pass++) {
		let anyDismissed = false;
		for (const getCandidate of candidates) {
			const c = getCandidate();
			if (
				await c
					.first()
					.isVisible({ timeout: 300 })
					.catch(() => false)
			) {
				await c
					.first()
					.click({ force: true, timeout: 2_000 })
					.catch(() => {});
				anyDismissed = true;
			}
		}
		if (!anyDismissed) break;
	}
	await page.addStyleTag({
		content: `
			[data-scope="dialog"][data-part="positioner"],
			[data-scope="dialog"][data-part="backdrop"],
			[data-scope="dialog"][data-part="content"],
			[data-testid="stamp-press-overlay"],
			.sibling-cheer-overlay,
			.parent-message-overlay {
				pointer-events: none !important;
			}
			[data-testid="tutorial-resume-dialog"],
			[data-testid="tutorial-resume-dialog"] *,
			[data-testid="tutorial-exit-confirm-dialog"],
			[data-testid="tutorial-exit-confirm-dialog"] *,
			[data-testid="tutorial-quick-complete-dialog"],
			[data-testid="tutorial-quick-complete-dialog"] * {
				pointer-events: auto !important;
			}
		`,
	});
}

/** ファイル名に使えない文字を除去 */
function sanitize(s: string): string {
	return s
		.replace(/[/\\?%*:|"<>]/g, '')
		.replace(/\s+/g, '-')
		.slice(0, 40);
}

/** bubble の bubble-appear animation 完了を待つ (#1259 waitForTimeout 代替) */
async function waitForBubbleAnimations(bubble: ReturnType<Page['locator']>) {
	await bubble.evaluate((el) =>
		Promise.all(
			(el as HTMLElement).getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
		),
	);
}

// mobile project からの実行は `playwright.config.ts` の mobile.testIgnore で除外済 (#2393)。
test.describe('#2393 子供画面 CHILD_TUTORIAL_CHAPTERS 全ステップ検証', () => {
	test.setTimeout(180_000);

	for (const uiMode of MODES) {
		test(`${uiMode}: 全ステップ進行 + SS 撮影 + AC5/AC6/AC7 検証`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);

			// チュートリアル起動 (force: true で auto-open dialog 被さりを無視)
			await page.locator('[data-testid="header-help-btn"]').click({ force: true });
			// tutorial active flag を待つ (cheer overlay の backdrop と衝突しない)
			await page.waitForSelector('html[data-tutorial-active]', { timeout: 10_000 });

			let stepNum = 0;
			const maxSteps = 15; // 無限ループ防止 (実 step 9 + 余裕)

			while (stepNum < maxSteps) {
				stepNum++;

				const bubble = page.locator('.tutorial-bubble');
				await bubble.waitFor({ state: 'visible', timeout: 10_000 });
				await waitForBubbleAnimations(bubble);

				// AC7: bubble は 1 件のみ (FSM 排他 + showQuickComplete/showExitConfirm の二重表示なし)
				await expect(page.locator('.tutorial-bubble')).toHaveCount(1);

				// ステップ情報を取得
				const title = (await bubble.locator('.tutorial-title').textContent()) ?? '';
				const progress = (await bubble.locator('.tutorial-progress-text').textContent()) ?? '';

				console.log(`[${uiMode} Step ${stepNum}] ${title} (${progress})`);

				// AC6: SS 撮影
				await page.screenshot({
					path: path.join(
						SCREENSHOT_DIR,
						uiMode,
						`step-${String(stepNum).padStart(2, '0')}-${sanitize(title)}.png`,
					),
					fullPage: false,
				});

				// AC5: バブルがビューポート内に収まっているか
				const bubbleBox = await bubble.boundingBox();
				expect(bubbleBox, `[${uiMode} Step ${stepNum}] バブルが描画されている`).not.toBeNull();
				if (bubbleBox) {
					expect(
						bubbleBox.x,
						`[${uiMode} Step ${stepNum}] バブル左端がビューポート内`,
					).toBeGreaterThanOrEqual(0);
					expect(
						bubbleBox.x + bubbleBox.width,
						`[${uiMode} Step ${stepNum}] バブル右端がビューポート内`,
					).toBeLessThanOrEqual(1280);
				}

				// 「次へ」「完了」ボタンで進行 (年齢帯別ラベル対応)
				// preschool/baby (isYoungTier=true) = 「つぎへ」/「おしまい！」
				// elementary/junior/senior = 「次へ」/「完了！」
				// (UI_COMPONENTS_LABELS.tutorialBubbleNext / src/lib/domain/labels.ts)
				const nextBtn = bubble.locator('.tutorial-nav-next');
				await expect(nextBtn).toBeVisible();
				const btnText = (await nextBtn.textContent()) ?? '';
				// 最終ステップ判定: 漢字「完了」または ひらがな「おしまい」のいずれかを含む
				const isLastStep = btnText.includes('完了') || btnText.includes('おしまい');

				await nextBtn.click();

				if (isLastStep) {
					// AC4: 最後のステップで overlay が dismiss される
					await expect(page.locator('.tutorial-overlay')).toBeHidden({ timeout: 5_000 });
					console.log(`[${uiMode} Complete] 全 ${stepNum} ステップ完了`);
					break;
				}
			}

			// AC4 / AC6: CHILD_TUTORIAL_CHAPTERS の総 step 数と一致
			//   (子供 tutorial は isParentChapters=false で quickMode 非発火、必ず全 step 通過)
			expect(
				stepNum,
				`[${uiMode}] CHILD_TUTORIAL_CHAPTERS 全 ${EXPECTED_TOTAL_STEPS} step が再生される`,
			).toBe(EXPECTED_TOTAL_STEPS);
		});
	}
});
