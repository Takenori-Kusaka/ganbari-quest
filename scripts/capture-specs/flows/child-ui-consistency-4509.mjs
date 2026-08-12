/**
 * scripts/capture-specs/flows/child-ui-consistency-4509.mjs (#4509)
 *
 * 子供画面の表示整合 (経験値 / ポイント換算 / 年齢帯文言) を 5 年齢モードで撮る。
 * age-mode-check 手順 (baby / preschool / elementary / junior / senior) の証跡。
 *
 * 撮影対象:
 *   - チェックリスト (`/checklist`)            … ④ 年齢帯文言 + ⑥ 曜日名 / 時間帯
 *   - ごほうびショップ (`/{mode}/shop`)        … ② ポイント換算 (残高 / 価格 / 不足分)
 *   - きろく (`/{mode}/history`)               … ⑥ 日付整形 (がつ・にち / 月・日)
 * baby は準備モード (ADR-0011) で子供向けのきろく画面を持たないため home を撮る。
 *
 * develop (修正前) の before SS も同じ file で撮れるよう、要素の有無で分岐し
 * 存在しない testid で fail させない。
 *
 * 待機は全て条件待ち (#1208: scripts/ 配下で固定時間待機は禁止)。dev server の
 * 依存最適化による自動リロード (`optimized dependencies changed. reloading`) が
 * click と競合して navigation を落とすため、遷移は「URL 変化を条件に」再試行する。
 *
 * 使用例 (demo データの決定的環境、ADR-0048):
 *   AUTH_MODE=anonymous DATA_SOURCE=demo npm run dev -- --port 5210 --strictPort
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after BASE_URL=http://localhost:5210 \
 *   node scripts/capture.mjs --flow after-4509 --url /switch \
 *     --actions scripts/capture-specs/flows/child-ui-consistency-4509.mjs \
 *     --presets mobile --base-url http://localhost:5210 --max-steps 20 \
 *     --out tmp/screenshots/pr-<N>/
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
 * 開いたままだと本文が隠れ、モード間の比較にならない。
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
	await page.waitForLoadState('networkidle').catch(() => {});
	await page
		.waitForFunction(() => (document.body?.innerText ?? '').trim().length > 40, undefined, {
			timeout: 20_000,
		})
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
 * @param {string} path
 * @param {string} [anchor] 描画完了の判定に使う CSS セレクタ (viewport が白いまま撮るのを防ぐ)
 */
async function open(page, path, anchor) {
	await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
	await waitForBody(page);
	await dismissOverlays(page);
	if (anchor) {
		await page.locator(anchor).first().waitFor({ state: 'visible', timeout: 20_000 });
	}
	// 撮影は viewport 単位なので、演出や overlay でスクロールが動いていたら先頭に戻す
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForFunction(() => document.fonts?.status === 'loaded', undefined, {
		timeout: 10_000,
	}).catch(() => {});
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const { id, mode } of CHILDREN) {
		await selectChild(page, id);

		await open(page, '/checklist', 'main, body > div');
		await capture(`${PHASE}-${mode}-checklist`);

		await open(page, `/${mode}/shop`, '[data-testid="shop-page"]');
		await capture(`${PHASE}-${mode}-shop`);

		if (mode === 'baby') {
			// baby は準備モードで子供向けのきろく画面を持たず `/baby/history` は本文が空になる
			await open(page, '/baby/home', '[data-testid="baby-home-page"]');
			await capture(`${PHASE}-baby-home`);
		} else {
			await open(page, `/${mode}/history`, '[role="tablist"], [data-testid^="history-"]');
			await capture(`${PHASE}-${mode}-history`);
		}
	}
};
