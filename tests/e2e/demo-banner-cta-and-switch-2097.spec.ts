// tests/e2e/demo-banner-cta-and-switch-2097.spec.ts
// #2097 Phase B (PO 報告 2026-05-17): DemoBanner CTA / href 修正 + /switch 子供クリック修正
//
// 検証対象:
//   1) DemoBanner (root layout `src/lib/features/demo/DemoBanner.svelte`) の
//      `ctaStart` / `signupHref` / `exitHref` が PO 仕様に沿っていること
//   2) demo Lambda flow (= `?mode=demo` → cookie `gq_demo=1`) の状態で
//      `/switch` の子供選択 form action が cookie set + redirect で正常動作すること
//
// 実行環境:
//   `playwright.config.ts` (AUTH_MODE=local) 既定。`?mode=demo` を最初に踏むと
//   hooks.server.ts が gq_demo cookie を発行し、以降 isDemo=true で本番ルートが
//   駆動される (ADR-0039 設計)。本番 cognito 環境 (demo Lambda) でも同じ flow。

import { expect, test } from '@playwright/test';

test.describe('#2097 Phase B: DemoBanner CTA / href (root layout DemoBanner)', () => {
	test('Bug 1: ctaStart は漢字「本当に始める」(hiragana NG)', async ({ page }) => {
		// `?mode=demo` で root layout の DemoBanner を発火させる
		await page.goto('/?mode=demo', { waitUntil: 'domcontentloaded' });
		const cta = page.getByTestId('demo-banner-signup');
		await expect(cta).toBeVisible();
		await expect(cta).toContainText('本当に始める');
		// hiragana regression を構造的に検出
		await expect(cta).not.toContainText('ほんとうに');
	});

	test('Bug 2: signupHref は本番 absolute URL (https://ganbari-quest.com/auth/signup)', async ({
		page,
	}) => {
		await page.goto('/?mode=demo', { waitUntil: 'domcontentloaded' });
		const cta = page.getByTestId('demo-banner-signup');
		await expect(cta).toHaveAttribute('href', 'https://ganbari-quest.com/auth/signup');
	});

	test('Bug 3: exitHref は本番 LP absolute URL (https://ganbari-quest.com/)', async ({ page }) => {
		await page.goto('/?mode=demo', { waitUntil: 'domcontentloaded' });
		const exitLink = page.getByTestId('demo-banner-exit');
		await expect(exitLink).toBeVisible();
		await expect(exitLink).toHaveAttribute('href', 'https://ganbari-quest.com/');
		// /demo/exit (relative) regression を検出
		const href = await exitLink.getAttribute('href');
		expect(href).not.toContain('/demo/exit');
	});
});

test.describe('#2097 Phase B Bug 4: /switch 子供クリックが demo flow で動く', () => {
	test('demo flow (?mode=demo cookie) で /switch の子供選択 form action が redirect する', async ({
		page,
	}) => {
		// 1) demo モード起動 (cookie 発行)
		await page.goto('/?mode=demo', { waitUntil: 'domcontentloaded' });
		// hooks.server.ts が gq_demo cookie を発行している
		const cookies = await page.context().cookies();
		expect(cookies.find((c) => c.name === 'gq_demo')?.value).toBe('1');

		// 2) /switch にアクセス。demo context で tenantId='demo' が注入され
		//    getAllChildren('demo') が demo 用 children を返す
		await page.goto('/switch', { waitUntil: 'domcontentloaded' });

		// /switch ページ自体が render されている (Bug 4 仮説 b: redirect loop 404 ではない)
		const childButtons = page.locator('[data-testid^="child-select-"]');
		await expect(childButtons.first()).toBeVisible({ timeout: 10000 });

		// 3) 子供 click → form action `?/select` POST
		const first = childButtons.first();
		const childTestId = await first.getAttribute('data-testid');
		await first.click();

		// 4) Bug 4 核心: demo Lambda で POST /switch?/select が no-op JSON で返ると
		//    redirect 303 が発火せず /switch に留まる。修正後は
		//    /switch → /(child)/[uiMode]/home へ遷移する。
		await page.waitForURL(
			(url) => /\/(preschool|elementary|junior|senior|baby)\/home/.test(url.pathname),
			{
				timeout: 10000,
			},
		);

		// 5) selectedChildId cookie がセットされている (demo 安全な副作用)
		const afterCookies = await page.context().cookies();
		const selectedChild = afterCookies.find((c) => c.name === 'selectedChildId');
		expect(selectedChild?.value).toBeTruthy();
		// child-select-{id} の id と一致
		const expectedId = childTestId?.replace('child-select-', '');
		expect(selectedChild?.value).toBe(expectedId);
	});
});
