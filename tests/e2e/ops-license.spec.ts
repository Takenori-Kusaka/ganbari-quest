// tests/e2e/ops-license.spec.ts
// #805: /ops/license 管理 UI の認可・検索・失効フローの E2E
//
// 実行: npx playwright test tests/e2e/ops-license.spec.ts
//
// 前提: cognito-dev provider の ops ユーザー (DEV_USERS) を使う。
// - ops@example.com (groups: ['ops']) ... /ops 配下にアクセス可
// - free@example.com (groups 未指定) ... /ops は 403
//
// ローカル SQLite では license_keys が永続化されない (auth-repo は no-op) ため、
// 実レコードに対する "失効→validate 失敗" の往復は本テストのスコープ外とする。
// DB 永続化は別 Issue (sqlite auth-repo 実装) で対応。本テストでは UI 動線と
// 認可・ガードの網羅を優先する。

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function loginAs(page: Page, email: string, password: string) {
	await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
}

test.describe('#805 /ops/license 認可', () => {
	test('ops ユーザーは /ops/license にアクセスできる', async ({ page }) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });

		await page.goto('/ops/license');
		await expect(page.getByRole('heading', { name: /ライセンスキー検索/ })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByPlaceholder('GQ-XXXX-XXXX-XXXX-YYYYY')).toBeVisible();
	});

	test('non-ops ユーザー (free) は /ops/license にアクセスで 403', async ({ page }) => {
		await loginAs(page, 'free@example.com', 'Gq!Dev#Free2026xy');
		await page.waitForURL(/\/admin/, { timeout: 60_000 });

		const response = await page.goto('/ops/license');
		expect(response?.status()).toBe(403);
	});
});

test.describe('#805 /ops/license 検索動線', () => {
	test('検索フォームに未存在キーを入力すると詳細 URL へ遷移し「レコードなし」を表示', async ({
		page,
	}) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });

		await page.goto('/ops/license');
		await page.getByPlaceholder('GQ-XXXX-XXXX-XXXX-YYYYY').fill('GQ-NOT-EXIST-KEY-00001');
		await page.getByRole('button', { name: '検索' }).click();

		await page.waitForURL(/\/ops\/license\/GQ-NOT-EXIST-KEY-00001/, { timeout: 30_000 });
		await expect(page.getByText('レコードなし')).toBeVisible();
	});

	test('空文字検索はエラーメッセージを表示', async ({ page }) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });

		await page.goto('/ops/license');
		// HTML required 属性が先にブロックするため、JS で required を外して POST を許可
		await page.evaluate(() => {
			const input = document.querySelector('input[name="licenseKey"]') as HTMLInputElement | null;
			if (input) input.required = false;
		});
		await page.getByRole('button', { name: '検索' }).click();
		await expect(page.getByText('ライセンスキーを入力してください')).toBeVisible({
			timeout: 10_000,
		});
	});
});

test.describe('#805 /ops/license/[key] 失効アクション ガード', () => {
	test('レコードなしのキーでは失効ボタンが表示されない', async ({ page }) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });

		await page.goto('/ops/license/GQ-MISSING-KEY-FOR-GUARD');
		await expect(page.getByText('レコードなし')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'このキーを失効させる' })).toHaveCount(0);
	});

	test('non-ops が詳細 URL に直接アクセスすると 403', async ({ page }) => {
		await loginAs(page, 'free@example.com', 'Gq!Dev#Free2026xy');
		await page.waitForURL(/\/admin/, { timeout: 60_000 });

		const response = await page.goto('/ops/license/GQ-ANY-KEY-00001');
		expect(response?.status()).toBe(403);
	});
});
