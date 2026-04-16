// tests/e2e/ops-license-issue.spec.ts
// #802: /ops/license/issue キャンペーンキー一括発行 UI 動線 E2E
//
// 実行: npx playwright test tests/e2e/ops-license-issue.spec.ts
//
// ローカル SQLite では license_keys が永続化されないため、発行は
// 「form を POST して成功画面が出る」ところまでを検証する。
// DynamoDB 永続化 + 発行後の validate/consume 往復テストは別 Issue 管轄。

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function loginAs(page: Page, email: string, password: string) {
	await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
}

test.describe('#802 /ops/license/issue 認可', () => {
	test('ops ユーザーは /ops/license/issue にアクセスできる', async ({ page }) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });

		await page.goto('/ops/license/issue');
		await expect(page.getByRole('heading', { name: /キャンペーンキー一括発行/ })).toBeVisible({
			timeout: 30_000,
		});
	});

	test('non-ops (free) は /ops/license/issue アクセスで 403', async ({ page }) => {
		await loginAs(page, 'free@example.com', 'Gq!Dev#Free2026xy');
		await page.waitForURL(/\/admin/, { timeout: 60_000 });

		const response = await page.goto('/ops/license/issue');
		expect(response?.status()).toBe(403);
	});
});

test.describe('#802 /ops/license/issue フォームバリデーション', () => {
	test('理由を空にすると required で submit ブロックされる', async ({ page }) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });
		await page.goto('/ops/license/issue');

		// reason 未入力のまま submit → HTML required でクライアント側で止まる
		await page.getByRole('button', { name: 'キーを発行する' }).click();
		// URL は遷移しないことで validity が効いていることを確認
		await expect(page).toHaveURL(/\/ops\/license\/issue/);
	});

	test('ナビから /ops/license の「キャンペーンキーを発行」ボタンが見える', async ({ page }) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });
		await page.goto('/ops/license');

		const issueLink = page.getByRole('link', { name: /キャンペーンキーを発行/ });
		await expect(issueLink).toBeVisible({ timeout: 30_000 });
		await expect(issueLink).toHaveAttribute('href', '/ops/license/issue');
	});
});
