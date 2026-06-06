/**
 * scripts/lib/page-guide-capture.mjs (#2928、EPIC #2925 Sub-3)
 *
 * ページガイド (driver.js 委譲後、#2926) の "open + settled 状態" を決定的に撮影するための
 * 共有ヘルパ SSOT。`ScreenshotCapture` の `interact` hook (#2928) に渡して使う。
 *
 * 背景:
 *   ガイド open 状態は driver.js popover の fade-in (.2s) + Svelte bubble の appear (.3s) +
 *   spotlight ring の pulse (1.8s infinite) が乗るため、rAF×2 で撮ると half-opacity / 任意 pulse
 *   位相が写り pixelmatch baseline が非決定的になる (PR #2930 QM Re-BLOCK 1 と同根)。
 *   本ヘルパは tests/e2e/page-guide-screenshots.spec.ts で確立した
 *   freeze-animations + opacity===1 + box 安定待ち の二重防御を共有化し、
 *   app 層 visual baseline (scripts/app-screenshot-baseline/) でも同じ settled 状態を撮る。
 *
 * 使い方 (capture-app-baseline.mjs):
 *   await capture.capture({
 *     url: '/admin/activities',
 *     name: 'app-admin-activities-guide',
 *     viewport: MOBILE,
 *     format: 'webp',
 *     fullPage: false,             // ガイドバブルは viewport 相対のため viewport 撮影
 *     interact: openPageGuide,     // 本ヘルパ
 *   });
 *
 * 関連:
 *   - tests/e2e/page-guide-screenshots.spec.ts (同 settled ロジックの E2E 版、SS Before/After)
 *   - tests/e2e/page-guide-layout-invariant.spec.ts (#2926 geometry invariant、本 baseline と両輪)
 *   - scripts/capture-specs/flows/admin-page-guide-2905.mjs (PR 証跡 SS 撮影、generic flow)
 *   - scripts/lib/screenshot-helpers.mjs ScreenshotCapture.capture({ interact }) (#2928)
 */

/** ❓ ガイド起動ボタン (AdminLayout.svelte `data-tutorial="page-guide-btn"`)。 */
export const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
/** driver.js popover 内に mount される 3 タブ UI のバブル本体 (PageGuideBubble)。 */
export const GUIDE_BUBBLE = '.guide-bubble';

/**
 * admin home 初回訪問時の PremiumWelcome overlay が ❓ click を遮るため閉じる。
 * (tests/e2e/page-guide-*.spec.ts / capture-specs/flows/admin-page-guide-2905.mjs と同ロジック)
 * @param {import('playwright').Page} page
 */
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
 * test-only stylesheet を注入し、driver.js / Svelte bubble の fade-in / pulse / transition を
 * 無効化して opacity を 1 に固定する。production component は触らず、撮影時の "settled" 状態を
 * 決定的に作る (pixelmatch baseline の決定性確保)。`addStyleTag` は navigation で消えるため
 * goto 後・撮影前に呼ぶ。popover は body 直下に都度生成されるが style tag は <head> 常駐で効き続ける。
 * @param {import('playwright').Page} page
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

/**
 * bubble が "settled" (computed opacity===1、box が 3 連続不変) になるまで待つ。
 * waitForTimeout は使わず rAF ベースで poll する。
 * @param {import('playwright').Page} page
 */
async function waitForBubbleSettled(page) {
	const bubble = page.locator(GUIDE_BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });
	await page.waitForFunction(
		(sel) => {
			const el = document.querySelector(sel);
			if (!el) return false;
			const op = Number.parseFloat(getComputedStyle(el).opacity || '1');
			const pop = el.closest('.driver-popover');
			const popOp = pop ? Number.parseFloat(getComputedStyle(pop).opacity || '1') : 1;
			return op >= 0.999 && popOp >= 0.999;
		},
		GUIDE_BUBBLE,
		{ timeout: 5_000 },
	);
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
 * `ScreenshotCapture.capture({ interact })` hook 用: admin ページの ❓ ガイドを開き、
 * 最初の step を settled 状態にして撮影できる状態にする。
 *
 * ガイドの 1 step 目 (Sub-2 #2927 narrative で「① ページ概要」) を撮るのは、
 * 全 step baseline 化 (no-go) を避けつつ「ガイド open レンダリングが壊れていないか」
 * (重複 / 見切れ / spotlight 不全) を pixel で検出するため。geometry の全 step 網羅は
 * page-guide-layout-invariant.spec.ts が担う (両輪、Issue #2928 alternatives)。
 *
 * @param {import('playwright').Page} page
 */
export async function openPageGuide(page) {
	await dismissWelcome(page);
	await freezeGuideAnimations(page);

	const btn = page.locator(GUIDE_BTN);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	await btn.first().click({ force: true });

	await waitForBubbleSettled(page);
}
