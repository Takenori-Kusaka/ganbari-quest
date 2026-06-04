// tests/e2e/demo-lambda/marketplace-back-nav-anonymous.spec.ts
// #2900 (EPIC #2897): marketplace 戻り導線は未認証 (公開閲覧) では非表示
//
// 設計背景:
//   #2900 で認証済みの親に「← 見守り画面へ」戻り導線を追加した。marketplace は
//   未認証でも閲覧可能な公開ルート (no-gos: 公開ページ性を壊さない) のため、
//   未認証ユーザーには戻り導線を出してはならない (admin へ誘導すると認証 challenge に
//   バウンスし公開閲覧体験を壊す)。
//
//   AUTH_MODE=local の通常 E2E では `locals.context` が常に設定されるため未認証パスを
//   再現できない。demo Lambda (AUTH_MODE=anonymous + DATA_SOURCE=demo、ADR-0048) は
//   匿名アクセスのため `locals.context` の有無を実環境で検証できる唯一の E2E 経路。
//
//   ただし demo Lambda の AnonymousAuthProvider が `locals.context` を設定するかは
//   環境仕様に依存するため、本 spec は「戻り導線 click 先が認証 challenge に
//   バウンスしない (= 導線が出ているなら /admin が公開閲覧者にも開ける)」ではなく
//   「導線の有無に関わらず marketplace 公開閲覧が 200 で成立する」ことを軸に検証し、
//   導線が描画されている場合のみ非表示 invariant を assert する。

import { expect, test } from '@playwright/test';

const BACK_LINK = '[data-testid="marketplace-back-to-admin"]';

test.describe('#2900 marketplace 戻り導線は公開閲覧で公開ページ性を壊さない', () => {
	test('匿名アクセスで marketplace 一覧が 200 で開ける (公開ページ性維持)', async ({ page }) => {
		const res = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);
		// 認証 challenge にバウンスしていないこと (公開ルート)
		await expect(page).not.toHaveURL(/\/auth\/login/);
	});

	test('匿名アクセスでは戻り導線 (見守り画面へ) が描画されない', async ({ page }) => {
		// demo Lambda の匿名 context では isAuthenticated=false となり、
		// 戻り導線 `<a data-testid="marketplace-back-to-admin">` は 0 件であるべき。
		await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		await expect(page.locator(BACK_LINK)).toHaveCount(0);
	});
});
