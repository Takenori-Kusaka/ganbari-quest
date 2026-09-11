/**
 * scripts/capture-specs/flows/child-challenge-celebration-4689.mjs (#4689)
 *
 * 週次チャレンジを達成した子供のホームを撮る。別内容の兄弟チャレンジがあるとき、
 * 達成した子に祝福 dialog が出るか (旧実装では出なかった) を見る。
 *
 * 環境変数:
 *   SS_PREFIX  before / after
 *   SS_PRESET  mobile / desktop
 *   SS_CHILD   子供 nickname (既定: けんたくん = 達成済み)
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

	await page.goto(new URL('/switch', origin).toString());
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`/${mode}/home`));

	// ログイン押印演出が先に出る回は閉じて、祝福まで進める (FSM は 1 枚ずつ出す)
	const stampConfirm = page.getByTestId('login-bonus-confirm');
	if (await stampConfirm.isVisible({ timeout: 8000 }).catch(() => false)) {
		await stampConfirm.click();
		const weekly = page.getByTestId('weekly-redeem-confirm');
		if (await weekly.isVisible({ timeout: 2000 }).catch(() => false)) await weekly.click();
	}

	// 祝福 dialog (出ない実装では timeout → ホームをそのまま撮る)
	await page
		.getByTestId('sibling-celebration')
		.waitFor({ state: 'visible', timeout: 8000 })
		.catch(() => {});
	await page
		.waitForFunction(
			() => document.getAnimations().every((a) => a.playState !== 'running'),
			undefined,
			{ timeout: 5000 },
		)
		.catch(() => {});
	await capture(`${prefix}-challenge-celebration-${preset}`);
};
