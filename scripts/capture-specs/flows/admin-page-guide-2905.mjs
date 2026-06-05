/**
 * scripts/capture-specs/flows/admin-page-guide-2905.mjs
 *
 * #2905 (EPIC #2897): admin 各ページの ❓ ページガイド復旧の視覚証跡。
 * #2294 EPIC で新設された checklists / challenges + status ページを
 * page-guide-registry に登録し、❓ ボタン → PageGuideOverlay が開く様子を撮る。
 *
 * #2926 (EPIC #2925 Sub-1): driver.js data-driven 化後のレンダリング検証 (AC4)。
 * /admin/activities のガイドを全 step 通し撮影し、PO 指摘 (a)(b)(c) — バブルの重複 /
 * 見切れ / spotlight 不全 — の解消を before/after 比較できる視覚証跡を残す。
 *
 * ❓ ボタンは AdminLayout の `{#if !isDemo && hasPageGuide}` gate 配下のため demo モードでは
 * 描画されない。本撮影は通常の認証済 admin (mode="live") の dev server 上で開き、user-gesture で
 * ❓ を click した overlay 表示状態を撮影する (demo env では ❓ が出ず撮影できない)。
 *
 * 使用例 (BASE_URL は認証済 admin を表示する dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-page-guide-2905 \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/admin-page-guide-2905.mjs \
 *     --presets desktop,mobile \
 *     --pr <N>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_OVERLAY = '[role="dialog"][aria-labelledby="page-guide-title"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';

/** #2294 EPIC で新設され #2905 で復旧した 3 ページ + 1 既存ページ */
const PAGES = [
	{ path: '/admin/checklists', label: 'page-guide-checklists' },
	{ path: '/admin/challenges', label: 'page-guide-challenges' },
	{ path: '/admin/status', label: 'page-guide-status' },
];

/** #2926: 全 step 通し撮影で (a)(b)(c) 解消を視覚検証するページ (PO 実機指摘の起点)。 */
const STEP_WALKTHROUGH_PAGES = [{ path: '/admin/activities', label: 'page-guide-activities-step' }];

/** rAF 2 回で driver.js の scroll-into-view + 配置 commit を待つ。 */
async function settleFrame(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/** admin home 初回訪問時の PremiumWelcome overlay が ❓ click を遮るため閉じる */
async function dismissWelcome(page) {
	const welcome = page.locator('.welcome-overlay');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) {
		const cta = welcome.locator('.welcome-cta');
		if (await cta.isVisible().catch(() => false)) {
			await cta.click();
			await welcome.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
		}
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const { path, label } of PAGES) {
		await page.goto(`${BASE_URL}${path}`);
		await page.waitForLoadState('domcontentloaded');
		await dismissWelcome(page);

		// ❓ ボタンが presence (= registry 登録済) であることを待つ
		const btn = page.locator(GUIDE_BTN);
		await btn.waitFor({ state: 'visible', timeout: 15_000 });

		// click → PageGuideOverlay が開く (dead-end でない)
		await btn.first().click({ force: true });
		await page.locator(GUIDE_OVERLAY).waitFor({ state: 'visible', timeout: 5_000 });
		// spotlight ring / bubble の transition / layout commit を確実に待つ
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);
		await capture(label);

		// 次ページのため overlay を閉じる
		await page.keyboard.press('Escape');
		await page
			.locator(GUIDE_OVERLAY)
			.waitFor({ state: 'hidden', timeout: 5_000 })
			.catch(() => {});
	}

	// #2926 (AC4): /admin/activities ガイドを全 step 通し撮影し、(a)(b)(c) 解消を視覚検証する。
	for (const { path, label } of STEP_WALKTHROUGH_PAGES) {
		await page.goto(`${BASE_URL}${path}`);
		await page.waitForLoadState('domcontentloaded');
		await dismissWelcome(page);

		const btn = page.locator(GUIDE_BTN);
		await btn.waitFor({ state: 'visible', timeout: 15_000 });
		await btn.first().click({ force: true });

		const bubble = page.locator(GUIDE_BUBBLE);
		await bubble.waitFor({ state: 'visible', timeout: 5_000 });

		const MAX_STEPS = 12;
		for (let i = 0; i < MAX_STEPS; i++) {
			await settleFrame(page);
			await bubble.waitFor({ state: 'visible', timeout: 5_000 });
			// step ごとに連番ラベルで撮影 (driver.js positioning + spotlight ring を記録)
			await capture(`${label}-${i + 1}`);

			const nextBtn = bubble.locator(GUIDE_NEXT);
			const nextText = (await nextBtn.textContent().catch(() => '')) ?? '';
			if (nextText.includes('かんりょう')) break;

			const prevStepId = await bubble.getAttribute('data-step-id').catch(() => null);
			await nextBtn.click();
			// step 遷移 (data-step-id 変化) を待ってから次 frame を撮る
			await page
				.waitForFunction(
					({ sel, prev }) => document.querySelector(sel)?.getAttribute('data-step-id') !== prev,
					{ sel: GUIDE_BUBBLE, prev: prevStepId },
					{ timeout: 5_000 },
				)
				.catch(() => {});
		}

		await page.keyboard.press('Escape');
		await page
			.locator(GUIDE_OVERLAY)
			.waitFor({ state: 'hidden', timeout: 5_000 })
			.catch(() => {});
	}
};
