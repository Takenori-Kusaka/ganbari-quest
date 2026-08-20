// tests/e2e/marketplace-page-guide.spec.ts
// #3263 (EPIC #3260 F2) / #3269 (C5) / #4677 (EPIC #4650): marketplace ページガイド機構 + 取込 CUJ コンテンツ。
//
// marketplace は AdminLayout 非使用のため独自配線 (marketplace/+layout.svelte)。
// 検証する機構 (admin-page-guide.spec.ts と同型、open → act → outcome):
// 1. /marketplace 一覧で ❓ ボタン (`[data-tutorial="page-guide-btn"]`) が 1 個表示される
// 2. ❓ click で PageGuideOverlay (.guide-overlay) が開く (role/aria 属性正しい)
// 3. 「とじる」(.guide-nav-end) で PageGuideOverlay が閉じる (dead-end でない)
// 4. 一覧ガイドを全 step 通せる + 各 step でバブル非重複 / viewport 収容 / spotlight (取込 CUJ 案内、#3269)
//    #4677: step 構成は「上から下」(概要 → 種類 → 年齢自動フィルタ → しぼりこむ → ならべかえ → カード / 0 件)
//    で、対象が画面に無い step (年齢自動フィルタ hint / カード / 0 件 empty state) は `optional` で省かれ、
//    **selector を持つ step は必ず実要素に spotlight する** (0×0 / 中央 fallback を許容しない。EPIC 判断 4)。
//    desktop / mobile 両 viewport で検証する (mobile は ⚙️ フィルタ ボタン、desktop は「しぼりこむ」パネルが光る)。
// 5. 詳細ルート /marketplace/<type>/<itemId> では dedicated 詳細ガイドが開く (親へ degrade しない、#3269)
//    + 全 3 step 通過 + 各 step で非重複 / viewport 収容 / spotlight
//
// 非重複 / viewport 収容 / spotlight の幾何検証は page-guide-layout-invariant.spec.ts (#2926) の
// 確立ロジック (driver.js の #driver-dummy-element 0×0 skip + 幾何回避不能 exempt + bubble-stable 待ち)
// をそのまま用いる。layout invariant suite は静的パスのため、動的 itemId を要する
// marketplace 詳細・条件付き step を持つ一覧は本 spec で同等検証する (#3269 / #4677)。
//
// 実行: npx playwright test tests/e2e/marketplace-page-guide.spec.ts

import { expect, type Locator, type Page, test } from '@playwright/test';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';
const DRIVER_OVERLAY = '.driver-overlay';
const DRIVER_ACTIVE_ELEMENT = '.driver-active-element';

const VIEWPORTS = [
	{ label: 'desktop', width: 1280, height: 800 },
	{ label: 'mobile', width: 390, height: 844 },
] as const;

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
 * #4677 (EPIC #4650 判断 4): selector を持つ step は**必ず実要素に spotlight する**。
 * driver.js の active element が存在し、可視で、bounding box が 0×0 でなく viewport 内にあること。
 * 「押す」と書いた step が中央 fallback / 0×0 spotlight で成立することを許容しない。
 */
async function assertTargetLit(page: Page, ctx: string): Promise<void> {
	const target = page.locator(DRIVER_ACTIVE_ELEMENT).first();
	await expect(target, `${ctx}: 対象要素に driver active class が付く`).toHaveCount(1);
	await expect(target, `${ctx}: 対象要素が可視`).toBeVisible();
	const box = await target.boundingBox();
	expect(box, `${ctx}: 対象要素の boundingBox`).not.toBeNull();
	if (!box) return;
	expect(box.width, `${ctx}: spotlight 幅 > 0`).toBeGreaterThan(0);
	expect(box.height, `${ctx}: spotlight 高 > 0`).toBeGreaterThan(0);
	const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
	expect(box.x + box.width, `${ctx}: spotlight 右端が viewport 内`).toBeGreaterThan(0);
	expect(box.x, `${ctx}: spotlight 左端が viewport 内`).toBeLessThan(vp.width);
	expect(box.y + box.height, `${ctx}: spotlight 下端が viewport 内`).toBeGreaterThan(0);
	expect(box.y, `${ctx}: spotlight 上端が viewport 内`).toBeLessThan(vp.height);
}

/**
 * 開いたガイドの全 step をループ検証する (#3269 / #4677)。
 * 各 step で spotlight 表示 / viewport 収容 / 対象非重複を確認し、「つぎへ」で最終 step まで進める。
 * 訪れた step id の列が expectedIds と**完全一致**し、selector を持つ step (data-has-target="true")
 * は必ず実要素に spotlight する。最終 step の完了ボタンでガイドが閉じる (dead-end でない)。
 */
async function traverseGuide(page: Page, bubble: Locator, expectedIds: readonly string[]) {
	await expect(page.locator('.guide-header-progress')).toContainText(`/ ${expectedIds.length}`);

	const visited: string[] = [];
	const MAX = 12;
	for (let i = 0; i < MAX; i++) {
		await waitForBubbleStable(page, bubble);
		const stepId = (await bubble.getAttribute('data-step-id')) ?? '';
		visited.push(stepId);
		const ctx = `step#${visited.length} (${stepId})`;
		await expect(bubble, `${ctx}: バブル表示`).toBeVisible();

		await assertSpotlightVisible(page, ctx);
		await assertBubbleWithinViewport(page, bubble, ctx);
		await assertBubbleNotOverlapTarget(page, bubble, ctx);
		if ((await bubble.getAttribute('data-has-target')) === 'true') {
			await assertTargetLit(page, ctx);
		}

		const nextBtn = bubble.locator(GUIDE_NEXT);
		const nextText = (await nextBtn.textContent().catch(() => '')) ?? '';
		const isLast = nextText.includes('かんりょう');
		if (isLast) break;
		await nextBtn.click();
		await expect(bubble, `${ctx}: step 遷移で data-step-id が更新`).not.toHaveAttribute(
			'data-step-id',
			stepId,
			{ timeout: 5_000 },
		);
	}
	expect(visited, '訪れた step id の列').toEqual([...expectedIds]);

	// 完了ボタンでガイドが閉じる (dead-end でない)
	await bubble.locator(GUIDE_NEXT).click();
	await expect(page.locator('.guide-overlay')).toHaveCount(0);
}

/**
 * #4677: 一覧ガイドの期待 step 列を**画面の実状態**から導出する。
 * 年齢自動フィルタ hint (ログイン + お子さま選択中のみ) とカード (0 件時は empty state) は
 * 画面に有る方だけが step になる。
 */
async function expectedListStepIds(page: Page): Promise<string[]> {
	const hasAgeHint = await page
		.locator('[data-tutorial="marketplace-age-auto-filter"]')
		.isVisible()
		.catch(() => false);
	const hasCard = (await page.locator('[data-tutorial="marketplace-item-card"]').count()) > 0;
	return [
		'marketplace-intro',
		'marketplace-browse',
		...(hasAgeHint ? ['marketplace-age-auto'] : []),
		'marketplace-filter',
		'marketplace-sort',
		hasCard ? 'marketplace-open' : 'marketplace-empty',
	];
}

/**
 * /switch で指定のお子さまを選び selectedChildId cookie を立てる。
 * dev server の cold compile 中は click が失われることがあるため、home 到達まで最大 4 回やり直す
 * (cuj5-checklist-import-child-visible.spec.ts と同じ対処)。
 */
async function selectChildWithRetry(page: Page, name: string): Promise<void> {
	let arrived = false;
	for (let attempt = 0; attempt < 4 && !arrived; attempt++) {
		await page.goto('/switch', { waitUntil: 'domcontentloaded' });
		const childButton = page.locator('[data-testid^="child-select-"]').filter({ hasText: name });
		await expect(childButton).toBeVisible({ timeout: 30_000 });
		await childButton.click();
		arrived = await page
			.waitForURL(/\/(baby|preschool|elementary|junior|senior)\/home/, { timeout: 10_000 })
			.then(() => true)
			.catch(() => false);
	}
	expect(arrived, `${name} 選択後に home へ到達する (selectedChildId cookie が立つ)`).toBe(true);
}

async function openListGuide(page: Page): Promise<Locator> {
	const pageGuideBtn = page.locator(GUIDE_BTN);
	await expect(pageGuideBtn).toBeVisible({ timeout: 15_000 });
	await pageGuideBtn.click({ force: true });
	const bubble = page.locator(GUIDE_BUBBLE);
	await expect(bubble).toBeVisible({ timeout: 10_000 });
	return bubble;
}

test.describe('#3263 / #3269 / #4677 marketplace ページガイド', () => {
	test.setTimeout(120_000);

	test('一覧: ❓ が表示され、開いて閉じられる (機構配線が機能する)', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/marketplace');

		// 1. ❓ ボタンが 1 個表示される。
		// ガイド解決は registry の動的 import 後に hasPageGuide を立てる非同期処理のため、
		// 初回 dev コンパイル分を見込んで余裕のある timeout で待つ (CI preview ではほぼ即時)。
		const pageGuideBtn = page.locator(GUIDE_BTN);
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

	for (const { label, width, height } of VIEWPORTS) {
		test(`一覧 [${label}]: 上から下の全 step を通過し、selector step は全て光る (#4677)`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height });
			await page.goto('/marketplace');
			const expected = await expectedListStepIds(page);
			// 一覧が 0 件でない既定状態ではカード step が出る
			expect(expected).toContain('marketplace-open');
			const bubble = await openListGuide(page);
			await traverseGuide(page, bubble, expected);
		});
	}

	test('一覧: 0 件 (フィルタ不一致) では「カードを開く」でなく empty state の「フィルタをクリア」が光る (#4677 F2)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/marketplace?tag=__no_such_tag__');
		await expect(page.locator('[data-tutorial="marketplace-empty-reset"]')).toBeVisible();
		const expected = await expectedListStepIds(page);
		expect(expected).toContain('marketplace-empty');
		expect(expected).not.toContain('marketplace-open');
		const bubble = await openListGuide(page);
		await traverseGuide(page, bubble, expected);
	});

	test('一覧: お子さま選択中は年齢自動フィルタ hint の step が入り、光る (#4677 F4)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		// selectedChildId cookie を立てる (たろうくん = preschool)
		await selectChildWithRetry(page, 'たろうくん');
		await page.goto('/marketplace');
		await expect(page.locator('[data-tutorial="marketplace-age-auto-filter"]')).toBeVisible();
		const expected = await expectedListStepIds(page);
		expect(expected).toContain('marketplace-age-auto');
		const bubble = await openListGuide(page);
		await traverseGuide(page, bubble, expected);
	});

	test('一覧: 「デモを体験」(LP トップへ redirect される /demo 行き) リンクが無い (#4677 M)', async ({
		page,
	}) => {
		await page.goto('/marketplace');
		await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
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
		const pageGuideBtn = page.locator(GUIDE_BTN);
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
		await traverseGuide(page, bubble, [
			'marketplace-detail-intro',
			'marketplace-detail-preview',
			'marketplace-detail-import',
		]);
	});
});
