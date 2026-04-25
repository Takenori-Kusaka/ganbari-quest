// tests/e2e/auth.setup.ts
// #1497: cognito-dev E2E の storageState による認証キャッシュ
//
// DEV_USERS の owner / free / ops の 3 ロールでログインし、
// セッション状態を playwright/.auth/<role>.json に保存する。
// 後続テストは storageState で認証済み状態から開始できる。
//
// 実行: playwright.cognito-dev.config.ts の setup プロジェクトとして自動実行

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Browser } from '@playwright/test';
import { test as setup } from '@playwright/test';

const AUTH_DIR = 'playwright/.auth';

type Role = 'owner' | 'free' | 'ops';

const DEV_USERS: Record<Role, { email: string; password: string; expectedUrlPattern: RegExp }> = {
	owner: {
		email: 'owner@example.com',
		password: 'Gq!Dev#Owner2026x',
		expectedUrlPattern: /\/admin/,
	},
	free: {
		email: 'free@example.com',
		password: 'Gq!Dev#Free2026xy',
		expectedUrlPattern: /\/admin/,
	},
	ops: {
		email: 'ops@example.com',
		password: 'Gq!Dev#Ops2026xyz',
		expectedUrlPattern: /\/(admin|ops)/,
	},
};

/** ログインして storageState を保存する */
async function loginAndSave(
	role: Role,
	email: string,
	password: string,
	expectedUrlPattern: RegExp,
	browser: Browser,
) {
	const context = await browser.newContext();
	const page = await context.newPage();

	await page.goto('/auth/login');
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });

	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();

	await page.waitForURL(expectedUrlPattern, { timeout: 30_000 });

	const authFile = path.join(AUTH_DIR, `${role}.json`);
	await context.storageState({ path: authFile });
	await context.close();
}

// AUTH_DIR を事前に作成
setup.beforeAll(async () => {
	if (!fs.existsSync(AUTH_DIR)) {
		fs.mkdirSync(AUTH_DIR, { recursive: true });
	}
});

setup('owner ロールでログインして storageState を保存', async ({ browser }) => {
	const { email, password, expectedUrlPattern } = DEV_USERS.owner;
	await loginAndSave('owner', email, password, expectedUrlPattern, browser);
});

setup('free ロールでログインして storageState を保存', async ({ browser }) => {
	const { email, password, expectedUrlPattern } = DEV_USERS.free;
	await loginAndSave('free', email, password, expectedUrlPattern, browser);
});

setup('ops ロールでログインして storageState を保存', async ({ browser }) => {
	const { email, password, expectedUrlPattern } = DEV_USERS.ops;
	await loginAndSave('ops', email, password, expectedUrlPattern, browser);
});
