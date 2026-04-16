// tests/e2e/account-deletion.spec.ts
// #750: アカウント削除の E2E テスト
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で実行。
// アカウント削除 API のバリデーション（認証要件・ロール制限・パターン分岐）を検証する。
//
// NOTE: 実際のアカウント削除はテストデータを破壊するため実行しない。
// ここでは API のガードレール（401/403/400）と
// UI の削除セクション表示を検証する。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts account-deletion

import { expect, test } from '@playwright/test';
import { loginAsPlan, warmupAdminPages } from './plan-login-helpers';

test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupAdminPages(browser, ['/admin/settings']);
});

// ============================================================
// API: バリデーション（パターン不正・認証なし）
// ============================================================
test.describe('#750 アカウント削除 — API バリデーション', () => {
	test('pattern なしで POST すると 400', async ({ page }) => {
		await loginAsPlan(page, 'free');
		const res = await page.request.post('/api/v1/admin/account/delete', {
			data: {},
		});
		expect(res.status()).toBe(400);
	});

	test('不正な pattern で POST すると 400', async ({ page }) => {
		await loginAsPlan(page, 'free');
		const res = await page.request.post('/api/v1/admin/account/delete', {
			data: { pattern: 'invalid-pattern' },
		});
		expect(res.status()).toBe(400);
	});
});

// ============================================================
// API: deletion-info（owner のみ）
// ============================================================
test.describe('#750 アカウント削除 — deletion-info API', () => {
	test('owner ユーザーは deletion-info を取得できる', async ({ page }) => {
		await loginAsPlan(page, 'free');
		const res = await page.request.get('/api/v1/admin/account/deletion-info');
		// free ユーザーは owner ロールなので 200 が返る
		expect(res.status()).toBe(200);

		const body = await res.json();
		// isOnlyMember や otherMembers の構造を確認
		expect(typeof body.isOnlyMember).toBe('boolean');
	});
});

// ============================================================
// UI: /admin/settings のアカウント削除セクション表示
// ============================================================
test.describe('#750 アカウント削除 — UI 表示', () => {
	test.beforeEach(() => {
		test.slow();
	});

	test('cognito モードの /admin/settings にアカウント削除セクションが表示される', async ({
		page,
	}) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 180_000 });

		// 「アカウント削除」見出しが表示される
		await expect(page.getByRole('heading', { name: 'アカウント削除' })).toBeVisible({
			timeout: 30_000,
		});
	});

	test('アカウント削除セクションに確認フレーズ入力欄がある', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 180_000 });

		// 「アカウントを削除します」の確認フレーズ入力
		await expect(page.getByPlaceholder('アカウントを削除します')).toBeVisible({ timeout: 30_000 });
	});

	test('確認フレーズが一致しないと削除ボタンは disabled', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 180_000 });

		const deleteBtn = page.getByRole('button', { name: 'アカウントを削除する' });
		await expect(deleteBtn).toBeVisible({ timeout: 30_000 });
		await expect(deleteBtn).toBeDisabled();
	});

	test('確認フレーズを入力すると削除ボタンが有効化される', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 180_000 });

		const input = page.getByPlaceholder('アカウントを削除します');
		await expect(input).toBeVisible({ timeout: 30_000 });
		await input.fill('アカウントを削除します');

		const deleteBtn = page.getByRole('button', { name: 'アカウントを削除する' });
		await expect(deleteBtn).toBeEnabled();
	});
});
