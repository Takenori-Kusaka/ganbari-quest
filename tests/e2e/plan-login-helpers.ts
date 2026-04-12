// tests/e2e/plan-login-helpers.ts
// #779: plan-standard.spec.ts / plan-family.spec.ts と
// 既存 plan-gated-features.spec.ts で共有するログインヘルパー
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true の dev cognito provider が
// 用意しているプラン別ダミーユーザー（free / standard / family）を使う。
// 詳しくは src/lib/server/auth/providers/cognito-dev.ts の DEV_USERS。

import type { Page } from '@playwright/test';

export const PLAN_USERS = {
	free: { email: 'free@example.com', password: 'Gq!Dev#Free2026xy' },
	standard: { email: 'standard@example.com', password: 'Gq!Dev#Std2026xyz' },
	family: { email: 'family@example.com', password: 'Gq!Dev#Fam2026xyz' },
} as const;

export type PlanUserKey = keyof typeof PLAN_USERS;

/**
 * dev cognito provider の指定プランユーザーでログインし /admin に到達する。
 *
 * Vite dev のコールドコンパイルでは load/domcontentloaded の到達に
 * 数十秒〜数分かかることがあるため、navigation は commit イベントで打ち切り、
 * 画面要素は waitFor で待つ。
 */
export async function loginAsPlan(page: Page, plan: PlanUserKey): Promise<void> {
	const { email, password } = PLAN_USERS[plan];
	await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/admin/, { timeout: 120_000 });
}

/**
 * Vite dev のコールドコンパイルで初回ビルドが数分かかる画面を warmup する。
 * 各 spec の `test.beforeAll` から呼んで beforeEach のタイムアウトを抑える。
 */
export async function warmupAdminPages(
	browser: import('@playwright/test').Browser,
	paths: readonly string[],
): Promise<void> {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	try {
		await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
		await page
			.getByLabel('メールアドレス')
			.waitFor({ state: 'visible', timeout: 180_000 })
			.catch(() => {});
		for (const path of paths) {
			await page.goto(path, { waitUntil: 'commit', timeout: 180_000 }).catch(() => {});
		}
	} finally {
		await ctx.close();
	}
}
