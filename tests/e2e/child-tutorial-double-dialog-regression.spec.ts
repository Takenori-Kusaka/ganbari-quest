// tests/e2e/child-tutorial-double-dialog-regression.spec.ts
// #2393 (PR #2388 admin v1 tutorial 撤去 follow-up):
// 子供画面 (CHILD_TUTORIAL_CHAPTERS) での #2105 二重ダイアログ回帰防止 E2E。
//
// 旧 tests/e2e/tutorial-double-dialog-bug-2105.spec.ts の代替:
//   - 旧 spec は /admin/license から v1 TutorialOverlay を起動して dark backdrop click →
//     exit confirm 表示中に TutorialBubble が背景に被っていないか検証していた
//   - 子供画面 (`(child)/+layout.svelte`) は v1 TutorialOverlay を継続稼働するため
//     同じバグ (TutorialOverlay L43 `{#if !showExitConfirm}` ガード) の回帰検証を子供 path で再構築
//
// AC4 / AC7: dark backdrop click → exit confirm dialog のみ表示、TutorialBubble は非表示
// AC5: 「続ける」(キャンセル) → TutorialBubble 再表示 → チュートリアル続行可能
// AC6: 「終了する」(確定) → チュートリアル終了 (overlay / bubble 共に dismiss)
// AC4 補強: backdrop の二重 click でも exitConfirm が二重表示されない (FSM 排他)
//
// 実行: npx playwright test tests/e2e/child-tutorial-double-dialog-regression.spec.ts

import { expect, type Page, test } from '@playwright/test';

const MODES = ['preschool', 'elementary', 'junior', 'senior'] as const;

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
		// activity 記録確認 dialog (`confirm-dialog`) も後発で auto-open しうるため dismiss 対象に追加
		// (#2558 fix で elementary tablet 起動時の干渉として観察された)。cancel button = やめる。
		() => page.getByTestId('confirm-cancel-btn'),
		// #2558 真因 fix: cheer/parent-message dialog の confirm button は Ark UI Dialog 内に
		// あるため `[data-scope="dialog"]` で scope する。素の `button:has-text("ありがとう！")`
		// は activity card (例: 「あいさつした」 triggerHint=「おはよう、ありがとう！」、
		// 「ありがとうとつたえた」 triggerHint=「ありがとう って つたえよう！」) も誤マッチし、
		// click → handleActivityTap → confirm-dialog auto-open → helpBtn click が dialog に
		// intercept される infinite loop が成立する (elementary tablet 全 retry fail の根本原因)。
		() => page.locator('[data-scope="dialog"][data-part="content"] button:has-text("うれしい！")'),
		() => page.locator('[data-scope="dialog"][data-part="content"] button:has-text("ありがとう！")'),
		() => page.locator('[data-scope="dialog"][data-part="content"] button:has-text("やったね！")'),
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

async function startTutorialAndOpenExitConfirm(page: Page) {
	const helpBtn = page.locator('[data-testid="header-help-btn"]');
	await expect(helpBtn).toBeVisible({ timeout: 10_000 });
	// #2558 fix: dispatchEvent('click') で hit-testing をバイパス (詳細は
	// child-tutorial-dialog-screenshots.spec.ts の同名関数コメントを参照)。
	for (let attempt = 0; attempt < 3; attempt++) {
		await helpBtn.dispatchEvent('click');
		try {
			await page.waitForFunction(
				() => document.documentElement.hasAttribute('data-tutorial-active'),
				null,
				{ timeout: 3_000 },
			);
			break;
		} catch {
			// fallthrough → re-dispatch
		}
	}
	// tutorial active flag (data-tutorial-active attr) を待つ。`.tutorial-overlay-bg` は
	// cheer overlay の Dialog backdrop と被る可能性があるため使わない
	await page.waitForSelector('html[data-tutorial-active]', { timeout: 10_000 });
	// bubble 出現待ち (selector 不在ステップは 3s 中央表示 fallback)
	const bubble = page.locator('.tutorial-bubble');
	await bubble.waitFor({ state: 'visible', timeout: 15_000 });

	// dark backdrop click で exitConfirm 発火 (spotlight 外の左上を狙う)
	await page.locator('.tutorial-overlay-bg').click({ position: { x: 20, y: 20 } });

	const exitDlg = page.getByTestId('tutorial-exit-confirm-dialog');
	await expect(exitDlg).toBeVisible({ timeout: 10_000 });
	await exitDlg.evaluate((el) =>
		Promise.all(
			(el as HTMLElement).getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
		),
	);
	return { exitDlg, bubble };
}

// mobile project からの実行は `playwright.config.ts` の mobile.testIgnore で除外済 (#2393)。
test.describe('#2393 / #2105 子供画面ガイドモード二重ダイアログ防止', () => {
	test.setTimeout(60_000);

	for (const uiMode of MODES) {
		test(`${uiMode}: AC4 / AC7 backdrop click → exit confirm のみ表示、TutorialBubble 非表示`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);

			const { exitDlg, bubble } = await startTutorialAndOpenExitConfirm(page);

			// AC4 / AC7: 終了確認ダイアログが表示されている
			await expect(exitDlg).toBeVisible();
			// 二重ダイアログバグの主検証: TutorialBubble は DOM から削除されているはず
			// (TutorialOverlay の {#if !showExitConfirm} ガードで)
			await expect(bubble).toBeHidden();
			// TutorialBubble 内の「次へ / 戻る / 終了」ボタンも非表示
			await expect(page.locator('.tutorial-bubble button:has-text("次へ")')).toBeHidden();
		});

		test(`${uiMode}: AC5 「続ける」 → TutorialBubble 再表示 / チュートリアル続行可能`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);

			const { exitDlg, bubble } = await startTutorialAndOpenExitConfirm(page);

			// 「続ける」(キャンセル) クリック
			const cancelBtn = exitDlg.locator('button:has-text("続ける")');
			await expect(cancelBtn).toBeVisible();
			await cancelBtn.click();

			// 終了確認ダイアログが消える
			await expect(exitDlg).toBeHidden({ timeout: 5_000 });
			// TutorialBubble が再表示される
			await expect(bubble).toBeVisible({ timeout: 5_000 });
			// チュートリアル続行可能 (「次へ」/「完了」ボタンが押せる)
			// 年齢帯別ラベル: preschool/baby = 「つぎへ」/「おしまい！」、その他 = 「次へ」/「完了！」
			// (UI_COMPONENTS_LABELS.tutorialBubbleNext / src/lib/domain/labels.ts)
			await expect(
				bubble.locator(
					'button:has-text("次へ"), button:has-text("完了"), button:has-text("つぎへ"), button:has-text("おしまい")',
				),
			).toBeVisible();
		});

		test(`${uiMode}: AC6 「終了する」 → overlay / bubble 共に dismiss`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);

			const { exitDlg, bubble } = await startTutorialAndOpenExitConfirm(page);

			// 「終了する」(確定) クリック
			const confirmBtn = exitDlg.locator('button:has-text("終了する")');
			await expect(confirmBtn).toBeVisible();
			await confirmBtn.click();

			// 終了確認ダイアログが消える
			await expect(exitDlg).toBeHidden({ timeout: 5_000 });
			// TutorialBubble / overlay が消える
			await expect(bubble).toBeHidden({ timeout: 5_000 });
			await expect(page.locator('.tutorial-overlay')).toBeHidden({ timeout: 5_000 });
		});

		test(`${uiMode}: AC4 補強 backdrop 二重 click でも exitConfirm が二重表示されない (FSM 排他)`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);

			const { exitDlg } = await startTutorialAndOpenExitConfirm(page);

			// もう一度 backdrop を click しようとする (exitConfirm 表示中)
			// overlay 自体が hidden になっているため通常 click は failure になる可能性あり。
			// dispatchEvent で強制的に handleOverlayClick を発火させる。
			await page.evaluate(() => {
				const bg = document.querySelector('.tutorial-overlay-bg');
				if (bg) {
					const ev = new MouseEvent('click', { bubbles: true });
					bg.dispatchEvent(ev);
				}
			});

			// exitDlg は引き続き 1 件のみ visible (重複表示なし)
			const exitDialogs = page.getByTestId('tutorial-exit-confirm-dialog');
			await expect(exitDialogs).toHaveCount(1);
			await expect(exitDlg).toBeVisible();
		});
	}
});
