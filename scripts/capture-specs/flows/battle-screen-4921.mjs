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
	// `pin-gate-onboarding-dialog` (testid `pin-gate-onboarding-close`) が写り込み / BLOCK 3回目:
	// elementary/senior-desktop のみ再現する間欠 fail — 原因は「4 testid を 1500ms ずつ順番に
	// 待つ」逐次方式そのもの。対象の Dialog が 1500ms を過ぎてから hydrate/mount された場合、
	// そのループはすでに次の testid に進んでおり、二度と戻って確認しない。同一 flow・同一ロジック
	// でも実行環境の負荷 (同時起動 dev server 数等) 次第で hydration 時間が振れるため、
	// モード/プリセットの組み合わせによって成否が分かれる非決定的な fail になっていた
	// (QM が `AUTH_MODE=local npm run dev` の実機で再現・特定)。
	//
	// 対応: 4 testid の `waitFor` を Promise.race で並列化し、**どれか 1 つでも先に visible に
	// なった時点で即座に click** → 残り時間内でループを繰り返す。1 巡ごとに 1500ms 使い切るのを
	// 待たず、最初に現れた overlay を最短で処理できるため、hydration が多少遅れても取りこぼさない
	// (waitForTimeout は scripts/ 禁止 #1208 のため使わない。`waitFor` の共有 timeout のみで実装)。
	const OVERLAY_CLOSE_TESTIDS = [
		'tutorial-skip',
		'tutorial-close',
		'page-guide-close',
		'pin-gate-onboarding-close',
	];
	const dismissOverlays = async (budgetMs = 8000) => {
		const deadline = Date.now() + budgetMs;
		for (;;) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) return;
			const appeared = await Promise.race(
				OVERLAY_CLOSE_TESTIDS.map((testId) =>
					page
						.getByTestId(testId)
						.waitFor({ state: 'visible', timeout: remaining })
						.then(() => testId)
						.catch(() => null),
				),
			);
			if (!appeared) return; // 残り時間内にどれも現れなかった
			await page
				.getByTestId(appeared)
				.click()
				.catch(() => {});
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
