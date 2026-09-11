/**
 * scripts/capture-specs/flows/page-guide-walkthrough.mjs
 *
 * 任意の admin / marketplace ページで ❓ ページガイドを起動し、全 step を「つぎへ」で
 * 通しながら 1 step = 1 枚で撮影する汎用フロー (#4650 EPIC の各ページガイド是正 PR 共通)。
 * ページごとの専用 flow (subscription-guide-3267.mjs 等) を量産しないための generic 版 (#1442)。
 *
 * 呼び出し方は 2 通りある (どちらも本 flow が受ける):
 *   (A) 1 ページ / 1 viewport (--presets で viewport を指定して複数回実行する)
 *   (B) Before / After 証跡モード (SS_LABEL 指定): 複数パス × desktop + mobile を 1 回で撮る
 *       (capture.mjs の flow モードは presetNames[0] だけを使うため、flow 内で viewport を切替える)
 *
 * 環境変数:
 *   GUIDE_PATH   撮影対象パス (例: /admin/subscription)。既定 /admin
 *   GUIDE_PAGES  撮影するパスのコンマ区切り (複数ページを 1 回で撮る。GUIDE_PATH より優先)
 *   GUIDE_LABEL  撮影ファイル名の prefix (例: subscription-guide)。既定は path から自動生成
 *   SS_LABEL     'before' | 'after'。指定すると (B) モード = ファイル名 prefix になり、
 *                desktop + mobile の両 viewport を 1 回の実行で撮る
 *   GUIDE_PRE_CLICK  ❓ を押す前に click する Playwright selector (任意。例: タブ切替
 *                    `button.tab-btn:has-text("週次レポート")`)。タブ依存 step の撮影に使う
 *   BASE_URL     dev server (既定 http://localhost:5173)
 *
 * 出力 (flow モードの命名規則 = `NN-<label>.png`):
 *   (A) NN-<GUIDE_LABEL>-<n>-<stepId>.png
 *   (B) NN-<SS_LABEL>-<slug>-<desktop|mobile>-step-<n>.png (+ .dom.html)
 * (B) の Before / After は step 数が違いうる (3 step 固定 → 必要数) ため NN が揃わない。PR body では
 * `<!-- ss-pair: before=… after=… -->` の明示宣言で step 単位にペアを取る (#4084)。
 *
 * 使用例 (A):
 *   MSYS_NO_PATHCONV=1 GUIDE_PATH=/admin/subscription GUIDE_LABEL=subscription-guide \
 *     node scripts/capture.mjs --flow subscription-guide-desktop --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/page-guide-walkthrough.mjs --presets desktop \
 *     --base-url http://localhost:5272 --no-start-server --out tmp/screenshots/guides
 *
 * 使用例 (B) (Before は develop 版 guide に戻した状態で SS_LABEL=before、After は PR HEAD で after):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5240 SS_LABEL=after GUIDE_PAGES=/admin \
 *     node scripts/capture.mjs --flow page-guide-admin --url /admin \
 *     --actions scripts/capture-specs/flows/page-guide-walkthrough.mjs --pr <N> --no-start-server
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PAGES = (process.env.GUIDE_PAGES || process.env.GUIDE_PATH || '/admin')
	.split(',')
	.map((p) => p.trim())
	.filter(Boolean);
/** '' なら (A) モード。'before' / 'after' なら (B) Before/After 証跡モード */
const SS_LABEL =
	process.env.SS_LABEL === 'before' ? 'before' : process.env.SS_LABEL === 'after' ? 'after' : '';
const GUIDE_LABEL = process.env.GUIDE_LABEL || '';
const GUIDE_PRE_CLICK = process.env.GUIDE_PRE_CLICK || '';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_OVERLAY = '[role="dialog"][aria-labelledby="page-guide-title"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';

/** (B) モードで切り替える viewport。(A) モードは --presets の viewport をそのまま使う */
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
 * 1 ページ分のガイドを開いて全 step を撮る。
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 * @param {string} pagePath 撮影対象パス
 * @param {(index: number, stepId: string) => string} labelOf ファイル名 label の組み立て
 */
async function walkGuide(page, capture, pagePath, labelOf) {
	await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: 'domcontentloaded' });
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

	const MAX_STEPS = 15;
	for (let i = 0; i < MAX_STEPS; i++) {
		await waitForBubbleSettled(page);
		const stepId = (await bubble.getAttribute('data-step-id').catch(() => null)) ?? `step${i + 1}`;
		await capture(labelOf(i + 1, stepId));

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
		const slug = slugOf(pagePath);
		const prefix = GUIDE_LABEL || `${slug}-guide`;
		if (SS_LABEL === '') {
			// (A) --presets の viewport のまま 1 ページ分を撮る
			await walkGuide(page, capture, pagePath, (n, stepId) => `${prefix}-${n}-${stepId}`);
			continue;
		}
		// (B) Before / After 証跡: desktop + mobile を 1 回の実行で撮る
		for (const vp of VIEWPORTS) {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await walkGuide(page, capture, pagePath, (n) => `${SS_LABEL}-${slug}-${vp.label}-step-${n}`);
		}
	}
};
