/**
 * scripts/capture-specs/flows/admin-challenges-group-4689.mjs (#4689)
 *
 * 親の /admin/challenges を撮る。週次自動生成 (子供ごとに別内容) が
 * 「先頭の子のタイトルで全員の進捗を束ねた 1 枚」になっていないかを見る。
 *
 * 環境変数:
 *   SS_PREFIX  before / after
 *   SS_PRESET  mobile / desktop
 */

const prefix = process.env.SS_PREFIX ?? 'after';
const preset = process.env.SS_PRESET ?? 'desktop';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	const origin = new URL(page.url()).origin;

	await page.goto(new URL('/admin/challenges', origin).toString());
	await page.locator('[data-testid="admin-challenges-group"]').first().waitFor({ state: 'visible' });
	await page
		.waitForFunction(
			() => document.getAnimations().every((a) => a.playState !== 'running'),
			undefined,
			{ timeout: 5000 },
		)
		.catch(() => {});
	await capture(`${prefix}-admin-challenges-${preset}`);
};
