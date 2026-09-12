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

	// (child) layout マウントの初回訪問オーバーレイ群。TutorialOverlay / PinGateOnboarding は
	// 遷移後も残存しうるため、home 到達後・battle 到達後の両方で dismiss する
	// (#4936 QM BLOCK 1回目: TutorialOverlay が写り込み / BLOCK 2回目: PinGateOnboarding
	// `pin-gate-onboarding-dialog` (testid `pin-gate-onboarding-close`) が写り込み)。
	// mount 直後は Dialog のアニメーション/hydration で isVisible() が間に合わないことがあるため、
	// 短い timeout 付き waitFor で出現を確認してから閉じる (waitForTimeout は scripts/ 禁止 #1208)。
	const dismissOverlays = async () => {
		for (const testId of [
			'tutorial-skip',
			'tutorial-close',
			'page-guide-close',
			'pin-gate-onboarding-close',
		]) {
			const btn = page.getByTestId(testId);
			await btn.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
			if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
		}
	};

	await go('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`/${mode}/home`));
	await dismissOverlays();

	await go(`/${mode}/battle`);
	// 遷移後に再度オーバーレイが出ていないか確認 (チュートリアルの次ステップや
	// PinGateOnboarding が battle 画面遷移後に開くケースへの保険)
	await dismissOverlays();
	await page.locator('[data-testid="battle-page"]').waitFor({ state: 'visible' });
	// 画像の遅延読込・アニメーション初期化を待つ
	await page.locator('[data-testid="battle-field"]').waitFor({ state: 'visible' });
	// <svelte:head> title の client hydration 反映を待つ (cold-start 直後は一瞬ルート layout の
	// 既定 title のままになることがある。最終的に収束する値を確定させてから撮る)
	await page.waitForFunction(() => document.title.includes('バトル'), { timeout: 10_000 });
	await capture(`after-battle-${mode}-${preset}`);
};
