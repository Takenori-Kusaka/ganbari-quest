/**
 * scripts/capture-specs/flows/child-shop-exchange-copy-4684.mjs (#4684)
 *
 * ごほうびショップの「このあと何が起きるか」の説明が、家庭設定 (即時交換 ON / OFF) と
 * 一致することを撮る SS フロー。あわせて 390px 幅のごほうび名折返しと、
 * 「いまこうかんできる」フィルタの件数バッジも撮る。
 *
 * develop (修正前) でも同じ file を渡して before SS を撮れるよう、
 * 存在しない testid には触れない / 失敗しても続行する作りにする。
 *
 * 使用例 (AUTH_MODE=local の dev server、専用 port):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5199 node scripts/capture.mjs \
 *     --flow child-shop-exchange-copy-4684 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-shop-exchange-copy-4684.mjs \
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
	await page.context().clearCookies();
	// hydration 前 / オーバーレイに click を奪われることがあるため、遷移するまで再試行する
	for (let i = 0; i < 5; i++) {
		await page.goto(`${BASE_URL}/switch`);
		await dismissOverlays(page);
		const card = page.locator('[data-testid^="child-select-"]').first();
		await card.waitFor({ state: 'visible', timeout: 15_000 });
		await card.click({ timeout: 10_000 }).catch(() => {});
		try {
			await page.waitForURL(/\/(preschool|elementary|junior|senior|baby)\//, { timeout: 10_000 });
			return new URL(page.url()).pathname.split('/')[1];
		} catch {
			// 次のループで再試行
		}
	}
	throw new Error('お子さま選択から子供画面へ遷移できなかった');
}

/**
 * 家庭設定「ごほうび交換のしかた」を目的の状態にする。
 * @param {import('playwright').Page} page
 * @param {'instant' | 'require'} target
 */
async function setRewardApproval(page, target) {
	await page.goto(`${BASE_URL}/admin/settings/rules`);
	const toggle = page.getByTestId('rules-reward-approval-toggle');
	if ((await toggle.count()) === 0) return;
	await toggle.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	const label = (await toggle.textContent().catch(() => '')) ?? '';
	const wantsInstant = label.includes('即時');
	if ((target === 'instant') !== wantsInstant) return; // 既に目的の状態
	await toggle.click().catch(() => {});
	// 承認必須 → 即時交換 の向きだけ確認ダイアログを挟む (#4023)
	const accept = page.getByTestId('rules-confirm-accept');
	if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => {});
	await page
		.getByTestId('rules-action-success')
		.waitFor({ state: 'visible', timeout: 10_000 })
		.catch(() => {});
}

/**
 * ショップで交換確認ダイアログを開く (hydration 前 click 対策の再試行つき)。
 * @param {import('playwright').Page} page
 * @param {string} uiMode
 */
async function openConfirmDialog(page, uiMode) {
	await page.goto(`${BASE_URL}/${uiMode}/shop`);
	await page.getByTestId('shop-page').waitFor({ state: 'visible', timeout: 15_000 });
	await dismissOverlays(page);
	const enabledBtn = page.locator('button[data-testid^="exchange-btn-"]:not([disabled])').first();
	await enabledBtn.waitFor({ state: 'visible', timeout: 15_000 });
	const dialog = page.getByTestId('exchange-confirm-dialog');
	for (let i = 0; i < 6; i++) {
		await enabledBtn.click().catch(() => {});
		try {
			await dialog.waitFor({ state: 'visible', timeout: 4_000 });
			return dialog;
		} catch {
			await dismissOverlays(page);
		}
	}
	await dialog.waitFor({ state: 'visible', timeout: 10_000 });
	return dialog;
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	const uiMode = await selectChild(page);

	// 1. 承認モード (既定) の一覧 — ごほうび名の折返し / フィルタ行
	await setRewardApproval(page, 'require');
	await page.goto(`${BASE_URL}/${uiMode}/shop`);
	await page.getByTestId('shop-page').waitFor({ state: 'visible', timeout: 15_000 });
	await dismissOverlays(page);
	await page.evaluate(() => window.scrollTo(0, 0));
	await capture('ごほうびショップ 一覧 (ごほうび名の折返し)');

	// 2. 「いまこうかんできる」フィルタ ON の件数バッジ
	const availableFilter = page.getByTestId('filter-available').first();
	if ((await availableFilter.count()) > 0) {
		await availableFilter.check().catch(() => {});
		await page
			.getByTestId('filter-badge')
			.first()
			.waitFor({ state: 'visible', timeout: 5_000 })
			.catch(() => {});
		await page.evaluate(() => window.scrollTo(0, 0));
		await capture('いまこうかんできる フィルタの件数');
		await availableFilter.uncheck().catch(() => {});
	}

	// 3. 承認モードの確認ダイアログ (「おうちのひとが みたら へんじがくるよ」)
	await openConfirmDialog(page, uiMode);
	await capture('交換確認ダイアログ 承認モード');

	// 4. 即時交換 ON に切替えてから同じダイアログ (「すぐに こうかんするよ」)
	await setRewardApproval(page, 'instant');
	await openConfirmDialog(page, uiMode);
	await capture('交換確認ダイアログ 即時交換 ON');

	// 5. 後片付け: 家庭設定を既定 (承認必須) に戻す
	await setRewardApproval(page, 'require');
};
