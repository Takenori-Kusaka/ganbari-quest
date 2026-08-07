/**
 * scripts/capture-specs/flows/child-shop-quantity-4407.mjs (#4407)
 *
 * ごほうび交換の個数指定 (単位量の特権ごほうびを N 個ぶん 1 回で交換する) の SS フロー。
 * 子供側の交換確認ダイアログ (個数 stepper / 合計 / 交換後残高) と、その申請が
 * 親の承認画面に「<ごほうび名> × N」の 1 件として出るところまでを撮る。
 *
 * develop (修正前) でも同じ file を渡して before SS を撮れるよう、個数 stepper が
 * 無い場合は増加操作を skip する (存在しない testid で fail させない)。
 *
 * 使用例 (AUTH_MODE=local の dev server、専用 port):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5199 node scripts/capture.mjs \
 *     --flow child-shop-quantity-4407 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-shop-quantity-4407.mjs \
 *     --presets mobile,desktop \
 *     --base-url http://localhost:5199 --no-start-server \
 *     --out tmp/screenshots/pr-<N>/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * ログインボーナス / ページガイド / 特別報酬などのオーバーレイを閉じる。
 * 開いたままだと交換ボタンの click がオーバーレイに奪われる。
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
	for (let i = 0; i < 4; i++) {
		// Ark UI は閉じている dialog も DOM に残すため data-state="open" で実際に開いている物だけを見る
		const dialog = page.locator('[data-part="content"][data-state="open"]').first();
		if ((await dialog.count()) === 0) return;
		const closeBtn = dialog
			.locator('button')
			.filter({ hasText: /とじる|やったね|閉じる|OK|わかった|つぎへ|おわり/ })
			.first();
		if ((await closeBtn.count()) > 0) {
			await closeBtn.click().catch(() => {});
		} else {
			await dialog
				.locator('[aria-label="とじる"], [aria-label="閉じる"]')
				.first()
				.click()
				.catch(() => {});
		}
		await dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
	}
}

/** @param {import('playwright').Page} page */
async function selectChild(page) {
	// デモ Cookie が残っていると isDemo=true になり child 一覧が空になる
	await page.context().clearCookies();
	await page.goto(`${BASE_URL}/switch`);
	await page.locator('[data-testid^="child-select-"]').first().click();
	await page.waitForURL(/\/(preschool|elementary|junior|senior|baby)\//, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await selectChild(page);

	const uiMode = new URL(page.url()).pathname.split('/')[1];
	await page.goto(`${BASE_URL}/${uiMode}/shop`);
	await page.getByTestId('shop-page').waitFor({ state: 'visible', timeout: 15_000 });
	// ログインボーナス / ページガイド等のオーバーレイが交換ボタンの click を奪うため先に閉じる
	await dismissOverlays(page);
	await capture('ごほうびショップ 一覧');

	// 交換可能 (enabled) な交換ボタンを 1 つ選んで確認ダイアログを開く
	const enabledBtn = page.locator('button[data-testid^="exchange-btn-"]:not([disabled])').first();
	await enabledBtn.waitFor({ state: 'visible', timeout: 15_000 });
	await enabledBtn.click();

	const dialog = page.getByTestId('exchange-confirm-dialog');
	await dialog.waitFor({ state: 'visible', timeout: 15_000 });
	await capture('交換確認ダイアログ 既定 (個数 1)');

	// 個数 stepper がある版 (#4407 適用後) でのみ個数を増やす。
	// develop (修正前) には stepper が無いため skip して before SS を成立させる。
	const increase = page.getByTestId('confirm-quantity-increase');
	const hasStepper = await increase.count();
	if (hasStepper > 0) {
		for (let i = 0; i < 3; i++) {
			if (await increase.isDisabled().catch(() => true)) break;
			await increase.click();
			await page.getByTestId('confirm-quantity-value').waitFor({ state: 'visible' });
		}
		await capture('交換確認ダイアログ 個数を増やした状態 (合計 / 交換後残高)');
	}

	// 交換を確定し、結果が画面に文字で出ることを撮る (成功 Toast / エラー Toast)
	await page.getByTestId('confirm-exchange-yes').click();
	await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
	await page
		.locator('[role="status"], [role="alert"]')
		.first()
		.waitFor({ state: 'visible', timeout: 5_000 })
		.catch(() => {});
	await capture('交換の結果表示');

	// 親の承認画面: 個数つきの申請が 1 件として出る (承認なしモード = 既定のときのみ pending が残る)
	await page.goto(`${BASE_URL}/admin/rewards/requests`);
	await page
		.locator('h1, h2')
		.first()
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {});
	await capture('保護者 ごほうび申請承認');
};
