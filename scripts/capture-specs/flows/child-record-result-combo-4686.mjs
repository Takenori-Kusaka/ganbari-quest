/**
 * scripts/capture-specs/flows/child-record-result-combo-4686.mjs (#4686)
 *
 * 記録の結果ダイアログ (コンボ表示) と、とりけし後の状態を撮る。
 * 1 件目を記録 → 閉じる → 2 件目 (別カテゴリ) を記録 → 結果ダイアログを撮影 → とりけしを撮影。
 *
 * 環境変数:
 *   SS_PREFIX  before / after (ペアリング用)
 *   SS_PRESET  mobile / desktop
 *   SS_CHILD   子供 nickname (既定: たろうくん = preschool)
 *   SS_MODE    uiMode (既定: preschool)
 */

const prefix = process.env.SS_PREFIX ?? 'after';
const preset = process.env.SS_PRESET ?? 'desktop';
const childName = process.env.SS_CHILD ?? 'たろうくん';
const mode = process.env.SS_MODE ?? 'preschool';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	const origin = new URL(page.url()).origin;
	const go = (/** @type {string} */ path) => page.goto(new URL(path, origin).toString());

	await go('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`/${mode}/home`));

	// オーバーレイ (チュートリアル等) を閉じる
	for (const testId of ['tutorial-skip', 'tutorial-close', 'page-guide-close']) {
		const btn = page.getByTestId(testId);
		if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
	}

	// カテゴリを展開して、異なるカテゴリの活動を 2 件記録する
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

	await record(0);
	await page.getByTestId('activity-confirm-btn').click();
	await page.getByTestId('result-point-value').waitFor({ state: 'hidden' });

	// 2 件目 (別カテゴリ) — コンボが乗る
	await record(1);
	await capture(`${prefix}-record-result-combo-${preset}`);

	// とりけし (5 秒窓内)
	await page.getByTestId('activity-cancel-btn').click();
	await page.getByText('とりけしました').waitFor({ state: 'visible' });
	await capture(`${prefix}-record-cancelled-${preset}`);
};
