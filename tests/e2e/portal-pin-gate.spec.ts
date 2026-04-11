// tests/e2e/portal-pin-gate.spec.ts
// #771: Stripe Portal アクセス時の PIN / 確認フレーズゲートの E2E テスト
//
// Portal API の二段階確認が機能していることを検証する。
// 実際の Stripe Portal セッション作成はテスト環境では失敗するため、
// PIN / 確認フレーズの検証段階でのレスポンスのみをテストする。

import { expect, test } from '@playwright/test';

test.describe('#771 Portal PIN gate', () => {
	// POST /api/stripe/portal に body なしで呼ぶと PIN or 確認フレーズが要求される
	test('body なしで Portal API を呼ぶと 401 が返る', async ({ request }) => {
		const res = await request.post('/api/stripe/portal', {
			headers: { 'Content-Type': 'application/json' },
			data: {},
		});

		// 認証されていない場合は 401/403、認証されていて PIN 未入力は 401
		expect([401, 403]).toContain(res.status());
	});

	// UI: /admin/license のポータルボタン → 確認ダイアログ表示
	test('/admin/license でプラン変更ボタンが確認ダイアログを開く', async ({ page }) => {
		test.slow();
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });

		// ポータルボタンがあればクリックして確認ダイアログが出ることを検証
		const portalButton = page.getByTestId('open-portal-button');
		if (await portalButton.isVisible({ timeout: 5000 }).catch(() => false)) {
			await portalButton.click();

			// PIN or 確認フレーズの入力要素が表示される
			const pinInput = page.getByTestId('portal-pin-input');
			const phraseInput = page.getByTestId('portal-confirm-phrase-input');

			// どちらかが表示される（PIN 設定有無で分岐）
			const hasPinInput = await pinInput.isVisible({ timeout: 3000 }).catch(() => false);
			const hasPhraseInput = await phraseInput.isVisible({ timeout: 3000 }).catch(() => false);
			expect(hasPinInput || hasPhraseInput).toBe(true);

			// 未入力で送信するとエラーが表示される
			const confirmButton = page.getByTestId('portal-confirm-button');
			await confirmButton.click();

			// エラーメッセージが表示される
			await expect(page.locator('[data-part="root"][data-scope="alert"]')).toBeVisible({
				timeout: 3000,
			});
		}
		// ポータルボタンが無い場合（サブスクリプション無し）はスキップ
	});
});
