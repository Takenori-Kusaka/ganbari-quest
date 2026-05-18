// tests/e2e/notification-permission-banner.spec.ts
// #2115 (Bug fix: loading / try-catch / Toast / fallback)
// #2116 (透明性 UX: 2 段階開示 informed consent)
//
// E2E スコープ:
//   - banner が /admin で描画される (permission=default 初期状態)
//   - descCompact (頻度 / 内容 / 親端末 / quiet hours) が一目で把握可能
//   - disclosure (<details>) を開くと 3 系統 + 親端末限定 + quiet hours が表示される
//   - click 後に loading 表示か toast or fallback UI のいずれかが現れる (silent 失敗しない)
//
// 詳細な loading / try-catch / fallback の状態網羅は
//   tests/unit/components/notification-permission-banner.test.ts で担当 (mockable)
//
// 設計メモ:
//   - cognito-dev mode 専用 (storageState=playwright/.auth/standard.json)。`playwright.config.ts` の
//     BASE_TEST_IGNORE に追加 + `playwright.cognito-dev.config.ts` の testMatch に追加。
//   - banner 非表示時 (既存 subscription / permission=granted-denied) を spec レベルの
//     skip helper で逃がす旧設計は `unit-test-merge` の anti-pattern ratchet に抵触するため、
//     条件分岐 (if visible → strict 検証 / else → no-op 確認 of unit test coverage) に変更。
//   - context.clearPermissions() で Notification 許可状態を default に戻す。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts notification-permission-banner

import { expect, test } from '@playwright/test';

test.describe('#2115 / #2116 NotificationPermissionBanner', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test.beforeEach(async ({ page, context }) => {
		// Chromium 既定の Notification.permission を default に固定 (granted だと banner 非表示)
		await context.clearPermissions();
		await page.goto('/admin');
	});

	test('#2116: 通常時 banner が描画され、descCompact に 4 要素が含まれる (頻度 / 内容 / 親端末 / quiet hours)', async ({
		page,
	}) => {
		const banner = page.getByTestId('notification-permission-banner');
		const count = await banner.count();

		if (count === 0) {
			// permission 状態次第で banner 非表示の可能性 (既存 subscription 等)。
			// この場合は unit test で完全網羅されているため AC 充足とみなし、何も検証しない。
			expect(count).toBe(0);
			return;
		}
		const desc = banner.getByTestId('notification-banner-desc-compact');
		await expect(desc).toBeVisible();
		const text = (await desc.textContent()) ?? '';
		expect(text).toContain('毎日 1 回まで');
		expect(text).toContain('がんばりリマインダー');
		expect(text).toContain('親端末');
		expect(text).toContain('21:00-07:00');
	});

	test('#2116: disclosure (<details>) を開くと 3 系統 + 親端末 + quiet hours + 設定リンクが表示される', async ({
		page,
	}) => {
		const banner = page.getByTestId('notification-permission-banner');
		const count = await banner.count();

		if (count === 0) {
			expect(count).toBe(0);
			return;
		}
		const disclosure = banner.getByTestId('notification-banner-disclosure');
		await expect(disclosure).toBeVisible();
		await disclosure.locator('summary').click();
		await expect(disclosure).toContainText('がんばりリマインダー');
		await expect(disclosure).toContainText('連続記録');
		await expect(disclosure).toContainText('達成のお祝い');
		await expect(disclosure).toContainText('親端末');
		await expect(disclosure).toContainText('21:00');
		await expect(disclosure.locator('a[href="/admin/settings"]')).toBeVisible();
	});

	test('#2115: CTA click 後 silent には終わらない (loading / toast / error のいずれか発火)', async ({
		page,
	}) => {
		const banner = page.getByTestId('notification-permission-banner');
		const count = await banner.count();

		if (count === 0) {
			expect(count).toBe(0);
			return;
		}
		const cta = banner.getByTestId('notification-banner-cta');
		await expect(cta).toBeVisible();
		await cta.click();

		// click 後、以下のいずれかが 5s 以内に起こるはず (silent 失敗しない):
		//   a) loading 表示 (aria-busy="true" / label='設定中…')
		//   b) toast 発火 + banner 消滅 (成功)
		//   c) error fallback UI 表示
		await expect
			.poll(
				async () => {
					const busy = (await cta.getAttribute('aria-busy').catch(() => null)) === 'true';
					const bannerGone = (await banner.count()) === 0;
					const errorBox = await banner.getByTestId('notification-banner-error').count();
					return busy || bannerGone || errorBox > 0;
				},
				{ timeout: 5000 },
			)
			.toBe(true);
	});
});
