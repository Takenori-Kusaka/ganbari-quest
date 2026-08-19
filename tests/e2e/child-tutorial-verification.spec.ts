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
// AC5 (バブル表示): 各ステップで TutorialBubble が visible
// #4652 (EPIC #4650 判断 4 / 6): **selector 指定 step は必ず実要素に spotlight する**。
//   旧 spec は「selector 不在は中央表示 fallback」を許容していたため、9 step 中 5 step が
//   何も光らないまま CI 緑だった。overlay の `data-tutorial-target="resolved|fallback"` と
//   step の `data-has-target` を突き合わせ、fallback で成立させない。
// AC6 (全ステップ SS): docs/screenshots/2393-child-tutorial-verification/<mode>/step-N.png
// AC7 (twin dialog 回避): 各ステップで .tutorial-bubble は 1 件のみ
//
// 実行: npx playwright test tests/e2e/child-tutorial-verification.spec.ts

import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const SCREENSHOT_DIR = path.resolve('docs/screenshots/2393-child-tutorial-verification');
const MODES = ['preschool', 'elementary', 'junior', 'senior'] as const;

/**
 * #4652: 「記録して閉じる」最短経路 3 chapter × 合計 5 step (cf. tutorial-chapters-child.ts)。
 * ホームに無い仕組み (コンボ / おみくじ / 別ページのレーダーチャート) の step は撤去済。
 */
const EXPECTED_TOTAL_STEPS = 5;

/** 訪れる step id の正準列 (上から下: 記録 → とりけし → スタンプ → つよさ → ショップ)。 */
const EXPECTED_STEP_IDS = [
	'child-record-card',
	'child-record-cancel',
	'child-daily-stamp',
	'child-nav-status',
	'child-nav-shop',
] as const;

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
		// #4651: 進捗 key は章セットごとの namespace (`tutorial-progress:<scope>:chapter|step`)。
		// spec 側は prefix 一致で全 scope を掃除する (mode ごとに書き分けない)。
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith('tutorial-progress')) localStorage.removeItem(key);
		}
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
		// #2558 fix: activity 記録確認 dialog (`confirm-dialog`) も後発で auto-open しうる
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

/**
 * helpBtn click → tutorial active flag set を 3 retry で確実に発火させる (#2558 fix / #2565)。
 * 単発 click は rapid onMount/effect の hydration 過渡で ~30% flake するため、
 * `data-tutorial-active` が set されるまで再発火する。
 *
 * #2565: `click({ force: true })` は actionability check (visibility / stable / receives
 * events) をスキップするが、browser hit-testing で別 element (子供 home の auto-open
 * dialog / cheer / parent-message overlay 等) が `?` button の上に被さると click event が
 * onclick handler に到達せず、tablet project で `html[data-tutorial-active]` 不在の
 * timeout flake になる (child-tutorial-dialog-screenshots.spec.ts は #2558 で既に
 * `dispatchEvent('click')` に移行済だが、本 spec は `force: true` click のまま取り残されて
 * いたのが root cause)。`dispatchEvent('click')` は hit-testing を完全にバイパスし要素自身の
 * event listener を直接発火させるため、auto-open overlay との干渉を確実に回避する。
 */
async function startTutorialWithRetry(page: Page) {
	const helpBtn = page.locator('[data-testid="header-help-btn"]');
	await expect(helpBtn).toBeVisible({ timeout: 10_000 });
	for (let attempt = 0; attempt < 3; attempt++) {
		await helpBtn.dispatchEvent('click');
		try {
			await page.waitForFunction(
				() => document.documentElement.hasAttribute('data-tutorial-active'),
				null,
				{ timeout: 3_000 },
			);
			return;
		} catch {
			// fallthrough → re-dispatch
		}
	}
}

/**
 * #4652 (EPIC #4650 判断 4 / 6): selector 指定 step が**実要素に spotlight する**ことを検証する。
 * overlay の `data-tutorial-target` が `resolved` で、spotlight ring が非 0 サイズであること。
 * selector を持たない説明 step (`data-has-target="false"`) は中央表示が正なので対象外。
 */
async function assertStepSpotlight(
	page: Page,
	bubble: ReturnType<Page['locator']>,
	ctx: string,
): Promise<void> {
	if ((await bubble.getAttribute('data-has-target')) !== 'true') return;
	await expect(
		page.locator('.tutorial-overlay'),
		`${ctx}: 対象要素に spotlight する (中央 fallback でない)`,
	).toHaveAttribute('data-tutorial-target', 'resolved', { timeout: 10_000 });
	const ringBox = await page.locator('.tutorial-spotlight-ring').boundingBox();
	expect(ringBox, `${ctx}: spotlight ring が描画される`).not.toBeNull();
	if (!ringBox) return;
	expect(ringBox.width, `${ctx}: spotlight 幅 > 0`).toBeGreaterThan(0);
	expect(ringBox.height, `${ctx}: spotlight 高 > 0`).toBeGreaterThan(0);
}

// mobile project からの実行は `playwright.config.ts` の mobile.testIgnore で除外済 (#2393)。
test.describe('#2393 子供画面 CHILD_TUTORIAL_CHAPTERS 全ステップ検証', () => {
	test.setTimeout(180_000);

	for (const uiMode of MODES) {
		test(`${uiMode}: 全ステップ進行 + SS 撮影 + AC5/AC6/AC7 検証`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await gotoChildHome(page, uiMode);

			// チュートリアル起動 (dispatchEvent('click') で auto-open dialog の hit-testing 被さりを
			// バイパス、3 retry で flake 解消 — #2565)
			await startTutorialWithRetry(page);
			// tutorial active flag を待つ (cheer overlay の backdrop と衝突しない)
			await page.waitForSelector('html[data-tutorial-active]', { timeout: 10_000 });

			let stepNum = 0;
			const visitedStepIds: string[] = [];
			const maxSteps = 15; // 無限ループ防止 (実 step 5 + 余裕)

			while (stepNum < maxSteps) {
				stepNum++;

				const bubble = page.locator('.tutorial-bubble');
				await bubble.waitFor({ state: 'visible', timeout: 10_000 });
				await waitForBubbleAnimations(bubble);

				// AC7: bubble は 1 件のみ (FSM 排他 + showQuickComplete/showExitConfirm の二重表示なし)
				await expect(page.locator('.tutorial-bubble')).toHaveCount(1);

				// ステップ情報を取得
				const stepId = (await bubble.getAttribute('data-step-id')) ?? '';
				visitedStepIds.push(stepId);
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

				// #4652: selector 指定 step は実要素に spotlight する (中央 fallback を許容しない)
				await assertStepSpotlight(page, bubble, `[${uiMode} Step ${stepNum}] ${stepId}`);

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
				`[${uiMode}] 子供チュートリアル 全 ${EXPECTED_TOTAL_STEPS} step が再生される`,
			).toBe(EXPECTED_TOTAL_STEPS);
			// #4652: step 構成 (上から下の最短経路) を固定する
			expect(visitedStepIds, `[${uiMode}] 訪れた step id の列`).toEqual([...EXPECTED_STEP_IDS]);
		});
	}
});

// #4652 (EPIC #4650 F6 / F9): baby モードの ❓ 不在と、子供向けダイアログ文言の年齢帯 variant。
test.describe('#4652 子供チュートリアルの入口とダイアログ文言', () => {
	test.setTimeout(120_000);

	test('baby: ❓ ボタンが出ない (子供画面から /admin へ飛ばない)', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		// baby の子供に到達する (/switch の各ボタンを順に試す)
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
				await page.waitForURL(/\/baby(\/|$)/, { timeout: 5_000 });
				arrived = true;
				break;
			} catch {
				// 別 mode → 次を試す
			}
		}
		expect(arrived, 'baby モードの子供が seed に存在する').toBe(true);

		// ❓ (header-help-btn) は baby では描画しない。押せば親チャプターで /admin へ飛ぶため
		// (EPIC #4650 F6)、ボタン自体を出さないことを固定する。
		await expect(page.locator('[data-testid="header-help-btn"]')).toHaveCount(0);
		// 子供画面に留まっている (管理画面へ遷移していない)
		expect(page.url()).toContain('/baby');
	});

	test('preschool: 終了確認ダイアログが子供向けひらがな文言で出る', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoChildHome(page, 'preschool');
		await startTutorialWithRetry(page);
		await page.waitForSelector('html[data-tutorial-active]', { timeout: 10_000 });

		// overlay 背景クリックで終了確認を出す
		await page.locator('.tutorial-overlay-bg').click({ force: true });
		const dialog = page.getByTestId('tutorial-exit-confirm-dialog');
		await expect(dialog).toBeVisible({ timeout: 5_000 });
		// 親向け漢字文言 (「チュートリアルを終了しますか？」) ではなく子供向けひらがな
		await expect(dialog).toContainText('ガイドを やめる？');
		await expect(dialog).not.toContainText('チュートリアルを終了しますか？');
	});
});
