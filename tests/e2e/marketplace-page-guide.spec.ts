// tests/e2e/marketplace-page-guide.spec.ts
// #3263 (EPIC #3260 F2) / #3269 (C5): marketplace ページガイド機構 + 取込 CUJ コンテンツ。
//
// marketplace は AdminLayout 非使用のため独自配線 (marketplace/+layout.svelte)。
// 検証する機構 (admin-page-guide.spec.ts と同型、open → act → outcome):
// 1. /marketplace 一覧で ❓ ボタン (`[data-tutorial="page-guide-btn"]`) が 1 個表示される
// 2. ❓ click で PageGuideOverlay (.guide-overlay) が開く (role/aria 属性正しい)
// 3. 「とじる」(.guide-nav-end) で PageGuideOverlay が閉じる (dead-end でない)
// 4. 一覧ガイドを全 3 step 通せる + 各 step でバブル非重複 / viewport 収容 / spotlight (取込 CUJ 案内、#3269)
// 5. 詳細ルート /marketplace/<type>/<itemId> では dedicated 詳細ガイドが開く (親へ degrade しない、#3269)
//    + 全 3 step 通過 + 各 step で非重複 / viewport 収容 / spotlight
//
// 非重複 / viewport 収容 / spotlight の幾何検証は page-guide-layout-invariant.spec.ts (#2926) の
// 確立ロジック (driver.js の #driver-dummy-element 0×0 skip + 幾何回避不能 exempt + bubble-stable 待ち)
// をそのまま用いる。layout invariant suite は admin 限定 + 静的パスのため、動的 itemId を要する
// marketplace 詳細・一覧は本 spec で同等検証する (#3269)。
//
// 実行: npx playwright test tests/e2e/marketplace-page-guide.spec.ts

import { expect, type Locator, type Page, test } from '@playwright/test';

const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';
const DRIVER_OVERLAY = '.driver-overlay';
const DRIVER_ACTIVE_ELEMENT = '.driver-active-element';

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** 2 つの矩形が重なっているか (端で接するのみは非重複とみなす)。 */
function overlaps(a: Box, b: Box): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** driver.js の smoothScroll + fade + 再配置が静止する (box が 2 連続不変) まで rAF poll で待つ。 */
async function waitForBubbleStable(page: Page, bubble: Locator): Promise<void> {
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });
	let prev = '';
	let stableCount = 0;
	for (let i = 0; i < 60 && stableCount < 2; i++) {
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);
		const box = await bubble.boundingBox();
		const key = box
			? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`
			: '';
		if (box && key === prev) stableCount++;
		else stableCount = 0;
		prev = key;
	}
}

/** (c) spotlight (driver.js backdrop overlay) が表示中であることを検証する。 */
async function assertSpotlightVisible(page: Page, ctx: string): Promise<void> {
	await expect(
		page.locator(DRIVER_OVERLAY),
		`${ctx}: (c) spotlight overlay が表示される`,
	).toBeVisible({ timeout: 5_000 });
}

/** (b) バブルが viewport 内に完全収容される (見切れない) ことを検証する。 */
async function assertBubbleWithinViewport(page: Page, bubble: Locator, ctx: string): Promise<void> {
	const box = await bubble.boundingBox();
	expect(box, `${ctx}: バブル boundingBox`).not.toBeNull();
	const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
	if (!box || !vp) return;
	const tol = 1;
	expect(box.x, `${ctx}: (b) 左端が viewport 内`).toBeGreaterThanOrEqual(-tol);
	expect(box.y, `${ctx}: (b) 上端が viewport 内`).toBeGreaterThanOrEqual(-tol);
	expect(box.x + box.width, `${ctx}: (b) 右端が viewport 内`).toBeLessThanOrEqual(vp.width + tol);
	expect(box.y + box.height, `${ctx}: (b) 下端が viewport 内 (見切れない)`).toBeLessThanOrEqual(
		vp.height + tol,
	);
}

/**
 * (a) バブルが現在 highlight 中の対象要素を覆い隠さないことを検証する。
 * layout-invariant spec (#2926) と同一ロジック:
 * - element 省略 step (①概要 = 中央 modal) は active-element が無い / #driver-dummy-element (0×0) →
 *   overlap 検証対象外。
 * - 幾何学的に回避不能 (target 高/幅 + バブル + gap が viewport に収まらない) なら driver.js でも
 *   解けない正当な制約のため skip。回避可能な余地があるときのみ厳密非重複を要求する。
 */
async function assertBubbleNotOverlapTarget(
	page: Page,
	bubble: Locator,
	ctx: string,
): Promise<void> {
	const target = page.locator(DRIVER_ACTIVE_ELEMENT).first();
	if ((await target.count()) === 0) return;
	if (!(await target.isVisible().catch(() => false))) return;

	const bubbleBox = await bubble.boundingBox();
	const targetBox = await target.boundingBox();
	if (!bubbleBox || !targetBox) return;
	const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
	if (!vp) return;

	// driver.js が element 省略 step で挿入する 0×0 placeholder は実 target ではない。
	if (targetBox.width === 0 && targetBox.height === 0) return;

	const minGap = 18; // driver.js popoverOffset(10) + stagePadding(8) 相当
	const fitsVertically =
		targetBox.y - minGap >= bubbleBox.height ||
		vp.height - (targetBox.y + targetBox.height) - minGap >= bubbleBox.height;
	const fitsHorizontally =
		targetBox.x - minGap >= bubbleBox.width ||
		vp.width - (targetBox.x + targetBox.width) - minGap >= bubbleBox.width;
	// 幾何学的に回避不能 (正当な制約) → skip。
	if (!fitsVertically && !fitsHorizontally) return;

	expect(
		overlaps(bubbleBox, targetBox),
		`${ctx}: (a) バブルが対象要素を覆い隠さない (非重複、target=${Math.round(targetBox.width)}x${Math.round(targetBox.height)})`,
	).toBe(false);
}

/**
 * 開いたガイドの全 step をループ検証する (#3269)。
 * 各 step で spotlight 表示 / viewport 収容 / 対象非重複を確認し、「つぎへ」で最終 step まで進める。
 * 総 step 数が expectedTotal と一致し、最終 step の完了ボタンでガイドが閉じる (dead-end でない)。
 */
async function traverseGuide(page: Page, bubble: Locator, expectedTotal: number): Promise<void> {
	await expect(page.locator('.guide-header-progress')).toContainText(`/ ${expectedTotal}`);

	let stepCount = 0;
	const MAX = 8;
	for (let i = 0; i < MAX; i++) {
		stepCount++;
		const ctx = `step#${stepCount}`;
		await waitForBubbleStable(page, bubble);
		await expect(bubble, `${ctx}: バブル表示`).toBeVisible();

		await assertSpotlightVisible(page, ctx);
		await assertBubbleWithinViewport(page, bubble, ctx);
		await assertBubbleNotOverlapTarget(page, bubble, ctx);

		const nextBtn = bubble.locator(GUIDE_NEXT);
		const nextText = (await nextBtn.textContent().catch(() => '')) ?? '';
		const isLast = nextText.includes('かんりょう');
		if (isLast) break;
		const prevStepId = await bubble.getAttribute('data-step-id').catch(() => null);
		await nextBtn.click();
		await expect(bubble, `${ctx}: step 遷移で data-step-id が更新`).not.toHaveAttribute(
			'data-step-id',
			prevStepId ?? '',
			{ timeout: 5_000 },
		);
	}
	expect(stepCount, `総 step 数が ${expectedTotal} 件`).toBe(expectedTotal);

	// 完了ボタンでガイドが閉じる (dead-end でない)
	await bubble.locator(GUIDE_NEXT).click();
	await expect(page.locator('.guide-overlay')).toHaveCount(0);
}

test.describe('#3263 / #3269 marketplace ページガイド', () => {
	test.setTimeout(90_000);

	test('一覧: ❓ が表示され、開いて閉じられる (機構配線が機能する)', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/marketplace');

		// 1. ❓ ボタンが 1 個表示される。
		// ガイド解決は registry の動的 import 後に hasPageGuide を立てる非同期処理のため、
		// 初回 dev コンパイル分を見込んで余裕のある timeout で待つ (CI preview ではほぼ即時)。
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		await expect(pageGuideBtn).toBeVisible({ timeout: 15_000 });
		await expect(pageGuideBtn).toHaveCount(1);

		// 2. ❓ click で PageGuideOverlay が開く (open → act → outcome)
		await pageGuideBtn.click();
		const guideOverlay = page.locator('.guide-overlay');
		await expect(guideOverlay).toBeVisible({ timeout: 10_000 });
		await expect(guideOverlay).toHaveAttribute('role', 'dialog');
		await expect(guideOverlay).toHaveAttribute('aria-modal', 'true');
		await expect(guideOverlay).toHaveAttribute('aria-labelledby', 'page-guide-title');

		// 起動した bubble は 1 個のみ (= marketplace ガイドが解決されている)
		await expect(page.locator(GUIDE_BUBBLE)).toHaveCount(1);

		// 3. 「とじる」で閉じられる (dead-end でないことを検証)
		await page.locator('.guide-nav-end').click();
		await expect(guideOverlay).toHaveCount(0);
	});

	test('一覧: 取込 CUJ ガイドを全 3 step 通過でき、各 step で非重複 (#3269)', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/marketplace');

		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		await expect(pageGuideBtn).toBeVisible({ timeout: 15_000 });
		await pageGuideBtn.click();

		const bubble = page.locator(GUIDE_BUBBLE);
		await expect(bubble).toBeVisible({ timeout: 10_000 });
		await traverseGuide(page, bubble, 3);
	});

	test('詳細: dedicated 詳細ガイドが開き、全 3 step 通過 + 非重複 (親へ degrade しない、#3269)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		// 一覧から最初のテンプレート詳細へ遷移 (固定 itemId に依存しない)
		await page.goto('/marketplace');
		const firstItem = page.locator('a[href^="/marketplace/"]').first();
		await expect(firstItem).toBeVisible({ timeout: 10_000 });
		await firstItem.click();
		await page.waitForURL(/\/marketplace\/[^/]+\/[^/]+/);

		// 詳細ルートでも ❓ が出る
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		await expect(pageGuideBtn).toBeVisible({ timeout: 15_000 });
		await expect(pageGuideBtn).toHaveCount(1);
		await pageGuideBtn.click();

		const guideOverlay = page.locator('.guide-overlay');
		await expect(guideOverlay).toBeVisible({ timeout: 10_000 });

		// dedicated 詳細ガイドが解決されている (= 親 /marketplace ガイドへ degrade していない)。
		// ① 概要 step の data-step-id が詳細ガイド固有 id であることで判定する。
		const bubble = page.locator(GUIDE_BUBBLE);
		await expect(bubble).toBeVisible({ timeout: 10_000 });
		await expect(bubble).toHaveAttribute('data-step-id', 'marketplace-detail-intro');

		// 全 3 step 通過 + 非重複 + 完了で閉じる
		await traverseGuide(page, bubble, 3);
	});
});
