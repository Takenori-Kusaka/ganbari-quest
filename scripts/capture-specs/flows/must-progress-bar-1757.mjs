/**
 * scripts/capture-specs/flows/must-progress-bar-1757.mjs (#1757 / #1709-C)
 *
 * 子供 UI 「今日のおやくそく」N/M バーを 4 年齢モード × 3 状態（部分達成 / 全達成 / バー非表示）で
 * 撮影する単一フロー。状態は `MUST_STATE` 環境変数で切り替える。
 *
 * 状態:
 * - `MUST_STATE=initial`（デフォルト）: must 活動 priority='must' で seed されている前提で
 *   4 年齢モード（preschool/elementary/junior/senior）のホーム上部バーを撮影
 *   + baby home（バー非表示）
 * - `MUST_STATE=allcomplete`: 事前に各子供の must 活動 (id=13/14/16) を本日記録済みにしてから実行
 *   → 4 モードすべて「ぜんぶできた！+X pt」状態を撮影
 * - `MUST_STATE=empty`: 事前に DB の priority を全て optional に戻してから実行
 *   → 4 モード全て「バー非表示」状態を撮影
 *
 * 使用例:
 *   BASE_URL=http://127.0.0.1:5173 MSYS_NO_PATHCONV=1 \
 *     MUST_STATE=initial \
 *     node scripts/capture.mjs --pr 1757 --flow must-progress-bar-1757 --url /switch \
 *     --actions scripts/capture-specs/flows/must-progress-bar-1757.mjs --presets desktop,mobile
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const STATE = process.env.MUST_STATE || 'initial';

/** @param {import('playwright').Page} page */
async function clearDemoCookie(page) {
	await page.context().clearCookies();
}

/**
 * @param {import('playwright').Page} page
 * @param {string} childName
 * @param {string} expectedUrlSuffix
 */
async function selectChild(page, childName, expectedUrlSuffix) {
	await page.goto(`${BASE_URL}/switch`);
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`${expectedUrlSuffix}$`));
}

/**
 * @param {import('playwright').Page} page
 * @param {string} mode
 */
async function waitForHome(page, mode) {
	await page.locator(`[data-testid="${mode}-home-page"]`).waitFor({ state: 'visible' });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await clearDemoCookie(page);

	const stateLabel =
		STATE === 'allcomplete' ? '全達成' : STATE === 'empty' ? 'バー非表示 (M=0)' : '初期';

	// preschool — たろうくん (age 4)
	await selectChild(page, 'たろうくん', '/preschool/home');
	await waitForHome(page, 'preschool');
	if (STATE !== 'empty') {
		await page
			.locator('[data-testid="must-progress-bar"]')
			.waitFor({ state: 'visible', timeout: 5_000 })
			.catch(() => {});
	}
	await capture(`preschool — ${stateLabel}`);

	// elementary — けんたくん (age 8)
	await selectChild(page, 'けんたくん', '/elementary/home');
	await waitForHome(page, 'elementary');
	if (STATE !== 'empty') {
		await page
			.locator('[data-testid="must-progress-bar"]')
			.waitFor({ state: 'visible', timeout: 5_000 })
			.catch(() => {});
	}
	await capture(`elementary — ${stateLabel}`);

	// junior — ゆうこちゃん (age 13)
	await selectChild(page, 'ゆうこちゃん', '/junior/home');
	await waitForHome(page, 'junior');
	if (STATE !== 'empty') {
		await page
			.locator('[data-testid="must-progress-bar"]')
			.waitFor({ state: 'visible', timeout: 5_000 })
			.catch(() => {});
	}
	await capture(`junior — ${stateLabel}`);

	// senior — まさとくん (age 16)
	await selectChild(page, 'まさとくん', '/senior/home');
	await waitForHome(page, 'senior');
	if (STATE !== 'empty') {
		await page
			.locator('[data-testid="must-progress-bar"]')
			.waitFor({ state: 'visible', timeout: 5_000 })
			.catch(() => {});
	}
	await capture(`senior — ${stateLabel}`);

	// baby — はなこちゃん（バー非表示確認、initial state でのみ撮影）
	if (STATE === 'initial') {
		await selectChild(page, 'はなこちゃん', '/baby/home');
		await page.waitForLoadState('domcontentloaded');
		await capture('baby — must バー非表示（親準備モード）');
	}
};
