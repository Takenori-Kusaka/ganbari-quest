// tests/e2e/marketplace-back-nav.spec.ts
// #2900 (EPIC #2897): marketplace → 親管理画面 (見守り画面) への戻り導線
//
// 設計背景 (tmp/marketplace-bugs-analysis-2026-06-04.md §3 / 見逃し M4):
//   認証済みの親が marketplace を素で開く (browse-first journey) と、管理画面へ戻る
//   UI が無く browser back に頼るしかなかった (dead-end)。取込 CUJ は `?import=` 起点で
//   admin に戻るため復路問題が露出せず、E2E が browse-first journey を一度も通して
//   いなかった (M4: Journey カバレッジの偏り)。
//
// 本 spec は M4 対策として「marketplace 直開き → 戻り導線 click → /admin 到達」の
// browse-first journey を一覧 / type 絞込 / 詳細の全 marketplace 画面で貫通検証する。
// (render-only 禁止 / tests/CLAUDE.md §「act → outcome assert」: click → URL 遷移 assert)
//
// 認証状態について:
//   AUTH_MODE=local の E2E では `locals.context` が常に設定されるため、本 spec の全 case は
//   「認証済み」= 戻り導線 visible のパスを検証する。未認証 (公開閲覧) で導線が非表示になる
//   ことは demo Lambda (AUTH_MODE=anonymous) E2E
//   `tests/e2e/demo-lambda/marketplace-back-nav-anonymous.spec.ts` + unit
//   `tests/unit/routes/marketplace-auth-redirect.test.ts` で担保する。

import { expect, test } from '@playwright/test';

const BACK_LINK = '[data-testid="marketplace-back-to-admin"]';

test.describe('#2900 marketplace → 見守り画面 戻り導線 (browse-first journey)', () => {
	test('AC1/AC3: 一覧画面 直開き → 戻り導線 click → /admin 到達', async ({ page }) => {
		await page.goto('/marketplace');
		await page.waitForLoadState('domcontentloaded');

		const backLink = page.locator(BACK_LINK);
		await expect(backLink).toBeVisible();

		// act → outcome: click で実際に /admin へ遷移する (dead-end でない)。
		// /admin は client-side navigation 後に server load + 認可解決を経るため
		// toHaveURL の既定 5s では稀に間に合わない。waitForURL で明示 timeout を確保する。
		await backLink.click();
		await page.waitForURL(/\/admin(\/|$|\?)/, { timeout: 15_000 });
	});

	test('AC2: type 絞込画面 (?type=reward-set) でも戻り導線から /admin 到達', async ({ page }) => {
		await page.goto('/marketplace?type=reward-set');
		await page.waitForLoadState('domcontentloaded');

		const backLink = page.locator(BACK_LINK);
		await expect(backLink).toBeVisible();

		await backLink.click();
		await page.waitForURL(/\/admin(\/|$|\?)/, { timeout: 15_000 });
	});

	test('AC2: 詳細画面でも戻り導線から /admin 到達', async ({ page }) => {
		// 一覧から最初の item 詳細へ遷移し、詳細画面の戻り導線を検証する。
		await page.goto('/marketplace?type=reward-set');
		await page.waitForLoadState('domcontentloaded');

		const firstCard = page.locator('a[href^="/marketplace/reward-set/"]').first();
		await firstCard.click();
		await page.waitForURL(/\/marketplace\/reward-set\//);

		const backLink = page.locator(BACK_LINK);
		await expect(backLink).toBeVisible();

		await backLink.click();
		await page.waitForURL(/\/admin(\/|$|\?)/, { timeout: 15_000 });
	});
});
