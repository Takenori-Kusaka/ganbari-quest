/**
 * 汎用ページガイド撮影フロー (scripts/capture.mjs の --actions スクリプト)
 *
 * admin 各ページの ❓ ページガイド (PageGuideOverlay) を起動し、全 step を 1 枚ずつ撮影する。
 * `--url` を変えるだけで全 11 ページ (home / activities / rewards / checklists / challenges /
 * children / settings / status / points / reports / cheer) に再利用できる汎用フロー (#1442 整合)。
 *
 * 使い方:
 *   node scripts/capture.mjs --flow page-guide-activities --url /admin/activities \
 *     --actions scripts/capture-flows/page-guide.mjs --base-url http://localhost:3000 \
 *     --no-start-server --presets desktop --out tmp/screenshots
 *
 * EPIC #2925 Sub-2 (#2927): narrative 3 部構成統一の PO レビュー用 SS 撮影に使用。
 *
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// admin home の初回 PremiumWelcome overlay が ❓ click を遮るため閉じる。
	const welcome = page.locator('.welcome-overlay');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) {
		const cta = welcome.locator('.welcome-cta');
		if (await cta.isVisible().catch(() => false)) {
			await cta.click();
			await welcome.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
		}
	}

	// ❓ ボタンでガイドを起動。
	const guideBtn = page.locator('[data-tutorial="page-guide-btn"]').first();
	await guideBtn.waitFor({ state: 'visible', timeout: 10_000 });
	await guideBtn.click({ force: true });

	const bubble = page.locator('.guide-bubble');
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });

	// driver.js の smoothScroll + fade + 再配置が静止するまで rAF ベースで待つ。
	const stabilize = async () => {
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
	};

	const MAX_STEPS = 8;
	for (let i = 0; i < MAX_STEPS; i++) {
		await stabilize();
		const stepId = (await bubble.getAttribute('data-step-id').catch(() => null)) ?? `step-${i + 1}`;
		await capture(`step${i + 1}-${stepId}`);

		const next = bubble.locator('.guide-nav-next');
		const txt = (await next.textContent().catch(() => '')) ?? '';
		if (txt.includes('かんりょう')) break;

		const prevId = await bubble.getAttribute('data-step-id').catch(() => null);
		await next.click();
		await page
			.waitForFunction(
				(pid) => {
					const el = document.querySelector('.guide-bubble');
					return el && el.getAttribute('data-step-id') !== pid;
				},
				prevId,
				{ timeout: 5_000 },
			)
			.catch(() => {});
	}
};
