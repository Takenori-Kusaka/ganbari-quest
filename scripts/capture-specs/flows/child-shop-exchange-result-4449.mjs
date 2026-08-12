/**
 * scripts/capture-specs/flows/child-shop-exchange-result-4449.mjs (#4449)
 *
 * ごほうび交換の「押したあとに何が伝わるか」を baby 以外の 4 モード
 * (preschool / elementary / junior / senior) で撮る。
 *
 * 既定設定 (親の承認が要る) では作られるのは申請だけでポイントは 1 も減っていないため、
 * 紙吹雪 / ファンファーレ / 振動を出さず、文字の結果 (「おうちのひとに おねがいしたよ」)
 * だけを出す。SS では「確認ダイアログ」→「結果表示」の 2 枚を各モードで撮り、
 * 4 モードで文言が読めること (AC5) を目視判定できるようにする。
 *
 * 音 / 振動は SS に写らないので、紙吹雪 canvas の有無を E2E
 * (`tests/e2e/child-shop-exchange.spec.ts`) と unit test 側で機械的に固定している。
 *
 * 使用例 (AUTH_MODE=local の dev server、専用 port):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5197 node scripts/capture.mjs \
 *     --flow child-shop-exchange-result-4449 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-shop-exchange-result-4449.mjs \
 *     --presets mobile \
 *     --base-url http://localhost:5197 --no-start-server \
 *     --max-steps 12 --out tmp/screenshots/pr-<N>/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** 撮る年齢モード (baby はゲーミフィケーション非適用 = ADR-0011 のため対象外)。 */
const TARGET_MODES = ['preschool', 'elementary', 'junior', 'senior'];

/**
 * ログインボーナス / ページガイド等のオーバーレイを閉じる。
 * 開いたままだと交換ボタンの click がオーバーレイに奪われる。
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
	for (let i = 0; i < 4; i++) {
		// Ark UI は閉じている dialog も DOM に残すため data-state="open" だけを見る
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

/**
 * 指定モードの子供を選ぶ。デモ Cookie が残っていると child 一覧が空になるため毎回消す。
 * @param {import('playwright').Page} page
 * @param {string} mode
 * @returns {Promise<boolean>} 選べたか
 */
async function selectChildForMode(page, mode) {
	await page.context().clearCookies();
	await page.goto(`${BASE_URL}/switch`);
	const cards = page.locator('[data-testid^="child-select-"]');
	await cards.first().waitFor({ state: 'visible', timeout: 30_000 });
	const count = await cards.count();
	for (let i = 0; i < count; i++) {
		// hydration 前の click は握られないため、遷移するまで数回試す
		let moved = false;
		for (let attempt = 0; attempt < 5 && !moved; attempt++) {
			await cards
				.nth(i)
				.click()
				.catch(() => {});
			moved = await page
				.waitForURL(/\/(preschool|elementary|junior|senior|baby)\//, { timeout: 6_000 })
				.then(() => true)
				.catch(() => false);
		}
		if (!moved) continue;
		if (new URL(page.url()).pathname.split('/')[1] === mode) return true;
		await page.context().clearCookies();
		await page.goto(`${BASE_URL}/switch`);
		await cards.first().waitFor({ state: 'visible', timeout: 30_000 });
	}
	return false;
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const mode of TARGET_MODES) {
		if (!(await selectChildForMode(page, mode))) continue;

		await page.goto(`${BASE_URL}/${mode}/shop`);
		await page.getByTestId('shop-page').waitFor({ state: 'visible', timeout: 15_000 });
		await dismissOverlays(page);

		// 交換可能 (enabled) な交換ボタンで確認ダイアログを開く。
		// hydration 前の click は握られないため dialog が開くまで再試行する。
		const enabledBtn = page.locator('button[data-testid^="exchange-btn-"]:not([disabled])').first();
		await enabledBtn.waitFor({ state: 'visible', timeout: 15_000 });
		const dialog = page.getByTestId('exchange-confirm-dialog');
		for (let i = 0; i < 6; i++) {
			// ページガイド / おやカギコード案内は hydration 後に開くため、毎回閉じ直す
			await dismissOverlays(page);
			await enabledBtn.click({ timeout: 4_000 }).catch(() => {});
			try {
				await dialog.waitFor({ state: 'visible', timeout: 4_000 });
				break;
			} catch {
				await dismissOverlays(page);
			}
		}
		await dialog.waitFor({ state: 'visible', timeout: 10_000 });
		await capture(`${mode} 交換確認ダイアログ`);

		// 確定 → 結果 (承認待ちなので「おうちのひとに おねがいしたよ」)
		await page.getByTestId('confirm-exchange-yes').click();
		await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
		await page
			.locator('[role="status"], [role="alert"]')
			.first()
			.waitFor({ state: 'visible', timeout: 8_000 })
			.catch(() => {});
		await capture(`${mode} 交換の結果表示 (申請だけ / 祝福なし)`);
	}
};
