/**
 * scripts/capture-specs/flows/battle-screen-4921.mjs (#4921)
 *
 * バトル画面 (自キャラ・敵画像の透過 / junior・senior 漢字文言 / title) の修正後 SS を撮る。
 * AUTH_MODE=local (npm run dev) で動作。
 *
 * 環境変数:
 *   SS_CHILD   選択する子供の nickname
 *   SS_MODE    uiMode (elementary / junior / senior)
 *   SS_PRESET  ラベルに含めるプリセット名 (mobile / desktop、既定 desktop)
 */

const childName = process.env.SS_CHILD ?? 'しょうがくせい';
const mode = process.env.SS_MODE ?? 'elementary';
const preset = process.env.SS_PRESET ?? 'desktop';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	const origin = new URL(page.url()).origin;
	const go = (path) => page.goto(new URL(path, origin).toString());

	await go('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`/${mode}/home`));

	// オーバーレイ (チュートリアル等) を閉じる。TutorialOverlay は (child) layout マウントのため
	// 遷移後も残存しうる (#4936 QM BLOCK: バトル画面 SS にチュートリアル modal が写り込んでいた)
	for (const testId of ['tutorial-skip', 'tutorial-close', 'page-guide-close']) {
		const btn = page.getByTestId(testId);
		if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
	}

	await go(`/${mode}/battle`);

	// 遷移後に再度オーバーレイが出ていないか確認 (チュートリアルの次ステップが battle 画面に
	// フォーカスを合わせるケースへの保険)
	for (const testId of ['tutorial-skip', 'tutorial-close', 'page-guide-close']) {
		const btn = page.getByTestId(testId);
		if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
	}
	await page.locator('[data-testid="battle-page"]').waitFor({ state: 'visible' });
	// 画像の遅延読込・アニメーション初期化を待つ
	await page.locator('[data-testid="battle-field"]').waitFor({ state: 'visible' });
	// <svelte:head> title の client hydration 反映を待つ (cold-start 直後は一瞬ルート layout の
	// 既定 title のままになることがある。最終的に収束する値を確定させてから撮る)
	await page.waitForFunction(() => document.title.includes('バトル'), { timeout: 10_000 });
	await capture(`after-battle-${mode}-${preset}`);
};
