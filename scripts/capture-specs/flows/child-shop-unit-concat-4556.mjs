/**
 * scripts/capture-specs/flows/child-shop-unit-concat-4556.mjs (#4556 ②)
 *
 * ごほうびショップの「数値 + 単位」連結を 5 年齢モードで撮る。
 * 一覧の不足分ヒント (`あと N ポイント`) と交換確認ダイアログの交換後残高
 * (`のこり: N ポイント`) が同じ連結になっていることの証跡。
 *
 * 撮影対象 (1 モードにつき 2 枚):
 *   - `/{mode}/shop`                … 一覧 (不足分ヒント。連結は develop から不変)
 *   - 交換確認ダイアログ open 状態  … 交換後残高 (**本 PR で連結が変わる箇所**)
 *
 * develop (修正前) の before も同じ file で撮れるよう、交換可能なごほうびが無いモード
 * (baby 等) ではダイアログ撮影を skip する (存在しない要素で fail させない)。
 * 待機は全て条件待ち (#1208: scripts/ 配下で固定時間待機は禁止)。
 *
 * 使用例 (demo データの決定的環境、ADR-0048):
 *   AUTH_MODE=anonymous DATA_SOURCE=demo npm run dev -- --port 5211 --strictPort
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after BASE_URL=http://localhost:5211 \
 *   node scripts/capture.mjs --flow after-4556 --url /switch \
 *     --actions scripts/capture-specs/flows/child-shop-unit-concat-4556.mjs \
 *     --presets mobile --base-url http://localhost:5211 --no-start-server \
 *     --max-steps 20 --out tmp/screenshots/pr-<N>/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
/**
 * `before` (develop) / `after` (本 PR) を同じ flow で撮り分けるためのラベル接頭辞。
 * screenshots branch は basename 平坦コピーなので、両者の file 名が衝突しないようにする。
 */
const PHASE = process.env.SS_PHASE || 'after';

/** demo-data.ts の 5 人 (age 1 / 5 / 8 / 14 / 17) = 5 年齢モード */
const CHILDREN = [
	{ id: 901, mode: 'baby' },
	{ id: 902, mode: 'preschool' },
	{ id: 903, mode: 'elementary' },
	{ id: 904, mode: 'junior' },
	{ id: 906, mode: 'senior' },
];

const CHILD_URL_RE = /\/(baby|preschool|elementary|junior|senior)\//;

/**
 * ログインボーナス / ページガイド等のオーバーレイを閉じる。
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

/**
 * 本文が描画され終わるまで待つ (空白 SS を撮らないため)。
 * @param {import('playwright').Page} page
 */
async function waitForBody(page) {
	// hydration (event handler 登録) が終わる前に交換ボタンを押しても click が握られない。
	// dev server は初回アクセスの route を compile するため、body の描画だけでは足りない。
	await page.waitForLoadState('networkidle').catch(() => {});
	await page
		.waitForFunction(() => (document.body?.innerText ?? '').trim().length > 40, undefined, {
			timeout: 20_000,
		})
		.catch(() => {});
	await page
		.waitForFunction(() => document.fonts?.status === 'loaded', undefined, { timeout: 10_000 })
		.catch(() => {});
}

/**
 * /switch から子供を選ぶ。form submit が hydration 前 / dev リロード中に落ちても、
 * 「URL が子供画面に変わる」ことを条件に再試行する。
 * @param {import('playwright').Page} page
 * @param {number} childId
 */
async function selectChild(page, childId) {
	for (let attempt = 1; attempt <= 4; attempt++) {
		await page.goto(`${BASE_URL}/switch`, { waitUntil: 'load' });
		await waitForBody(page);
		const button = page.locator(`[data-testid="child-select-${childId}"]`).first();
		await button.waitFor({ state: 'visible', timeout: 20_000 });
		await button.click().catch(() => {});
		try {
			await page.waitForURL(CHILD_URL_RE, { timeout: 15_000 });
			await dismissOverlays(page);
			return;
		} catch {
			if (attempt === 4) throw new Error(`子供 ${childId} の選択が ${attempt} 回失敗しました`);
		}
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const { id, mode } of CHILDREN) {
		await selectChild(page, id);

		// dev server の依存最適化による自動リロードが goto と競合して
		// `net::ERR_ABORTED` になるため、ショップ画面が出ることを条件に再試行する。
		for (let attempt = 1; attempt <= 4; attempt++) {
			await page.goto(`${BASE_URL}/${mode}/shop`, { waitUntil: 'load' }).catch(() => {});
			const shown = await page
				.getByTestId('shop-page')
				.waitFor({ state: 'visible', timeout: 20_000 })
				.then(() => true)
				.catch(() => false);
			if (shown) break;
			if (attempt === 4) throw new Error(`${mode} のショップ画面が表示されませんでした`);
		}
		await waitForBody(page);
		await dismissOverlays(page);
		await page.evaluate(() => window.scrollTo(0, 0));
		await capture(`${PHASE}-${mode}-shop-list`);

		// 交換確認ダイアログ (交換後残高 = 本 PR で連結が変わる箇所)
		const enabledBtn = page.locator('button[data-testid^="exchange-btn-"]:not([disabled])').first();
		if ((await enabledBtn.count()) === 0) continue;

		const dialog = page.getByTestId('exchange-confirm-dialog');
		let opened = false;
		// hydration 完了前の click は握られないため、dialog が開くまで再試行する
		for (let i = 0; i < 6; i++) {
			await enabledBtn.click().catch(() => {});
			opened = await dialog
				.waitFor({ state: 'visible', timeout: 3_000 })
				.then(() => true)
				.catch(() => false);
			if (opened) break;
		}
		if (!opened) continue;

		// 交換後残高の行が描画されてから撮る (数字が入る前の空表示を撮らない)
		await page
			.getByTestId('confirm-remaining-after')
			.waitFor({ state: 'visible', timeout: 5_000 })
			.catch(() => {});
		await capture(`${PHASE}-${mode}-shop-confirm-dialog`);

		// 次のモードへ行く前に閉じる (開いたままだと /switch 遷移が奪われる)
		await page.keyboard.press('Escape').catch(() => {});
		await dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
	}
};
