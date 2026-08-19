/**
 * scripts/capture-specs/flows/page-guide-walkthrough.mjs
 *
 * #4653 (EPIC #4650): ❓ ページガイドを全 step 通しで desktop + mobile の両 viewport で撮影する
 * 汎用 flow。ガイド是正 PR の Before / After 証跡 (各 step の spotlight 位置 + 文言) を残す。
 * 1 回の flow 実行で両 viewport を撮る (capture.mjs の flow モードは presetNames[0] だけを使うため、
 * flow 内で page.setViewportSize を切り替える)。
 *
 * 環境変数:
 *   GUIDE_PAGES  撮影するパスのコンマ区切り (既定 '/admin')。slug はパスから自動生成
 *   SS_LABEL     'before' | 'after' (既定 'after')。ファイル名 prefix になる
 *   BASE_URL     dev server (既定 http://localhost:5173)
 *
 * 出力 (flow モードの命名規則 = `NN-<label>.png`):
 *   NN-<SS_LABEL>-<slug>-<desktop|mobile>-step-<n>.png (+ .dom.html)
 * Before / After は step 数が違いうる (3 step 固定 → 必要数) ため NN が揃わない。PR body では
 * `<!-- ss-pair: before=… after=… -->` の明示宣言で step 単位にペアを取る (#4084)。
 *
 * 使用例 (Before は develop 版 guide に戻した状態で SS_LABEL=before、After は PR HEAD で after):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5240 SS_LABEL=after GUIDE_PAGES=/admin \
 *     node scripts/capture.mjs --flow page-guide-admin --url /admin \
 *     --actions scripts/capture-specs/flows/page-guide-walkthrough.mjs --pr <N> --no-start-server
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PAGES = (process.env.GUIDE_PAGES || '/admin')
	.split(',')
	.map((p) => p.trim())
	.filter(Boolean);
const LABEL = process.env.SS_LABEL === 'before' ? 'before' : 'after';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_OVERLAY = '[role="dialog"][aria-labelledby="page-guide-title"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';

const VIEWPORTS = [
	{ label: 'desktop', width: 1280, height: 800 },
	{ label: 'mobile', width: 390, height: 844 },
];

/** '/admin/rewards/requests' → 'admin-rewards-requests' */
function slugOf(path) {
	return (
		path
			.replace(/^\/+/, '')
			.replace(/[^\w-]+/g, '-')
			.replace(/-+$/, '') || 'root'
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
 * driver.js / bubble の fade-in / pulse を止め settled 状態で撮る (tests/e2e/page-guide-screenshots.spec.ts
 * と同じ test-only stylesheet。production component は不変)。goto 後に毎回注入する。
 */
async function freezeGuideAnimations(page) {
	await page.addStyleTag({
		content: `
			.driver-popover, .driver-popover *,
			.driver-overlay,
			.guide-bubble, .guide-bubble *,
			.driver-active-element {
				animation: none !important;
				transition: none !important;
			}
			.driver-popover, .guide-bubble, .driver-overlay { opacity: 1 !important; }
		`,
	});
}

/** bubble の box が 3 フレーム連続で不変になるまで rAF poll (scroll-into-view + 再配置の収束待ち)。 */
async function waitForBubbleSettled(page) {
	const bubble = page.locator(GUIDE_BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });
	let prev = '';
	let stable = 0;
	for (let i = 0; i < 60 && stable < 3; i++) {
		await page.evaluate(
			() =>
				new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))),
		);
		const box = await bubble.boundingBox();
		const key = box
			? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`
			: '';
		if (box && key === prev) stable++;
		else stable = 0;
		prev = key;
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const pagePath of PAGES) {
		const slug = slugOf(pagePath);
		for (const vp of VIEWPORTS) {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: 'domcontentloaded' });
			await dismissWelcome(page);
			await freezeGuideAnimations(page);

			const btn = page.locator(GUIDE_BTN);
			await btn.waitFor({ state: 'visible', timeout: 15_000 });
			await btn.first().click({ force: true });

			const bubble = page.locator(GUIDE_BUBBLE);
			await bubble.waitFor({ state: 'visible', timeout: 5_000 });

			const MAX_STEPS = 15;
			for (let i = 0; i < MAX_STEPS; i++) {
				await waitForBubbleSettled(page);
				await capture(`${LABEL}-${slug}-${vp.label}-step-${i + 1}`);

				const nextBtn = bubble.locator(GUIDE_NEXT);
				const nextText = (await nextBtn.textContent().catch(() => '')) ?? '';
				if (nextText.includes('かんりょう')) break;

				const prevStepId = await bubble.getAttribute('data-step-id').catch(() => null);
				await nextBtn.click();
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
	}
};
