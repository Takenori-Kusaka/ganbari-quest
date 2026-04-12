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

	test('#817 ライセンスキー入力は enabled（モック適用フロー）', async ({ page }) => {
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-license-key-input')).toBeEnabled();
		// 空の場合は適用ボタンが disabled
		await expect(page.getByTestId('demo-license-key-apply-button')).toBeDisabled();
	});

	test('#817 キー入力→「適用」クリックで確認ダイアログが表示される', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-license-page')).toHaveAttribute('data-hydrated', 'true', {
			timeout: 20_000,
		});

		// ライセンスキーを入力
		await page.getByTestId('demo-license-key-input').fill('GQ-TEST-1234-ABCD');
		// 適用ボタンが有効化されること
		await expect(page.getByTestId('demo-license-key-apply-button')).toBeEnabled();
		// 適用ボタンをクリック
		await page.getByTestId('demo-license-key-apply-button').click();
		// 確認ダイアログが表示される
		await expect(page.getByTestId('demo-license-key-confirm-dialog')).toBeVisible();
		// 入力したキーが確認ダイアログに表示される
		await expect(page.getByTestId('demo-license-key-confirm-display')).toContainText(
			'GQ-TEST-1234-ABCD',
		);
	});

	test('#817 チェックボックス同意で「適用する」ボタンが有効化される', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-license-page')).toHaveAttribute('data-hydrated', 'true', {
			timeout: 20_000,
		});

		// キーを入力して確認ダイアログを開く
		await page.getByTestId('demo-license-key-input').fill('GQ-TEST-1234-ABCD');
		await page.getByTestId('demo-license-key-apply-button').click();
		await expect(page.getByTestId('demo-license-key-confirm-dialog')).toBeVisible();

		// 同意チェックなしでは「適用する」ボタンが無効
		await expect(page.getByTestId('demo-license-key-confirm-button')).toBeDisabled();

		// チェックボックスをクリックして同意
		await page.getByTestId('demo-license-key-once-checkbox').check();

		// 「適用する」ボタンが有効化される
		await expect(page.getByTestId('demo-license-key-confirm-button')).toBeEnabled();
	});

	test('#817 「適用する」クリックで成功メッセージが表示されプラン表示が更新される', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-license-page')).toHaveAttribute('data-hydrated', 'true', {
			timeout: 20_000,
		});

		// 初期プラン表示はフリー
		await expect(page.getByTestId('demo-current-plan')).toContainText('無料プラン');

		// キーを入力 → 確認ダイアログ → 同意 → 適用
		await page.getByTestId('demo-license-key-input').fill('GQ-STANDARD-1234');
		await page.getByTestId('demo-license-key-apply-button').click();
		await expect(page.getByTestId('demo-license-key-confirm-dialog')).toBeVisible();
		await page.getByTestId('demo-license-key-once-checkbox').check();
		await page.getByTestId('demo-license-key-confirm-button').click();

		// 成功メッセージが表示される
		await expect(page.getByTestId('demo-apply-success')).toBeVisible();
		await expect(page.getByTestId('demo-apply-success')).toContainText(
			'ライセンスキーが適用されました',
		);
		// プラン表示がスタンダードに更新される
		await expect(page.getByTestId('demo-current-plan')).toContainText('スタンダード');
	});

	test('#817 FAMILY を含むキーでファミリープランに変更される', async ({ page }) => {
		test.slow();
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-license-page')).toHaveAttribute('data-hydrated', 'true', {
			timeout: 20_000,
		});

		// FAMILY を含むキーを入力 → 確認ダイアログ → 同意 → 適用
		await page.getByTestId('demo-license-key-input').fill('GQ-FAMILY-5678-WXYZ');
		await page.getByTestId('demo-license-key-apply-button').click();
		await expect(page.getByTestId('demo-license-key-confirm-dialog')).toBeVisible();
		await page.getByTestId('demo-license-key-once-checkbox').check();
		await page.getByTestId('demo-license-key-confirm-button').click();

		// 成功メッセージが表示される
		await expect(page.getByTestId('demo-apply-success')).toBeVisible();
		// プラン表示がファミリーに更新される
		await expect(page.getByTestId('demo-current-plan')).toContainText('ファミリー');
	});

	test('#799 ライセンスキーのヘルプ（折りたたみ）を展開すると注意文言が表示される', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/demo/admin/license', { waitUntil: 'domcontentloaded' });
		// ヘルプは初期非表示
		await expect(page.getByTestId('demo-license-help')).toHaveCount(0);
		// ハイドレーション完了待ち
		await expect(page.getByTestId('demo-license-page')).toHaveAttribute('data-hydrated', 'true', {
			timeout: 20_000,
		});
		// トグルをクリックして展開
		await page.getByTestId('demo-license-help-toggle').click();
		const help = page.getByTestId('demo-license-help');
		await expect(help).toBeVisible();
		await expect(help).toContainText('一回限り');
		await expect(help).toContainText('プラン自動付与');
		await expect(help).toContainText('紐付け先');
		await expect(help).toContainText('取り消し不可');
	});
});
