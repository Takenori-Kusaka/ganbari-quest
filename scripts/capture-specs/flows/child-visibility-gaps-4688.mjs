/**
 * scripts/capture-specs/flows/child-visibility-gaps-4688.mjs (#4688)
 *
 * 「実データはあるのに画面に出ない」4 件の画面を撮る。
 *   achievements: 記録 > 達成タブ (受取済みチャレンジが残るか)
 *   status:       つよさ (レベル称号が出るか)
 *   milestones:   🔔 の着地先 (マイルストーン一覧)
 *
 * 環境変数:
 *   SS_PREFIX  before / after
 *   SS_PRESET  mobile / desktop
 *   SS_CHILD   子供 nickname (既定: けんたくん)
 *   SS_MODE    uiMode (既定: elementary)
 */

/**
 * CSS アニメーションが終わるまで待つ (固定 sleep は #1208 で禁止)。
 * @param {import('playwright').Page} page
 */
async function waitForAnimationsSettled(page) {
	await page
		.waitForFunction(
			() => document.getAnimations().every((a) => a.playState !== 'running'),
			undefined,
			{ timeout: 5000 },
		)
		.catch(() => {});
}

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

	await go('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`/${mode}/home`));

	// 押印演出が自動で開く場合は閉じる (以降の画面を覆わないように)
	const confirm = page.getByTestId('login-bonus-confirm');
	if (await confirm.isVisible({ timeout: 8000 }).catch(() => false)) {
		await confirm.click();
		const weekly = page.getByTestId('weekly-redeem-confirm');
		if (await weekly.isVisible({ timeout: 2000 }).catch(() => false)) await weekly.click();
	}

	// 記録 > 達成タブ (受取済みチャレンジが残るか)
	await go(`/${mode}/history?kind=achievements`);
	await waitForAnimationsSettled(page);
	await capture(`${prefix}-history-achievements-${preset}`);

	// つよさ (レベル称号)
	await go(`/${mode}/status`);
	await page.locator('[data-testid="growth-chart-heading"]').waitFor({ state: 'visible' });
	await waitForAnimationsSettled(page);
	await capture(`${prefix}-status-level-title-${preset}`);

	// 🔔 の着地先 (マイルストーン一覧)
	await go(`/${mode}/history?kind=milestones`);
	await waitForAnimationsSettled(page);
	await capture(`${prefix}-history-milestones-${preset}`);
};
