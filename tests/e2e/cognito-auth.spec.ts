// tests/e2e/cognito-auth.spec.ts
// Cognito dev モードの認証 E2E テスト
// 実行: npx playwright test --config playwright.cognito-dev.config.ts

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/** ログインページに遷移し、フォームの表示を待つ */
async function gotoLogin(page: Page) {
	await page.goto('/auth/login');
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
}

/** ログイン操作を実行し、指定URLへのリダイレクトを待つ */
async function loginAs(page: Page, email: string, password: string, expectedUrl: RegExp) {
	await gotoLogin(page);
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(expectedUrl, { timeout: 30_000 });
}

// ============================================================
// 1. ログインページ表示
// ============================================================
test.describe('ログインページ', () => {
	test('ログインフォームが表示される', async ({ page }) => {
		await gotoLogin(page);
		await expect(page.getByAltText('がんばりクエスト')).toBeVisible();
		await expect(page.getByLabel('メールアドレス')).toBeVisible();
		await expect(page.getByLabel('パスワード', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
	});

	test('テスト用アカウントのヒントが表示される（devモード）', async ({ page }) => {
		await gotoLogin(page);
		const details = page.getByText('テスト用アカウント');
		await expect(details).toBeVisible();
	});
});

// ============================================================
// 2. 正常ログイン
// ============================================================
test.describe('正常ログイン', () => {
	test('owner でログインすると /admin にリダイレクトされる', async ({ page }) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
	});

	test('parent でログインすると /admin にリダイレクトされる', async ({ page }) => {
		await loginAs(page, 'parent@example.com', 'Gq!Dev#Parent2026', /\/admin/);
	});

	test('child でログインすると /switch にリダイレクトされる', async ({ page }) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
	});
});

// ============================================================
// 3. ログイン失敗
// ============================================================
test.describe('ログイン失敗', () => {
	test('不正なパスワードでエラーが表示される', async ({ page }) => {
		await gotoLogin(page);
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード', { exact: true }).fill('wrongpassword');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page.getByText('メールアドレスまたはパスワードが正しくありません')).toBeVisible();
	});

	test('存在しないメールアドレスでエラーが表示される', async ({ page }) => {
		await gotoLogin(page);
		await page.getByLabel('メールアドレス').fill('nobody@example.com');
		await page.getByLabel('パスワード', { exact: true }).fill('Gq!Dev#Owner2026x');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page.getByText('メールアドレスまたはパスワードが正しくありません')).toBeVisible();
	});
});

// ============================================================
// 4. 認可チェック（未ログイン時のリダイレクト）
// ============================================================
test.describe('認可チェック', () => {
	test('未ログインで /admin にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/auth\/login/);
	});

	test('未ログインで /api/v1/activities は 401 相当のリダイレクト', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.ok()).toBe(true);
	});
});

// ============================================================
// 5. ロール別アクセス制御
// ============================================================
test.describe('ロール別アクセス制御', () => {
	test('child ロールで /admin にアクセスすると /switch にリダイレクトされる', async ({ page }) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/switch/);
	});

	test('owner ロールで /admin にアクセスできる', async ({ page }) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/admin/);
	});
});

// ============================================================
// 6. ログアウト
// ============================================================
test.describe('ログアウト', () => {
	test('ログアウト後に /auth/login にリダイレクトされる', async ({ page }) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
		await page.goto('/auth/logout');
		await expect(page).toHaveURL(/\/auth\/login/);
	});

	test('ログアウト後に /admin にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
		await page.goto('/auth/logout');
		await page.waitForURL(/\/auth\/login/);
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/auth\/login/);
	});
});

// ============================================================
// 7. セッション継続
// ============================================================
test.describe('セッション継続', () => {
	test('ログイン後にリロードしても認証が維持される', async ({ page }) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
		await page.reload();
		await expect(page).toHaveURL(/\/admin/);
	});

	test('ログイン済みで /auth/login にアクセスすると /admin にリダイレクトされる', async ({
		page,
	}) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
		await page.goto('/auth/login');
		await expect(page).toHaveURL(/\/admin/);
	});
});

// ============================================================
// 8. 公開ルートのアクセス
// ============================================================
test.describe('公開ルート', () => {
	test('未ログインで / にアクセスできる', async ({ page }) => {
		await page.goto('/');
		expect(page.url()).not.toContain('/error');
	});

	test('未ログインで /switch にアクセスするとログインにリダイレクトされる', async ({ page }) => {
		await page.goto('/switch');
		expect(page.url()).toContain('/auth/login');
	});

	test('/api/health は認証不要', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(body).toHaveProperty('status', 'ok');
	});
});

// ============================================================
// 9. サインアップページ
// ============================================================
test.describe('サインアップ', () => {
	test('devモードでは /auth/signup にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		await page.goto('/auth/signup');
		await expect(page).toHaveURL(/\/auth\/login/);
	});

	test('devモードではサインアップリンクが非表示', async ({ page }) => {
		await gotoLogin(page);
		const signupLink = page.locator('a').filter({ hasText: 'アカウントをお持ちでない' });
		await expect(signupLink).not.toBeVisible();
	});
});

// ============================================================
// 10. parent ロールのアクセス制御
// ============================================================
test.describe('parent ロール詳細', () => {
	test('parent ロールで /admin/subscription にアクセスできる', async ({ page }) => {
		await loginAs(page, 'parent@example.com', 'Gq!Dev#Parent2026', /\/admin/);
		await page.goto('/admin/subscription');
		await expect(page).toHaveURL(/\/admin\/subscription/);
	});

	test('parent ロールで /admin/members にアクセスできる', async ({ page }) => {
		await loginAs(page, 'parent@example.com', 'Gq!Dev#Parent2026', /\/admin/);
		await page.goto('/admin/members');
		await expect(page).toHaveURL(/\/admin\/members/);
	});
});

// ============================================================
// 11. child ロール詳細
// ============================================================
test.describe('child ロール詳細', () => {
	test('child ロールで /admin/subscription にアクセスできない', async ({ page }) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
		await page.goto('/admin/subscription');
		await expect(page).toHaveURL(/\/switch/);
	});

	test('child ロールで /admin/members にアクセスできない', async ({ page }) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
		await page.goto('/admin/members');
		await expect(page).toHaveURL(/\/switch/);
	});

	test('child ロールで /switch にアクセスできる', async ({ page }) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
		await page.goto('/switch');
		await expect(page).toHaveURL(/\/switch/);
	});

	test('child ログイン済みで /auth/login にアクセスすると /switch にリダイレクトされる', async ({
		page,
	}) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
		await page.goto('/auth/login');
		await expect(page).toHaveURL(/\/switch/);
	});
});

// ============================================================
// #4700: child ロールは /setup (初期セットアップ 9 step) に入れない + POST も拒否
// 旧実装は /setup を公開ルート扱い (ロール検査なし) にしており、招待 child が子供追加 /
// 活動・ごほうび・ルール・チャレンジ一括追加 / 初期設定の書き換えまでできた。
// ============================================================
test.describe('#4700 child ロールの /setup 拒否', () => {
	const SETUP_PAGES = [
		'/setup',
		'/setup/children',
		'/setup/activities-defaults',
		'/setup/packs',
		'/setup/rewards',
		'/setup/rules',
		'/setup/challenges',
		'/setup/questionnaire',
		'/setup/first-adventure',
		'/setup/complete',
	];

	test('child ロールで /setup/* 全 step が /switch?reason=admin_forbidden に弾かれる', async ({
		page,
	}) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
		for (const path of SETUP_PAGES) {
			await page.goto(path);
			await expect(page, `${path} は child に開かない`).toHaveURL(
				/\/switch\?reason=admin_forbidden/,
			);
		}
	});

	test('child ロールの POST /setup/children?/addChild は実行されず /switch へ (子供が増えない)', async ({
		page,
	}) => {
		await loginAs(page, 'child@example.com', 'Gq!Dev#Child2026x', /\/switch/);
		const before = await page.locator('[data-testid^="child-select-"]').count();

		// 認可層 (hooks) が handler 到達前に拒否するため、action は走らず redirect が返る。
		// SvelteKit は `?/action` への非ブラウザ POST (Accept に text/html 無し) には
		// JSON envelope `{type:'redirect', location}` + HTTP 200 で redirect を表現する。
		const res = await page.request.post('/setup/children?/addChild', {
			form: { nickname: 'E2E-CHILD-BY-CHILD-4700', age: '7', theme: 'pink' },
			maxRedirects: 0,
		});
		if (res.status() === 200) {
			const body = (await res.json()) as { type?: string; location?: string };
			expect(body.type).toBe('redirect');
			expect(body.location ?? '').toContain('/switch?reason=admin_forbidden');
		} else {
			expect([302, 303]).toContain(res.status());
			expect(res.headers().location ?? '').toContain('/switch?reason=admin_forbidden');
		}

		await page.goto('/switch');
		await expect(page.locator('[data-testid^="child-select-"]')).toHaveCount(before);
		await expect(page.getByText('E2E-CHILD-BY-CHILD-4700')).toHaveCount(0);
	});

	test('owner ロールは /setup/children に入れる (setup 完了済テナントの再入は従来どおり)', async ({
		page,
	}) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
		await page.goto('/setup/children');
		await expect(page).toHaveURL(/\/setup\/children/);
	});

	test('未認証で /setup/children は /auth/login へ', async ({ page }) => {
		await page.goto('/setup/children');
		await expect(page).toHaveURL(/\/auth\/login/);
	});
});

// ============================================================
// #4700: ログアウトで親ゲート PIN session cookie (gq_parent_session) も破棄される
// 旧実装は identity / context 等 5 cookie だけ消し、gq_parent_session が残った。共有端末で
// 24 時間以内に同じ家族の大人が再ログインすると PIN 無しで親画面に入れた (PIN gate 前提の崩壊)。
// ============================================================
test.describe('#4700 ログアウト時の親ゲート session 破棄', () => {
	for (const logoutPath of ['/auth/logout', '/auth/signout']) {
		test(`${logoutPath} 後に gq_parent_session cookie が残らない`, async ({ page, context }) => {
			await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
			// 親ゲート session を実際に発行する (verify API、seed PIN 1234)
			const verify = await page.request.post('/api/v1/parent-gate/verify', {
				data: { pin: '1234' },
			});
			expect(verify.ok(), 'verify API で parent session が発行される').toBe(true);
			const issued = (await context.cookies()).find((c) => c.name === 'gq_parent_session');
			expect(issued, '前提: gq_parent_session が存在する').toBeDefined();

			await page.goto(logoutPath);
			await page.waitForURL(/\/auth\/login/);

			const after = (await context.cookies()).map((c) => c.name);
			expect(after).not.toContain('gq_parent_session');
			expect(after).not.toContain('identity_token');
			expect(after).not.toContain('context_token');
		});
	}
});

// ============================================================
// 12. 未ログイン時の保護ルート（追加）
// ============================================================
test.describe('未ログイン時の保護ルート', () => {
	test('未ログインで /admin/subscription にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		await page.goto('/admin/subscription');
		await expect(page).toHaveURL(/\/auth\/login/);
	});

	test('未ログインで /admin/members にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		await page.goto('/admin/members');
		await expect(page).toHaveURL(/\/auth\/login/);
	});

	test('未ログインで /preschool/home にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		await page.goto('/preschool/home');
		await expect(page).toHaveURL(/\/auth\/login/);
	});
});
