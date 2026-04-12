// tests/e2e/trial-expiration-dialog.spec.ts
// #770: トライアル終了検知ダイアログ E2E
//
// cookie `trial_was_active=1` を事前に設定し /admin にアクセスすると、
// サーバーが「トライアルが active → inactive に遷移した」と判定して
// TrialEndedDialog を表示する仕組みのテスト。
//
// ローカル auth モード（AUTH_MODE=local）では trial_history テーブルに
// レコードがないため isTrialActive=false。cookie が存在すれば
// trialJustExpired=true となりダイアログが出る。

import { expect, test } from '@playwright/test';

test.describe('#770 トライアル終了検知ダイアログ', () => {
	test('trial_was_active cookie がある状態で /admin を開くとダイアログが表示される', async ({
		page,
		context,
	}) => {
		// cookie を設定して「前回はトライアルが有効だった」状態を模擬
		await context.addCookies([
			{
				name: 'trial_was_active',
				value: '1',
				domain: 'localhost',
				path: '/',
				httpOnly: true,
			},
		]);

		await page.goto('/admin', { waitUntil: 'networkidle' });

		const dialog = page.getByTestId('trial-ended-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		// ダイアログのタイトルテキストを確認
		await expect(dialog.getByText('無料体験が終了しました')).toBeVisible();
		// アップグレード CTA リンクが存在する
		await expect(page.getByTestId('trial-ended-upgrade-cta')).toBeVisible();
	});

	test('「あとで」ボタンでダイアログを閉じられる', async ({ page, context }) => {
		await context.addCookies([
			{
				name: 'trial_was_active',
				value: '1',
				domain: 'localhost',
				path: '/',
				httpOnly: true,
			},
		]);

		await page.goto('/admin', { waitUntil: 'networkidle' });

		const dialog = page.getByTestId('trial-ended-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });

		await page.getByTestId('trial-ended-dismiss').click();
		await expect(dialog).not.toBeVisible();
	});

	test('ダイアログ表示後にリロードすると二度目は表示されない（cookie 消去済み）', async ({
		page,
		context,
	}) => {
		await context.addCookies([
			{
				name: 'trial_was_active',
				value: '1',
				domain: 'localhost',
				path: '/',
				httpOnly: true,
			},
		]);

		await page.goto('/admin', { waitUntil: 'networkidle' });

		const dialog = page.getByTestId('trial-ended-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });

		// サーバーが cookie を削除しているため、リロードすると表示されない
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.getByTestId('trial-ended-dialog')).not.toBeVisible();
	});

	test('cookie がない場合はダイアログが表示されない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'networkidle' });
		await expect(page.getByTestId('trial-ended-dialog')).not.toBeVisible();
	});
});
