/**
 * scripts/capture-specs/flows/child-baby-gamification-4685.mjs (#4685)
 *
 * 準備モード (baby) にゲーミフィケーション UI が漏れていないかを撮る。
 *   1. baby home (ヘッダーのスタンプ「💮 0/5」が無いこと)
 *   2. /baby/shop に直接アクセスした結果 (home へ倒れること)
 *
 * 環境変数:
 *   SS_PREFIX  before / after
 *   SS_PRESET  mobile / desktop
 *   SS_CHILD   子供 nickname (既定: はなこちゃん = baby)
 */

const prefix = process.env.SS_PREFIX ?? 'after';
const preset = process.env.SS_PRESET ?? 'desktop';
const childName = process.env.SS_CHILD ?? 'はなこちゃん';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	const origin = new URL(page.url()).origin;

	await page.goto(new URL('/switch', origin).toString());
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(/\/baby\/home/);
	await page.locator('[data-testid="baby-home-page"]').waitFor({ state: 'visible' });
	await capture(`${prefix}-baby-home-${preset}`);

	await page.goto(new URL('/baby/shop', origin).toString());
	await page
		.waitForFunction(
			() => document.getAnimations().every((a) => a.playState !== 'running'),
			undefined,
			{ timeout: 5000 },
		)
		.catch(() => {});
	await capture(`${prefix}-baby-shop-${preset}`);
};
