/**
 * scripts/capture-specs/flows/child-record-result-grandtotal-4916.mjs (#4916)
 *
 * 記録結果ダイアログの主要数字が「実際に残高へ加算された全額」と一致することを撮る。
 * 3 カテゴリの活動を順に記録し、3 件目でコンボ (さんみいったい tier) が発火した状態の
 * 結果ダイアログを撮影する。#4916 修正前は主要数字がコンボ分を含まず、修正後は含む。
 *
 * 環境変数:
 *   SS_PREFIX  before / after (ペアリング用)
 *   SS_PRESET  mobile / desktop
 *   SS_CHILD   子供 nickname (既定: けんたくん = elementary)
 *   SS_MODE    uiMode (既定: elementary)
 */

const prefix = process.env.SS_PREFIX ?? 'after';
const preset = process.env.SS_PRESET ?? 'desktop';
const childName = process.env.SS_CHILD ?? 'けんたくん';
const mode = process.env.SS_MODE ?? 'elementary';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	const origin = new URL(page.url()).origin;
	const go = (/** @type {string} */ path) => page.goto(new URL(path, origin).toString());

	/**
	 * 初回セッションは複数の初回限定オーバーレイ (おやカギ案内 → アドベンチャー演出 →
	 * おみくじログインボーナス → チュートリアル 等) が FSM キューで順番に開く。1 個閉じると
	 * 次が開くため、tests/e2e/helpers.ts `dismissOverlays()` と同じ汎用パターン
	 * (ダイアログ内ボタンをラベルで拾う + Escape fallback + adventure 固有 class) で
	 * 「既知オーバーレイが尽きる」までループで閉じ続ける。
	 */
	const dismissAllOverlays = async () => {
		// $effect ベースの FSM キュー投入は home-page visible 直後の tick では未マウントのことが
		// あるため、「1 巡クリーンだったら即 break」ではなく、**2 巡連続クリーン**を要求する
		// (dismiss → 次オーバーレイのマウント猶予 → 再確認、を跨いで捕まえる)。
		let cleanStreak = 0;
		for (let i = 0; i < 16 && cleanStreak < 2; i++) {
			let dismissedAny = false;

			const adventureStartBtn = page.locator('.adventure__start-btn');
			if (await adventureStartBtn.isVisible().catch(() => false)) {
				await adventureStartBtn.click().catch(() => {});
				dismissedAny = true;
			}

			const pinGateOnboardingClose = page.getByTestId('pin-gate-onboarding-close');
			if (await pinGateOnboardingClose.isVisible().catch(() => false)) {
				await pinGateOnboardingClose.click().catch(() => {});
				dismissedAny = true;
			}

			for (const testId of ['tutorial-skip', 'tutorial-close', 'page-guide-close']) {
				const btn = page.getByTestId(testId);
				if (await btn.isVisible().catch(() => false)) {
					await btn.click().catch(() => {});
					dismissedAny = true;
				}
			}

			// おみくじログインボーナス等、Ark UI Dialog 内のボタンをラベルで拾う汎用 fallback
			// (tests/e2e/helpers.ts `dismissOverlays()` と同一パターン)。
			const dialogBtn = page.locator('[data-scope="dialog"][data-state="open"] button').filter({
				hasText: /タップしてすすむ|やったね！|とじる|閉じる|OK|やったー/,
			});
			if (
				await dialogBtn
					.first()
					.isVisible()
					.catch(() => false)
			) {
				await dialogBtn
					.first()
					.click()
					.catch(() => {});
				dismissedAny = true;
			}

			const bodyLocked = await page
				.evaluate(() => getComputedStyle(document.body).pointerEvents === 'none')
				.catch(() => false);
			const hasOpenDialog = await page
				.evaluate(() => document.querySelector('[data-scope="dialog"][data-state="open"]') !== null)
				.catch(() => false);

			if (!dismissedAny && !bodyLocked && !hasOpenDialog) {
				cleanStreak++;
			} else {
				cleanStreak = 0;
				if (!dismissedAny && (bodyLocked || hasOpenDialog)) {
					// 既知セレクタでは拾えない残骸は Escape で閉じる (helpers.ts 同パターン)。
					await page.keyboard.press('Escape').catch(() => {});
				}
			}
			// 次の FSM キュー項目 (遷移アニメーション込み) のマウント猶予。固定 sleep ではなく、
			// 「まだ何か開いている」条件のポーリング待ち (既にクリーンなら即座に timeout で抜ける)。
			await page
				.waitForFunction(() => document.querySelector('[data-state="open"]') !== null, {
					timeout: 250,
				})
				.catch(() => {});
		}
		// 最終確認: body scroll-lock の解除を明示的に待つ (以後の click が拾われるように)。
		await page
			.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== 'none', {
				timeout: 5000,
			})
			.catch(() => {});
	};

	await go('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.getByTestId(`${mode}-home-page`).waitFor({ state: 'visible', timeout: 15000 });
	await dismissAllOverlays();

	// カテゴリを展開して、異なるカテゴリの活動を 3 件記録する
	const headers = page.locator('[data-testid^="category-header-"]');
	const headerCount = await headers.count();
	for (let i = 0; i < headerCount; i++) {
		await headers
			.nth(i)
			.evaluate((el) => /** @type {HTMLElement} */ (el).click())
			.catch(() => {});
	}

	const cards = page.locator('button[data-testid^="activity-card-"]:not([disabled])');
	/** 1 件記録して結果ダイアログを開いた状態にする。 */
	const record = async (/** @type {number} */ index) => {
		await cards.nth(index).scrollIntoViewIfNeeded();
		await cards.nth(index).click();
		await page.locator('[data-testid="confirm-dialog"]').waitFor({ state: 'visible' });
		await page.locator('[data-testid="confirm-record-btn"]').click();
		await page.getByTestId('result-point-value').waitFor({ state: 'visible' });
	};

	// `cards` は :not([disabled]) で動的に絞られるため、記録済みの活動は次の評価では
	// 除外される (= 常に index 0 が「次に記録する未完了カード」)。
	await record(0);
	await page.getByTestId('activity-confirm-btn').click();
	await page.getByTestId('result-point-value').waitFor({ state: 'hidden' });

	await record(0);
	await page.getByTestId('activity-confirm-btn').click();
	await page.getByTestId('result-point-value').waitFor({ state: 'hidden' });

	// 3 件目 (3 カテゴリ目) — さんみいったい コンボが乗る。主要数字がこの純増を含むかが本 Issue の核心。
	await record(0);
	await capture(`${prefix}-record-result-grandtotal-${preset}`);
};
