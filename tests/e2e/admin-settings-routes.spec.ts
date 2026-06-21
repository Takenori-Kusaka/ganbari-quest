// tests/e2e/admin-settings-routes.spec.ts
// #2319 (EPIC) / #2320 (子#1): /admin/settings 6 グループ child routes 構造の E2E 検証
//
// 検証内容:
// - hub page (`/admin/settings`) が 6 グループへのカード型ナビを表示
// - 各 child route (account/activities/notifications/data/support) が 200 OK で表示
// - +layout.svelte サブナビが全 7 リンクを表示 (hub + 5 + plan deep link)
//
// 認証は AUTH_MODE=local 想定 (常に family プラン相当、所有者扱い)

import { expect, test } from '@playwright/test';

test.describe('#2320 /admin/settings 6 グループ child routes', () => {
	test('hub page で 6 グループへのカード型ナビが表示される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });

		// 6 カードすべて表示
		await expect(page.getByTestId('settings-hub-grid')).toBeVisible();
		await expect(page.getByTestId('settings-hub-card-account')).toBeVisible();
		await expect(page.getByTestId('settings-hub-card-activities')).toBeVisible();
		await expect(page.getByTestId('settings-hub-card-notifications')).toBeVisible();
		await expect(page.getByTestId('settings-hub-card-data')).toBeVisible();
		await expect(page.getByTestId('settings-hub-card-support')).toBeVisible();
		await expect(page.getByTestId('settings-hub-card-plan')).toBeVisible();

		// account カード href = /admin/settings/account
		await expect(page.getByTestId('settings-hub-card-account')).toHaveAttribute(
			'href',
			'/admin/settings/account',
		);
		// plan カードは /admin/subscription への deep link
		await expect(page.getByTestId('settings-hub-card-plan')).toHaveAttribute(
			'href',
			'/admin/subscription',
		);
	});

	test('settings サブナビ (+layout.svelte) が全ルートで表示される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/account', { waitUntil: 'domcontentloaded' });

		const subnav = page.getByTestId('settings-subnav');
		await expect(subnav).toBeVisible();

		// アクティブ判定: account にいるとき account リンクが aria-current="page"
		const accountLink = page.locator('[data-testid="settings-subnav-アカウント"]');
		await expect(accountLink).toHaveAttribute('aria-current', 'page');
	});

	test('account route が表示される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/account', { waitUntil: 'domcontentloaded' });
		// OYAKAGI セクション (sectionTitle ラベル)
		await expect(page.locator('[data-tutorial="pin-settings"]')).toBeVisible();
	});

	test('activities route が表示される (decay section が存在)', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/activities', { waitUntil: 'domcontentloaded' });
		// LP scrollTarget で使用される data-testid (ADR-0013 LP truth)
		await expect(page.getByTestId('settings-decay-section')).toBeVisible();
	});

	test('notifications route が表示される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/notifications', {
			waitUntil: 'domcontentloaded',
		});
		// notification status 要素 (clientside onMount で更新される)
		await expect(page.locator('#notification-status')).toBeVisible();
	});

	test('data route が表示される (data-export-section が存在)', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/data', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('data-export-section')).toBeVisible();
	});

	test('support route が表示される (統合サポートフォームが存在)', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/support', { waitUntil: 'domcontentloaded' });
		// #support-unify: founder CTA / feedback の 2 セクション分離を解消し単一フォームに統合。
		// ご用件 (intent) ラジオ + 内容 textarea が同一フォーム内に存在する。
		await expect(page.locator('[data-tutorial="feedback-section"]')).toBeVisible();
		await expect(page.getByRole('radio', { name: /感想・要望/ })).toBeVisible();
		await expect(page.getByRole('radio', { name: /相談・困りごと/ })).toBeVisible();
	});
});
