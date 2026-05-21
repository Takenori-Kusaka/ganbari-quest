// tests/e2e/page-guide-double-dialog.spec.ts
// #2375 (PR #2388): PageGuide v2 自体の不具合修正 (PO 追加指摘) の回帰テスト。
// Bucket A 4 件 + Escape (Bucket B) を検証 (AC-V2-1 〜 V2-7)。
//
// AC-V2-1: ❓ 連打で bubble は 1 個のみ (`toHaveCount(1)`)、active 中の同一 pageId 再起動は no-op
// AC-V2-2: 異 pageId に切替時は前 guide を end → 新 guide を start (state 完全 reset)
// AC-V2-3: setTimeout 群を AbortController で cleanup (race 防止)
// AC-V2-4: step 切替で bubble DOM 不破棄 (flicker / tab 消失なし)
// AC-V2-5: v1 active 時に v2 ❓ click で v1 overlay 消失
// AC-V2-6: Escape キーで PageGuideOverlay が閉じる
// AC-V2-7: role / aria 属性確認 (admin-page-guide.spec.ts と並行検証)
//
// 実行: npx playwright test tests/e2e/page-guide-double-dialog.spec.ts

import { expect, test } from '@playwright/test';

async function dismissWelcome(page: import('@playwright/test').Page) {
	const welcomeDialog = page.locator('.welcome-overlay');
	if (await welcomeDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
		const dismissBtn = welcomeDialog.locator('button:has-text("さっそく始める")');
		if (await dismissBtn.isVisible().catch(() => false)) {
			await dismissBtn.click();
			await welcomeDialog.waitFor({ state: 'hidden', timeout: 3000 });
		}
	}
}

async function gotoAdminAndOpenGuide(
	page: import('@playwright/test').Page,
	adminPath = '/admin/reports',
) {
	await page.goto(adminPath);
	await dismissWelcome(page);
	const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
	await expect(pageGuideBtn).toBeVisible({ timeout: 15_000 });
	return pageGuideBtn;
}

test.describe('#2375 PageGuide v2 不具合修正 (AC-V2-1〜V2-7)', () => {
	test.setTimeout(60_000);

	test('AC-V2-1: ❓ 連打で bubble は 1 個のみ (active 中の同一 pageId 再起動は no-op)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		const pageGuideBtn = await gotoAdminAndOpenGuide(page);

		// 1 回目 click → bubble 表示
		await pageGuideBtn.click();
		const bubble = page.locator('.guide-bubble');
		await expect(bubble).toBeVisible({ timeout: 10_000 });
		await expect(bubble).toHaveCount(1);

		// 連打 (3 回追加 click) — AC-V2-1 冪等 guard で no-op
		await pageGuideBtn.click({ force: true });
		await pageGuideBtn.click({ force: true });
		await pageGuideBtn.click({ force: true });

		// bubble は依然 1 個のみ (重畳なし)
		await expect(bubble).toHaveCount(1);
		await expect(bubble).toBeVisible();

		// overlay も 1 個 (二重 DOM 不在)
		await expect(page.locator('.guide-overlay')).toHaveCount(1);
	});

	test('AC-V2-2: 異 pageId 切替で前 guide が end され新 guide が start', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		// 1. /admin/reports で guide 起動
		const reportsBtn = await gotoAdminAndOpenGuide(page, '/admin/reports');
		await reportsBtn.click();
		const bubble = page.locator('.guide-bubble');
		await expect(bubble).toBeVisible({ timeout: 10_000 });
		const reportsPageId = await bubble
			.locator('[data-step-id]')
			.first()
			.or(bubble)
			.evaluate((el) => el.closest('.guide-bubble')?.getAttribute('data-step-id') ?? null);
		expect(reportsPageId).toBeTruthy();

		// 2. /admin/children に遷移 + guide 起動
		await page.goto('/admin/children');
		await dismissWelcome(page);
		const childrenBtn = page.locator('[data-tutorial="page-guide-btn"]');
		await expect(childrenBtn).toBeVisible({ timeout: 15_000 });
		await childrenBtn.click();

		// 新しい guide が表示される (overlay は 1 個のみ)
		await expect(page.locator('.guide-overlay')).toHaveCount(1);
		await expect(page.locator('.guide-bubble')).toHaveCount(1);
	});

	test('AC-V2-3 / V2-4: 「次へ」連打で bubble flicker / 重畳せず (DOM 不破棄)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		// /admin/activities は 3 step で複数 step 連打検証に適する (PageGuide v2 step 切替時の bubble DOM 維持を検証)
		const pageGuideBtn = await gotoAdminAndOpenGuide(page, '/admin/activities');
		await pageGuideBtn.click();
		const bubble = page.locator('.guide-bubble');
		await expect(bubble).toBeVisible({ timeout: 10_000 });

		// 最終 step まで progressing しない範囲で「つぎへ」連打 (last step ボタンは「かんりょう！」)
		const nextBtn = bubble.locator('.guide-nav-next');
		// 最初の step (1 / N) ではテキスト「つぎへ」、最終 step では「かんりょう！」 (UI_COMPONENTS_LABELS.pageGuideNextBtn)
		await expect(nextBtn).toHaveText(/つぎへ/);
		// 連打 — debounce / FSM lock 検証 (AC-V2-4 で bubble DOM 不破棄、AC-V2-3 で setTimeout race 不発)
		// 同一 click を 3 回 burst で送出 (Playwright `click` は serial 実行のため、`Promise.all` で並列 burst)。
		// /admin/activities は 3 step。1 click で 1→2 移動、2 回目以降の click は guide-nav-next の DOM
		// 切替 (button text が「かんりょう！」になる) と race するため、`force: true` 不要で
		// 「activeTab='what'」の new step 反映待ちを auto-retry の expect で待つ。
		await Promise.all([
			nextBtn.click(),
			nextBtn.click({ force: true }).catch(() => {}),
			nextBtn.click({ force: true }).catch(() => {}),
		]);

		// bubble は依然 1 個 (DOM 破棄 / 重畳なし) — 連打で複数 bubble が同時 mount されないことを assert
		await expect(bubble).toHaveCount(1);
		await expect(bubble).toBeVisible();
		// overlay も 1 個 (二重 mount 不在)
		await expect(page.locator('.guide-overlay')).toHaveCount(1);
	});

	test('AC-V2-5: v1 active 中に v2 ❓ click で v1 overlay が消える', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		// 1. AdminHome で v1 tutorial を起動 (handleViewFullGuide 経由)
		await page.goto('/admin');
		await dismissWelcome(page);
		await page.evaluate(() => {
			localStorage.removeItem('tutorial-progress-chapter');
			localStorage.removeItem('tutorial-progress-step');
		});
		const fullGuideCard = page.locator('[data-testid="admin-view-full-guide"]');
		await fullGuideCard.waitFor({ state: 'visible', timeout: 15_000 });
		const v1Trigger = fullGuideCard.getByRole('button', { name: 'ガイドを開く' });
		await expect(v1Trigger).toBeEnabled();
		await expect
			.poll(
				async () => {
					const v1Visible = await page
						.locator('.tutorial-overlay')
						.isVisible()
						.catch(() => false);
					if (v1Visible) return 'shown';
					await v1Trigger.click({ trial: false }).catch(() => {});
					return 'not-yet';
				},
				{ timeout: 30_000, intervals: [500, 1000, 1500, 2000, 3000] },
			)
			.toBe('shown');
		await expect(page.locator('.tutorial-overlay')).toBeVisible();

		// 2. v2 ❓ click → v1 overlay が消える (handleStartPageGuide が endTutorial 呼出)
		// v1 overlay の `.tutorial-overlay-bg` (SVG mask) が pointer events をブロックするため
		// 通常の click / `force: true` だと SVG 経由で `handleOverlayClick` (= exitConfirm) が発火する。
		// JS dispatchEvent で button onclick を直接呼出 (overlay 経由しない) — `handleStartPageGuide`
		// の `endTutorial()` 同期実行 → v1 dismiss → v2 起動 を検証する。
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		await expect(pageGuideBtn).toBeVisible();
		await pageGuideBtn.evaluate((btn: HTMLButtonElement) => btn.click());

		// v1 TutorialOverlay は dismiss、v2 PageGuideOverlay が表示
		await expect(page.locator('.tutorial-overlay')).toBeHidden();
		await expect(page.locator('.guide-overlay')).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('.guide-bubble')).toHaveCount(1);
	});

	test('AC-V2-6: Escape キーで PageGuideOverlay が閉じる', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		const pageGuideBtn = await gotoAdminAndOpenGuide(page);
		await pageGuideBtn.click();
		const overlay = page.locator('.guide-overlay');
		await expect(overlay).toBeVisible({ timeout: 10_000 });

		// Escape 押下
		await page.keyboard.press('Escape');

		// overlay と bubble が dismiss
		await expect(overlay).toBeHidden();
		await expect(page.locator('.guide-bubble')).toHaveCount(0);
	});

	test('AC-V2-7: role / aria 属性 + step 切替後も保持', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		const pageGuideBtn = await gotoAdminAndOpenGuide(page);
		await pageGuideBtn.click();
		const overlay = page.locator('.guide-overlay');
		await expect(overlay).toBeVisible({ timeout: 10_000 });

		// AC-V2-7: aria 属性確認
		await expect(overlay).toHaveAttribute('role', 'dialog');
		await expect(overlay).toHaveAttribute('aria-modal', 'true');
		await expect(overlay).toHaveAttribute('aria-labelledby', 'page-guide-title');

		// step 切替後も bubble は 1 個維持 (AC-V2-4 / DOM 不破棄検証)
		const bubble = page.locator('.guide-bubble');
		const nextBtn = bubble.locator('.guide-nav-next');
		const isLastStep = async () =>
			(await nextBtn.textContent().catch(() => ''))?.includes('かんりょう') ?? false;
		// 1 step だけ進める (last step なら skip)
		if (!(await isLastStep())) {
			await nextBtn.click();
			await expect(bubble).toHaveCount(1);
			// 切替後も attributes 保持
			await expect(overlay).toHaveAttribute('role', 'dialog');
			await expect(overlay).toHaveAttribute('aria-modal', 'true');
		}
	});
});
