/**
 * scripts/capture-specs/flows/page-guide-steps.mjs
 *
 * 汎用: 任意ページの ❓ ページガイドを開き、全 step を順に撮影する (#4677、EPIC #4650)。
 * ガイド定義を直す PR の before / after SS を同じ手順で撮るための共通フロー。
 * step ごとの label は `<GUIDE_SS_PREFIX>-<GUIDE_SS_PRESET>-<data-step-id>` になるため、
 * before / after を別 flow 名で撮っても screenshots branch 上で basename が衝突しない。
 * PR body では `<!-- ss-pair: before=... after=... -->` で step id ごとに対応を宣言する
 * (step 数が before / after で変わる前提。`src/routes/CLAUDE.md` §SS の命名規約)。
 *
 * 使用例 (dev server は --pr 指定で自動起動。対象 URL は --url):
 *   GUIDE_SS_PREFIX=after GUIDE_SS_PRESET=mobile MSYS_NO_PATHCONV=1 \
 *     node scripts/capture.mjs --pr <N> --flow after-mp-guide-mobile \
 *     --url /marketplace --actions scripts/capture-specs/flows/page-guide-steps.mjs --presets mobile
 *
 * env:
 *   GUIDE_SS_PREFIX  before | after (既定 after)
 *   GUIDE_SS_PRESET  desktop | mobile (label 用。viewport 自体は --presets で指定)
 *   GUIDE_SS_CHILD   /switch で先に選ぶお子さまの表示名 (selectedChildId cookie を立てたいとき)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PREFIX = process.env.GUIDE_SS_PREFIX || 'after';
const PRESET = process.env.GUIDE_SS_PRESET || 'desktop';
const CHILD = process.env.GUIDE_SS_CHILD || '';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';

/** rAF 2 回で driver.js の scroll-into-view + 配置 commit を待つ。 */
async function settleFrame(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/** driver.js の smoothScroll + fade が静止する (bubble box が 2 連続不変) まで待つ。 */
async function waitForBubbleStable(page, bubble) {
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
	if (CHILD) {
		// selectedChildId cookie を立ててから対象ページへ戻る (年齢自動フィルタ等の条件付き UI 用)
		const target = page.url();
		for (let attempt = 0; attempt < 4; attempt++) {
			await page.goto(`${BASE_URL}/switch`, { waitUntil: 'domcontentloaded' });
			const btn = page.locator('[data-testid^="child-select-"]').filter({ hasText: CHILD });
			await btn.waitFor({ state: 'visible', timeout: 30_000 });
			await btn.click();
			const arrived = await page
				.waitForURL(/\/(baby|preschool|elementary|junior|senior)\/home/, { timeout: 10_000 })
				.then(() => true)
				.catch(() => false);
			if (arrived) break;
		}
		await page.goto(target, { waitUntil: 'domcontentloaded' });
	}
	await dismissWelcome(page);

	const btn = page.locator(GUIDE_BTN);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	await btn.first().click({ force: true });

	const bubble = page.locator(GUIDE_BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });

	const MAX_STEPS = 12;
	for (let i = 0; i < MAX_STEPS; i++) {
		await waitForBubbleStable(page, bubble);
		const stepId = (await bubble.getAttribute('data-step-id')) ?? `step${i + 1}`;
		await capture(`${PREFIX}-${PRESET}-${stepId}`);

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
};
