// tests/e2e/demo-admin-license.spec.ts
// #790: /demo/admin/license が 404 を返さず本番と同等の構成で表示されることを検証。

import { expect, test } from '@playwright/test';

test.describe('#790 /demo/admin/license', () => {
	// Vite dev のコールドコンパイルで初回ロードが 20s 超えることがあるため、全テストを slow 指定で 90s 上限にする
	test.describe.configure({ mode: 'serial' });

	test('200 を返し、主要要素（プランカード・キー入力・トライアル）が表示される', async ({
		page,
	}) => {
		test.slow();
		// Vite dev サーバーは HMR WebSocket で `load` が発火しないため domcontentloaded を使う
		const response = await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		expect(response?.status(), '/demo/admin/license should not 404').toBe(200);

		// デモ説明バナー
		await expect(page.getByTestId('demo-license-notice')).toBeVisible();
		await expect(page.getByTestId('demo-license-notice')).toContainText('デモ画面です');

		// プランカード + 決済ボタン
		await expect(page.getByRole('heading', { name: '現在のプラン（デモ）' })).toBeVisible();
		await expect(page.getByTestId('demo-checkout-button')).toBeVisible();

		// ライセンスキー適用 UI（#796 と並行実装）
		await expect(page.getByTestId('demo-license-key-input')).toBeVisible();
		await expect(page.getByTestId('demo-license-key-apply-button')).toBeVisible();

		// トライアル開始ボタン
		await expect(page.getByTestId('demo-trial-start-button')).toBeVisible();
	});

	test('決済ボタンクリックで「デモでは使えません」トーストが出る', async ({ page }) => {
		test.slow(); // Vite dev のコールドコンパイルでハイドレーションに時間がかかるため
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		// ハイドレーション完了待ち (onMount が data-hydrated="true" に更新)
		// Vite dev のコールドコンパイルが絡むため十分な timeout を与える
		await expect(page.getByTestId('demo-license-page')).toHaveAttribute('data-hydrated', 'true', {
			timeout: 20_000,
		});
		const btn = page.getByTestId('demo-checkout-button');
		await btn.click();
		await expect(page.getByTestId('demo-toast')).toBeVisible();
		await expect(page.getByTestId('demo-toast')).toContainText('デモでは実際の操作はできません');
	});

	test('ライセンスキー入力は disabled（デモでは適用不可）', async ({ page }) => {
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-license-key-input')).toBeDisabled();
	});
});
