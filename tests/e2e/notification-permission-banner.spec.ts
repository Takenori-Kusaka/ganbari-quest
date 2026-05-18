// tests/e2e/notification-permission-banner.spec.ts
// #2115 (Bug fix: loading / try-catch / Toast / fallback)
// #2116 (透明性 UX: 2 段階開示 informed consent)
//
// E2E スコープ:
//   - banner が /admin で描画されることの smoke (PushManager / Notification 未対応環境では skip)
//   - descCompact (頻度 / 内容 / 親端末 / quiet hours) が一目で把握可能なこと
//   - disclosure (<details>) を開くと 3 系統 + 親端末限定 + quiet hours が表示されること
//   - click 後に loading 表示か toast or fallback UI のいずれかが現れること (silent 失敗しない)
//
// 詳細な loading / try-catch / fallback の状態網羅は
//   tests/unit/components/notification-permission-banner.test.ts で担当 (mockable)
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts notification-permission-banner

import { expect, test } from '@playwright/test';

test.describe('#2115 / #2116 NotificationPermissionBanner', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test.beforeEach(async ({ page, context }) => {
		// Chromium 既定の Notification.permission を default に固定 (granted だと banner 非表示)
		await context.clearPermissions();
		// AdminHome 訪問前に PushManager 等が支えるよう noop SW を許可しないが、
		// jsdom と違い Chromium には navigator.serviceWorker / PushManager がある前提。
		await page.goto('/admin');
	});

	test('#2116: banner が描画され、descCompact に 4 要素 (頻度 / 内容 / 親端末 / quiet hours) が含まれる', async ({
		page,
	}) => {
		const banner = page.getByTestId('notification-permission-banner');
		// banner は環境によっては既存 subscription / permission=granted で非表示の可能性あり。
		// 表示されたケースを確認できれば AC 充足とする (no-op 確認)。
		if ((await banner.count()) === 0) {
			test.skip(
				true,
				'banner not visible (permission granted/denied state) — covered by unit test',
			);
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
		if ((await banner.count()) === 0) {
			test.skip(true, 'banner not visible — covered by unit test');
		}
		const disclosure = banner.getByTestId('notification-banner-disclosure');
		await expect(disclosure).toBeVisible();
		// summary クリックで open
		await disclosure.locator('summary').click();
		// 3 系統 + 親端末 + quiet hours の文言
		await expect(disclosure).toContainText('がんばりリマインダー');
		await expect(disclosure).toContainText('連続記録');
		await expect(disclosure).toContainText('達成のお祝い');
		await expect(disclosure).toContainText('親端末');
		await expect(disclosure).toContainText('21:00');
		// 設定画面リンク
		await expect(disclosure.locator('a[href="/admin/settings"]')).toBeVisible();
	});

	test('#2115: CTA click 後 silent には終わらない (loading / toast / error のいずれか発火)', async ({
		page,
	}) => {
		const banner = page.getByTestId('notification-permission-banner');
		if ((await banner.count()) === 0) {
			test.skip(true, 'banner not visible — covered by unit test');
		}
		const cta = banner.getByTestId('notification-banner-cta');
		await expect(cta).toBeVisible();

		// クリック後、以下のいずれかが起きるはず (silent 失敗ではない):
		//   a) loading 表示 (aria-busy="true" / label='設定中…')
		//   b) toast 発火 + banner 消滅 (成功)
		//   c) error fallback UI 表示
		await cta.click();

		// Promise.race 的に 3 条件のいずれかを 5s 以内で検知
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
