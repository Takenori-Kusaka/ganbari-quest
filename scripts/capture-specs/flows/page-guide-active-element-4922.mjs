/**
 * scripts/capture-specs/flows/page-guide-active-element-4922.mjs
 *
 * #4922: ページガイドを進めると前の step の `.driver-active-element` クラスが外れず、
 * 複数の要素が同時に光ったままになる回帰の視覚証跡。
 *
 * driver.js の highlight アニメーション (既定 400ms) が完了する前に次 step へ進む
 * (現実的なクリック速度で普通に起こる) と、前 step の対象のクラス除去がスキップされる。
 * 本フローは「つぎへ」を待たずに素早く連打し、その状態でスクリーンショットを撮ることで
 * 本番実測 (/admin/subscription 3/6 で 3 要素が同時に光る) を再現する。
 *
 * before-*.png は develop HEAD (#4922 修正前) で撮ると `.driver-active-element` が
 * 複数要素に付き枠線が重なって見える。after-*.png は本 PR の修正後で単一要素だけが光る。
 *
 * 使用例 (認証済 admin dev server 上、`npm run dev` port 5173):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow page-guide-active-element-4922 \
 *     --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/page-guide-active-element-4922.mjs \
 *     --presets desktop \
 *     --pr 4930
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';

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
	await page.goto(`${BASE_URL}/admin/subscription`);
	await page.waitForLoadState('domcontentloaded');
	await dismissWelcome(page);

	const btn = page.locator(GUIDE_BTN);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	await btn.first().click({ force: true });

	const bubble = page.locator(GUIDE_BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });

	// #4922 repro: highlight アニメーション (既定 400ms) の完了を待たず「つぎへ」を
	// 連打する (現実的な素早いクリック速度)。step3 (画面の見方) まで進めて撮影する。
	// force:true で Playwright の actionability wait (安定待ち / pointer-events 確認)
	// を skip し、ボタンが DOM に現れた瞬間に click することでレースを最大化する。
	const nextBtn = bubble.locator(GUIDE_NEXT);
	await nextBtn.click({ force: true }); // step1 → step2
	await nextBtn.click({ force: true }); // step2 → step3 (待たずに連打)

	// bubble の表示だけは最低限待つ (step id が更新されたことの確認)。
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });

	const activeCount = await page.locator('.driver-active-element').count();
	console.log(`[page-guide-active-element-4922] .driver-active-element count = ${activeCount}`);

	await capture('subscription-step3-active-element');
};
