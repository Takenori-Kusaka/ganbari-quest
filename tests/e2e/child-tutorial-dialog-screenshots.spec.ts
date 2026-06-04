// tests/e2e/child-tutorial-dialog-screenshots.spec.ts
// #2393 (PR #2388 admin v1 tutorial 撤去 follow-up): 子供画面 (CHILD_TUTORIAL_CHAPTERS) で
// TutorialQuickCompleteDialog 系 dialog の視覚証跡を撮影する E2E。
//
// 旧 tests/e2e/tutorial-dialog-primitive-screenshots.spec.ts の代替:
//   - 旧 spec は /admin/subscription から `[data-tutorial="tutorial-restart"]` クリックで
//     v1 tutorial を起動していたが、admin v1 tutorial 撤去 (PR #2388) で経路消失
//   - 本 spec は子供画面 (preschool/elementary/junior/senior) の Header `?` ボタン
//     (`[data-testid="header-help-btn"]` = `[data-tutorial="tutorial-restart"]`) 経由で起動
//
// 子供画面 tutorial 構造差分:
//   - CHILD_TUTORIAL_CHAPTERS は isParentChapters=false → quickMode 非有効化
//   - そのため showQuickComplete dialog は発火しない (TutorialQuickCompleteDialog の
//     2 つ目 Dialog はテスト対象から外す)
//   - 代わりに resume prompt / exit confirm の 2 dialog をカバー (4 mode × 2 dialog = 8 SS)
//
// 実行:
//   npx playwright test tests/e2e/child-tutorial-dialog-screenshots.spec.ts --project=tablet
// 出力: docs/screenshots/2393-child-tutorial-dialog/<mode>/

import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const OUT = path.resolve('docs/screenshots/2393-child-tutorial-dialog');

/** 子供画面 seed (global-setup.ts) で実装される 4 core mode (#2393 検証対象) */
const MODES = ['preschool', 'elementary', 'junior', 'senior'] as const;

/**
 * /switch から指定 mode の子供を選択して home に遷移する。
 * seed (tests/e2e/global-setup.ts) に依存。
 *
 * 子供選択は `<form method="POST" action="?/select">` 経由 (data-testid="child-select-{id}")。
 * 選択後 server-side が selectedChildId cookie を set + home redirect する。
 * mode 推定: data-theme attribute と nickname の組合せでは脆弱なため、
 * /switch ページ HTML 中の `<a href="/${uiMode}/...">` 等を経由せず、
 * data の age + theme から uiMode を server-side で resolve させる挙動に委ねる。
 *
 * したがって本ヘルパーは: 全 child select button を順に試し、redirect 後の URL が
 * `/${uiMode}/` で始まる子供を見つける戦略を取る。
 */
async function gotoChildHome(page: Page, uiMode: string) {
	await page.goto('/switch', { waitUntil: 'domcontentloaded' });
	const childButtons = page.locator('[data-testid^="child-select-"]');
	await childButtons.first().waitFor({ state: 'visible', timeout: 15_000 });
	const count = await childButtons.count();
	for (let i = 0; i < count; i++) {
		// 各試行ごとに /switch に戻る (前の試行で別 mode に飛んだ可能性)
		if (i > 0) {
			await page.goto('/switch', { waitUntil: 'domcontentloaded' });
			await childButtons.first().waitFor({ state: 'visible', timeout: 15_000 });
		}
		const btn = childButtons.nth(i);
		await btn.click();
		try {
			await page.waitForURL(new RegExp(`/${uiMode}(/|$)`), { timeout: 5_000 });
			await page.locator('[data-testid="header-help-btn"]').waitFor({
				state: 'visible',
				timeout: 10_000,
			});
			await dismissChildHomeOverlays(page);
			return; // 成功
		} catch {
			// この child は別 mode → 次を試す
		}
	}
	throw new Error(`[gotoChildHome] uiMode=${uiMode} の子供が seed に存在しない`);
}

/**
 * 子供 home 到達時に auto-open する複数 overlay (login bonus / PIN gate onboarding /
 * ParentMessage / SiblingCheer / SpecialReward 等) を抑制する。
 *
 * 子供 home は server-side auto-claim / auto-open 機構が複数同時稼働するため、
 * dismiss attempt は競合状態に陥り易い。本ヘルパーは:
 *   (a) 既出の auto-open dialog を click で best-effort dismiss する
 *   (b) その上で `pointer-events: none` を `[data-scope="dialog"]` 系に強制注入し、
 *       後発の auto-open dialog が tutorial 起動 (help button click) を妨げないようにする
 *
 * tutorial overlay (`--z-tutorial = 100`) は dialog 系 (`--z-modal = 50`) より上層なので、
 * 視覚的に重なっても tutorial の click 操作は通る。検証対象 (tutorial 表示・操作) には影響なし。
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
		() =>
			page.locator('[data-scope="dialog"][data-part="content"] button:has-text("ありがとう！")'),
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
				// force: true — html backdrop が intercept しても dismiss を強行
				await c
					.first()
					.click({ force: true, timeout: 2_000 })
					.catch(() => {});
				anyDismissed = true;
			}
		}
		if (!anyDismissed) break;
	}
	// dialog 系 overlay が後発で出ても tutorial 操作を妨げないよう pointer-events を無効化
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
			/* ただし tutorial 自身の dialog (resume / exit-confirm) は除外 */
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

async function clearTutorialProgress(page: Page) {
	await page.evaluate(() => {
		localStorage.removeItem('tutorial-progress-chapter');
		localStorage.removeItem('tutorial-progress-step');
	});
}

async function startChildTutorial(page: Page) {
	const helpBtn = page.locator('[data-testid="header-help-btn"]');
	await expect(helpBtn).toBeVisible({ timeout: 10_000 });
	// #2558 fix 観察 (elementary tablet で `click({force:true})` 3 retry 全 fail):
	// `force: true` click は actionability check (visibility / stable / receives events) を
	// スキップするが、browser hit-testing で別 element が上に被さっていると click event が
	// `?` button の onclick handler に到達しない。dispatchEvent('click') は hit-testing を
	// 完全にバイパスし要素自身の event listener を直接発火させるため、auto-open dialog
	// (activity confirm / cheer / message 等) との干渉を確実に回避する。
	// data-tutorial-active or resume dialog visible で成功判定 (act → outcome 検証維持)。
	for (let attempt = 0; attempt < 3; attempt++) {
		await helpBtn.dispatchEvent('click');
		try {
			await page.waitForFunction(
				() =>
					document.documentElement.hasAttribute('data-tutorial-active') ||
					document.querySelector('[data-testid="tutorial-resume-dialog"][data-state="open"]') !==
						null,
				null,
				{ timeout: 3_000 },
			);
			return;
		} catch {
			// fallthrough → re-dispatch
		}
	}
	// 最終 fall-through: 後続の waitForSelector が自分で時間切れ判定するため throw しない
}

/** Web Animations API で dialog の開閉 animation 完了を待つ (#1259 waitForTimeout 代替) */
async function waitForDialogAnimations(locator: ReturnType<Page['locator']>) {
	await locator.evaluate((el) =>
		Promise.all(
			(el as HTMLElement).getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
		),
	);
}

// mobile project からの実行は `playwright.config.ts` の mobile.testIgnore で除外済 (#2393)。
// tablet (Desktop Chrome 1280x800) project からのみ実行される。
test.describe('#2393 子供画面 TutorialQuickCompleteDialog 撮影 (4 モード × 2 dialog)', () => {
	test.setTimeout(60_000);

	for (const uiMode of MODES) {
		test(`${uiMode}: resume prompt dialog`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);

			// 保存進捗をセットし reload → resume prompt を発火させる
			await page.evaluate(() => {
				localStorage.setItem('tutorial-progress-chapter', '2');
				localStorage.setItem('tutorial-progress-step', '0');
			});
			await page.reload();
			// reload 後 Header help button の再描画を待つ
			await page.locator('[data-testid="header-help-btn"]').waitFor({
				state: 'visible',
				timeout: 15_000,
			});
			await startChildTutorial(page);

			// Resume dialog (testid="tutorial-resume-dialog")
			const resumeDlg = page.getByTestId('tutorial-resume-dialog');
			await expect(resumeDlg).toBeVisible({ timeout: 10_000 });
			await waitForDialogAnimations(resumeDlg);
			await page.screenshot({
				path: path.join(OUT, uiMode, '01-resume-prompt.png'),
				fullPage: false,
			});

			// AC: resume prompt 内に「前回の途中から続けますか？」テキストが含まれる
			await expect(resumeDlg).toContainText('前回の途中から続けますか');
			// AC: 「続きから」「最初から」「キャンセル」3 ボタンが存在
			await expect(resumeDlg.locator('button:has-text("続きから")')).toBeVisible();
			await expect(resumeDlg.locator('button:has-text("最初から")')).toBeVisible();
			await expect(resumeDlg.locator('button:has-text("キャンセル")')).toBeVisible();
		});

		test(`${uiMode}: exit confirm dialog`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);
			await clearTutorialProgress(page);
			await startChildTutorial(page);

			// tutorial active flag を待つ (.tutorial-overlay-bg は cheer overlay の backdrop と被る可能性)
			await page.waitForSelector('html[data-tutorial-active]', { timeout: 10_000 });
			// bubble 出現待ち (selector 不在ステップは 3s 中央表示 fallback)
			await page.locator('.tutorial-bubble').waitFor({
				state: 'visible',
				timeout: 15_000,
			});

			// dark backdrop の左上を click (spotlight 領域外)
			await page.locator('.tutorial-overlay-bg').click({ position: { x: 20, y: 20 } });

			const exitDlg = page.getByTestId('tutorial-exit-confirm-dialog');
			await expect(exitDlg).toBeVisible({ timeout: 10_000 });
			await waitForDialogAnimations(exitDlg);
			await page.screenshot({
				path: path.join(OUT, uiMode, '02-exit-confirm.png'),
				fullPage: false,
			});

			// AC: exit confirm 内に「チュートリアルを終了しますか？」が含まれる
			await expect(exitDlg).toContainText('チュートリアルを終了しますか');
			// AC: 「続ける」「終了する」ボタン存在
			await expect(exitDlg.locator('button:has-text("続ける")')).toBeVisible();
			await expect(exitDlg.locator('button:has-text("終了する")')).toBeVisible();
		});
	}
});
