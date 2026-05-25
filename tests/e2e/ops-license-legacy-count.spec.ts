// tests/e2e/ops-license-legacy-count.spec.ts
// #2484 (HMAC migration Phase 1.4): /ops/license/legacy-count endpoint の認証境界 E2E
//
// 実行: npx playwright test tests/e2e/ops-license-legacy-count.spec.ts
//
// 前提: cognito-dev provider の DEV_USERS を使う (ops-license.spec.ts と同パターン):
// - ops@example.com (groups: ['ops']) ... /ops/* にアクセス可
// - free@example.com (groups 未指定) ... /ops/* は 403
//
// ローカル SQLite では auth-repo countLicenseKeys が no-op (return 0) のため、
// legacyCount は 0 が想定される (migration plan §4 line 90: 「Phase 1 集計は SaaS DynamoDB only」)。
// 本テストは認証境界と response shape の検証に集中する。

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function loginAs(page: Page, email: string, password: string) {
	await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
}

test.describe('#2484 /ops/license/legacy-count 認証境界', () => {
	test('ops ユーザーは 200 で legacyCount/queriedAt/backend を取得できる', async ({ page }) => {
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
		await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });

		const response = await page.goto('/ops/license/legacy-count');
		expect(response?.status()).toBe(200);

		const body = await response?.json();
		expect(body).toMatchObject({
			legacyCount: expect.any(Number),
			queriedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
			backend: expect.stringMatching(/^(dynamodb|sqlite)$/),
		});
		// ローカル SQLite では auth-repo no-op で 0 が返る (migration plan §4 line 90)
		expect(body.legacyCount).toBeGreaterThanOrEqual(0);
	});

	test('non-ops ユーザー (free) は 403', async ({ page }) => {
		await loginAs(page, 'free@example.com', 'Gq!Dev#Free2026xy');
		await page.waitForURL(/\/admin/, { timeout: 60_000 });

		const response = await page.goto('/ops/license/legacy-count');
		expect(response?.status()).toBe(403);
	});
});
