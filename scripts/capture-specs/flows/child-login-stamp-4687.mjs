/**
 * scripts/capture-specs/flows/child-login-stamp-4687.mjs (#4687)
 *
 * ログイン時のスタンプ押印演出を撮る。DB 側で「当日のログインボーナス未受取」状態を作ってから
 * home を開くと、自動で `?/loginStamp` が走り演出が開く。
 *
 * 環境変数:
 *   SS_PREFIX  before / after
 *   SS_PRESET  mobile / desktop
 *   SS_CHILD   子供 nickname (既定: けんたくん = elementary)
 *   SS_MODE    uiMode (既定: elementary)
 *   SS_CASE    normal (押印できる日) / cardfull (週 5 枠が既に埋まっている日)
 */

const prefix = process.env.SS_PREFIX ?? 'after';
const preset = process.env.SS_PRESET ?? 'desktop';
const childName = process.env.SS_CHILD ?? 'けんたくん';
const mode = process.env.SS_MODE ?? 'elementary';
const caseName = process.env.SS_CASE ?? 'normal';

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

	// 自動 claim → 押印演出 (points フェーズまで待つ)
	const overlay = page.getByTestId('stamp-press-overlay');
	await overlay.waitFor({ state: 'visible', timeout: 20_000 });
	await page.getByTestId('login-bonus-confirm').waitFor({ state: 'visible', timeout: 20_000 });
	await page.waitForTimeout(600);
	await capture(`${prefix}-login-stamp-${caseName}-${preset}`);

	// 「つぎへ」がある場合は週次交換フェーズも撮る
	const nextBtn = page.getByTestId('login-bonus-confirm');
	const label = (await nextBtn.textContent()) ?? '';
	if (label.includes('つぎへ')) {
		await nextBtn.click();
		await page.getByTestId('weekly-redeem-confirm').waitFor({ state: 'visible' });
		// fade-in アニメーションが終わってから撮る (途中で撮ると文字が薄く写る)
		await page.waitForTimeout(600);
		await capture(`${prefix}-weekly-redeem-${caseName}-${preset}`);
	}
};
