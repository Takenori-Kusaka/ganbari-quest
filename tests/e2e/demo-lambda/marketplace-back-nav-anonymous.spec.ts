// tests/e2e/demo-lambda/marketplace-back-nav-anonymous.spec.ts
// #2900 (EPIC #2897): demo Lambda (synthetic auth) の marketplace 戻り導線挙動
//
// 設計背景:
//   #2900 で marketplace header に「← 見守り画面へ」戻り導線を追加した。表示条件は
//   `locals.context` の有無 (= isAuthenticated) で、production cognito 未認証 (context null)
//   のみ非表示にする。
//
//   demo Lambda (AUTH_MODE=anonymous + DATA_SOURCE=demo、ADR-0048) の AnonymousAuthProvider は
//   `resolveContext` で常に synthetic context (tenantId='demo' / role='owner' / licenseStatus=ACTIVE)
//   を返す (src/lib/server/auth/providers/anonymous.ts §42-50)。これにより demo Lambda では
//   `locals.context` が常に truthy = isAuthenticated=true となり、戻り導線は **表示される**。
//
//   これは「demo Lambda は本番ルートを demo data で host する認証済み相当の体験であり、
//   /admin も全 path 到達可能」というデモ = 本番同一体験原則 (ADR-0048) に整合する。
//   隠すべきは production cognito 未認証 (context null) のみで、その非表示検証は
//   unit `tests/unit/routes/marketplace-auth-redirect.test.ts` (isAuthenticated=`!!locals.context`
//   + svelte 側 `{#if data.isAuthenticated}` 条件描画の static source 検証) が担保する。
//
//   本 spec は demo Lambda 実環境で「synthetic auth → 戻り導線が表示され /admin に到達できる」
//   ことを検証する (render-only 禁止 / tests/CLAUDE.md §「act → outcome assert」)。

import { expect, test } from '@playwright/test';

const BACK_LINK = '[data-testid="marketplace-back-to-admin"]';

test.describe('#2900 demo Lambda (synthetic auth) の marketplace 戻り導線', () => {
	test('匿名アクセスで marketplace 一覧が 200 で開ける (公開ページ性維持)', async ({ page }) => {
		const res = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);
		// 認証 challenge にバウンスしていないこと (公開ルート)
		await expect(page).not.toHaveURL(/\/auth\/login/);
	});

	test('demo synthetic auth では戻り導線が表示され /admin に到達できる (デモ=本番同一体験)', async ({
		page,
	}) => {
		// AnonymousAuthProvider が synthetic context を返すため isAuthenticated=true となり、
		// 戻り導線 `<a data-testid="marketplace-back-to-admin">` が表示される。
		await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		const backLink = page.locator(BACK_LINK);
		await expect(backLink).toBeVisible();

		// act → outcome: click で実際に /admin へ遷移する (dead-end でない)。
		await backLink.click();
		await page.waitForURL(/\/admin(\/|$|\?)/, { timeout: 15_000 });
	});
});
