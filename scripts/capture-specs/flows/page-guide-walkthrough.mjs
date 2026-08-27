/**
 * scripts/capture-specs/flows/page-guide-walkthrough.mjs
 *
 * 任意の admin / marketplace ページで ❓ ページガイドを起動し、全 step を「つぎへ」で
 * 通しながら 1 step = 1 枚で撮影する汎用フロー (#4650 EPIC の各ページガイド是正 PR 共通)。
 * ページごとの専用 flow (subscription-guide-3267.mjs 等) を量産しないための generic 版 (#1442)。
 *
 * 環境変数:
 *   GUIDE_PATH   撮影対象パス (例: /admin/subscription)。既定 /admin
 *   GUIDE_PAGES  複数ページをまとめて撮るときのコンマ区切り (#4653)。指定時は GUIDE_PATH より優先し、
 *                ファイル名の slug はパスから自動生成する
 *   GUIDE_LABEL  撮影ファイル名の prefix (例: subscription-guide)。既定は path から自動生成
 *   GUIDE_VIEWPORTS  'desktop,mobile' のように指定すると flow 内で viewport を切り替えて両方撮る
 *                    (#4653)。未指定なら viewport は capture.mjs の --presets に委ねる (既定挙動)
 *   SS_LABEL     'before' | 'after' (#4653)。指定時のみファイル名の先頭に付き Before/After 証跡を分ける
 *   GUIDE_PRE_CLICK  ❓ を押す前に click する Playwright selector (任意。例: タブ切替
 *                    `button.tab-btn:has-text("週次レポート")`)。タブ依存 step の撮影に使う
 *   BASE_URL     dev server (既定 http://localhost:5173)
 *
 * 使用例 (desktop / mobile は --presets を変えて 2 回実行する):
 *   MSYS_NO_PATHCONV=1 GUIDE_PATH=/admin/subscription GUIDE_LABEL=subscription-guide \
 *     node scripts/capture.mjs --flow subscription-guide-desktop --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/page-guide-walkthrough.mjs --presets desktop \
 *     --base-url http://localhost:5272 --no-start-server --out tmp/screenshots/guides
 *
 * 使用例 (#4653 Before / After を 1 実行で両 viewport 撮る):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5240 SS_LABEL=after GUIDE_PAGES=/admin \
 *     GUIDE_VIEWPORTS=desktop,mobile node scripts/capture.mjs --flow page-guide-admin --url /admin \
 *     --actions scripts/capture-specs/flows/page-guide-walkthrough.mjs --pr <N> --no-start-server
 *   Before / After は step 数が違いうるため NN が揃わない。PR body では
 *   `<!-- ss-pair: before=… after=… -->` の明示宣言で step 単位にペアを取る (#4084)。
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const GUIDE_PATH = process.env.GUIDE_PATH || '/admin';
const GUIDE_PAGES = (process.env.GUIDE_PAGES || '')
	.split(',')
	.map((p) => p.trim())
	.filter(Boolean);
const PAGES = GUIDE_PAGES.length > 0 ? GUIDE_PAGES : [GUIDE_PATH];
const GUIDE_LABEL = process.env.GUIDE_LABEL || '';
const GUIDE_PRE_CLICK = process.env.GUIDE_PRE_CLICK || '';
const SS_LABEL = process.env.SS_LABEL === 'before' ? 'before' : process.env.SS_LABEL ? 'after' : '';

const VIEWPORT_PRESETS = {
	desktop: { width: 1280, height: 800 },
	mobile: { width: 390, height: 844 },
};
/** 未指定なら [null] = viewport を切り替えず capture.mjs の --presets に委ねる (既定挙動)。 */
const VIEWPORTS = (process.env.GUIDE_VIEWPORTS || '')
	.split(',')
	.map((v) => v.trim())
	.filter((v) => v in VIEWPORT_PRESETS);

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_OVERLAY = '[role="dialog"][aria-labelledby="page-guide-title"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';

/** '/admin/rewards/requests' → 'admin-rewards-requests-guide' */
function labelOf(path) {
	if (GUIDE_LABEL) return GUIDE_LABEL;
	return `${path.replace(/^\/+/, '').replace(/[^\w]+/g, '-') || 'root'}-guide`;
}

/** rAF 2 回で driver.js の scroll-into-view + 配置 commit を待つ。 */
async function settleFrame(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/** バブルの位置が 2 frame 連続で不変になるまで待つ (smoothScroll / fade 完了の代替)。 */
async function waitForBubbleStable(page) {
	const bubble = page.locator(GUIDE_BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });
	let prev = '';
	let stable = 0;
	for (let i = 0; i < 60 && stable < 2; i++) {
		await settleFrame(page);
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
 * driver.js / bubble の fade-in / pulse を止め settled 状態で撮る (#4653、
 * tests/e2e/page-guide-screenshots.spec.ts と同じ test-only stylesheet。production component は不変)。
 * goto 後に毎回注入する。
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

/** 1 ページ 1 viewport 分のガイドを通しで撮る。 */
async function walkGuide(page, capture, pagePath, vpLabel) {
	await page.goto(`${BASE_URL}${pagePath}`);
	await page.waitForLoadState('domcontentloaded');
	await dismissWelcome(page);
	await freezeGuideAnimations(page);

	const btn = page.locator(GUIDE_BTN);
	// ❓ は hydration 後の $effect で描画される = これが出れば click 可能 (pre-click を hydration 前に打たない)
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	if (GUIDE_PRE_CLICK) {
		await page.locator(GUIDE_PRE_CLICK).first().click();
		await settleFrame(page);
	}
	await btn.first().click({ force: true });
	await page.locator(GUIDE_OVERLAY).waitFor({ state: 'visible', timeout: 8_000 });

	const bubble = page.locator(GUIDE_BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });

	const prefix = [SS_LABEL, labelOf(pagePath), vpLabel].filter(Boolean).join('-');
	const MAX_STEPS = 15;
	for (let i = 0; i < MAX_STEPS; i++) {
		await waitForBubbleStable(page);
		const stepId = (await bubble.getAttribute('data-step-id').catch(() => null)) ?? `step${i + 1}`;
		await capture(`${prefix}-${i + 1}-${stepId}`);

		const nextBtn = bubble.locator(GUIDE_NEXT);
		const nextText = (await nextBtn.textContent().catch(() => '')) ?? '';
		if (nextText.includes('かんりょう')) break;

		await nextBtn.click();
		await page
			.waitForFunction(
				({ sel, prev }) => document.querySelector(sel)?.getAttribute('data-step-id') !== prev,
				{ sel: GUIDE_BUBBLE, prev: stepId },
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

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const pagePath of PAGES) {
		if (VIEWPORTS.length === 0) {
			await walkGuide(page, capture, pagePath, '');
			continue;
		}
		for (const vpLabel of VIEWPORTS) {
			await page.setViewportSize(VIEWPORT_PRESETS[vpLabel]);
			await walkGuide(page, capture, pagePath, vpLabel);
		}
	}
};
