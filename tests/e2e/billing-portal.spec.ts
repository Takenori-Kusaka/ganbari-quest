// tests/e2e/billing-portal.spec.ts
// #768 → #4139: 請求 (Stripe Customer Portal) 導線の E2E テスト
//
// #4139: 旧 `/admin/billing` (請求書・支払い管理) は `/admin/subscription` に統合された。
// プランと課金が 2 ページに分かれていたため、契約ステータスが 2 重表示され、
// Stripe 請求管理ページを開くボタンが 3 箇所に散り、2 ページが相互リンクしていた。
// 本 spec は統合後の「1 ページ・1 出口」を固定する:
//   - 旧 URL は 308 で統合先に飛ぶ (ブックマーク救済)
//   - 請求管理ページを開くボタンは 1 個だけ
//   - 契約ステータスの表示は 1 箇所だけ
//   - 解約導線は統合先から到達できる
//
// 実際の Stripe Portal セッション作成はテスト環境では動作しないため、
// UI 要素の表示・導線のみをテストする。

import { expect, test } from '@playwright/test';

test.describe('#4139 プラン・課金統合ページ', () => {
	test('旧 /admin/billing は /admin/subscription に 308 redirect する', async ({ request }) => {
		const response = await request.get('/admin/billing', { maxRedirects: 0 });
		expect(response.status()).toBe(308);
		expect(response.headers().location).toBe('/admin/subscription');
	});

	test('統合先ページが 500 にならず表示される', async ({ page }) => {
		const response = await page.goto('/admin/subscription');
		expect(response?.status()).not.toBe(500);
	});

	test('契約ステータスの表示が 1 箇所に集約されている', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });
		// 統合先の「現在のプラン」カードがステータス表示の唯一の SSOT
		await expect(page.getByTestId('saas-current-plan')).toBeVisible();
		// 旧 /admin/billing の「サブスクリプション状況」カードは統合により消滅
		await expect(page.locator('[data-tutorial="billing-overview"]')).toHaveCount(0);
	});

	test('請求管理ページを開くボタンが 2 個以上存在しない', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });
		// 統合先の唯一の Portal ボタン (Stripe 無効環境では 0 個)
		expect(await page.getByTestId('open-portal-button').count()).toBeLessThanOrEqual(1);
		// 旧 /admin/billing の Portal ボタンは統合により消滅
		await expect(page.getByTestId('billing-open-portal')).toHaveCount(0);
		// 旧「支払い履歴」カードから /admin/billing へ渡る二重導線も消滅
		await expect(page.getByTestId('license-to-billing')).toHaveCount(0);
	});

	test('解約導線が統合先から到達できる', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });
		const cancelLink = page.getByTestId('subscription-to-cancel');
		await expect(cancelLink).toBeVisible();
		await expect(cancelLink).toHaveAttribute('href', '/admin/subscription/cancel');

		await cancelLink.click();
		await page.waitForURL('**/admin/subscription/cancel');
		// 遷移先が解約理由ヒアリングフォームであること (リンク先が生きていることの確認)
		await expect(page.getByTestId('cancellation-form')).toBeVisible();
	});

	test('ナビゲーションのプラン・課金導線が 1 本に集約されている', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });

		// desktop nav の item anchor は `{#if desktopExpandedCategory === category.id}` の
		// dropdown 内にのみ描画される (AdminLayout.svelte:346-360)。カテゴリを開かずに
		// `nav a[href=...]` を数えると **撤去前でも 0 件**で、旧 assertion は vacuous だった
		// (`toHaveCount(0)` は常に成立し、`.first()).toHaveCount(1)` は locator を 1 件に
		// 絞ってから数えるため「1 本であること」を表明できていない)。
		// 「プラン」「請求管理」はいずれも 設定 カテゴリ配下のため、設定を開いてから数える。
		const nav = page.locator('nav[data-tutorial="nav-desktop"]');
		await nav.getByRole('button', { name: '設定' }).click();
		await expect(nav.locator('a[href="/admin/subscription"]')).toBeVisible();

		// 旧「請求管理」ナビは撤去済み (統合前は 設定 配下に 2 本あった)
		await expect(nav.locator('a[href="/admin/billing"]')).toHaveCount(0);
		// 「プラン」ナビは 1 本だけ (2 本に戻ったら fail する = 非 vacuous)
		await expect(nav.locator('a[href="/admin/subscription"]')).toHaveCount(1);
	});
});
