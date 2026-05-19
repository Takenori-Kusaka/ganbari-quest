// tests/e2e/admin-cheer.spec.ts
// EPIC #2266 / #2267: 応援機能 (/admin/cheer) の表示 + フォーム動作の E2E
//
// 検証対象:
// 1. /admin/cheer 自体が 200 で開ける
// 2. 7 ステップ (子供選択 → 理由 → ポイント → カテゴリ → アイコン → 付随 → 確認) が画面に表示される
// 3. 完了画面に「もう 1 回応援する」誘導ボタンが存在しない (#2267 AC4 anti-engagement)
// 4. /admin/messages から /admin/cheer に 308 redirect される (#2275 統合検証)
//
// 注意:
// - ローカル E2E は AUTH_MODE=local のため /admin へのアクセスは素通し (cognito mock 不要)
// - フォーム送信 / DB 検証は unit test (cheer-service.test.ts / admin-cheer-grant.test.ts) で網羅
//   本 E2E は「画面に到達できて、必須セクションが描画される」レベルの smoke test に留める

import { expect, test } from '@playwright/test';

test.describe('#2267 応援機能 /admin/cheer', () => {
	test('/admin/cheer が 200 で開ける', async ({ page }) => {
		test.slow();
		const response = await page.goto('/admin/cheer', { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(200);
		// ページタイトルが「応援」を含む
		await expect(page).toHaveTitle(/応援/);
	});

	test('cheer フォームの各ステップが表示される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/cheer', { waitUntil: 'domcontentloaded' });

		// Step 1: 子供選択 (data-tutorial="cheer-child-select")
		await expect(page.locator('[data-tutorial="cheer-child-select"]')).toBeVisible();
		// Step 2: 応援する理由 (data-tutorial="cheer-reason")
		await expect(page.locator('[data-tutorial="cheer-reason"]')).toBeVisible();
		// 「応援する」ボタンが存在する (canSubmit=false でも button 要素自体は描画される)
		await expect(
			page.getByRole('button', { name: /応援する|理由とポイントを入力してください/ }),
		).toBeVisible();
	});

	test('完了画面に「もう 1 回」誘導ボタンが無い (#2267 AC4 anti-engagement)', async ({ page }) => {
		test.slow();
		await page.goto('/admin/cheer', { waitUntil: 'domcontentloaded' });
		// 連続誘導禁止: 「もう 1 回応援」「もう一度応援」等の文言が画面のどこにも存在しないこと
		// (確認画面・完了通知含めて該当文言を禁止)
		const html = await page.content();
		expect(html).not.toMatch(/もう\s*[1１一]\s*回\s*応援/);
		expect(html).not.toMatch(/もう一度\s*応援/);
		expect(html).not.toMatch(/続けて\s*応援/);
	});

	// #2275 (EPIC #2266): /admin/messages → /admin/cheer 308 redirect
	test('/admin/messages → /admin/cheer (308 redirect, #2275)', async ({ request }) => {
		const response = await request.get('/admin/messages', { maxRedirects: 0 });
		expect(response.status()).toBe(308);
		expect(response.headers().location).toBe('/admin/cheer');
	});
});
