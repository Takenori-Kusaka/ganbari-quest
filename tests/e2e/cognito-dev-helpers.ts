// tests/e2e/cognito-dev-helpers.ts
// cognito-dev モード（AUTH_MODE=cognito + COGNITO_DEV_MODE=true）の E2E 共通ヘルパー。
//
// - プラン別 dev ユーザー定義（DevCognitoAuthProvider.DEV_USERS と同期）
// - loginAs: Vite dev のコールドコンパイル（load/domcontentloaded が長時間完了しない）を
//            避けるため `waitUntil: 'commit'` で navigation を解除し、フォーム表示は waitFor で待つ。
// - warmupCognitoDev: describe/spec の beforeAll で呼び出し、/auth/login と主要な admin
//                     配下ページをプリコンパイルして 1 本目のテストの timeout を防ぐ。

import type { Browser, Page } from '@playwright/test';

export const PLAN_USERS = {
	free: { email: 'free@example.com', password: 'Gq!Dev#Free2026xy' },
	standard: { email: 'standard@example.com', password: 'Gq!Dev#Std2026xyz' },
	family: { email: 'family@example.com', password: 'Gq!Dev#Fam2026xyz' },
} as const;

export type PlanKey = keyof typeof PLAN_USERS;

export async function loginAs(page: Page, plan: PlanKey): Promise<void> {
	const { email, password } = PLAN_USERS[plan];
	await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/admin/, { timeout: 120_000 });
}

/**
 * Vite dev のコールドコンパイルを先に済ませて、1 本目のテストが timeout するのを防ぐ。
 * 呼び出し側で `test.setTimeout(360_000)` を設定してから呼ぶこと。
 */
export async function warmupCognitoDev(browser: Browser, paths: string[]): Promise<void> {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	try {
		await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
		await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
		for (const path of paths) {
			await page.goto(path, { waitUntil: 'commit', timeout: 180_000 }).catch(() => {});
		}
	} finally {
		await ctx.close();
	}
}
