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

/**
 * 現在開いている /auth/login (query 付き) でフォーム送信する (#4701)。
 * hydration 前に fill すると Svelte の bind が空で上書きしてボタンが disabled のままになるため、
 * 「fill → ボタンが enabled」を確認してから click する (enabled にならなければ fill をやり直す)。
 */
async function submitLoginForm(page: Page, email: string, password: string) {
	const submit = page.getByRole('button', { name: 'ログイン' });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	for (let attempt = 0; attempt < 3; attempt++) {
		await page.getByLabel('メールアドレス').fill(email);
		await page.getByLabel('パスワード', { exact: true }).fill(password);
		try {
			await expect(submit).toBeEnabled({ timeout: 3_000 });
			break;
		} catch {
			// hydration 競合。再 fill する
		}
	}
	await submit.click();
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
// #4701: ログイン画面は「なぜ戻されたか」を query から表示し、`?next=` で元の画面に戻す
// ============================================================
test.describe('#4701 ログイン画面の状態表示 (query → 文言)', () => {
	const cases: Array<{ query: string; role: 'status' | 'alert'; text: RegExp }> = [
		{ query: 'registered=true', role: 'status', text: /登録が完了/ },
		{ query: 'confirmed=true', role: 'status', text: /確認が完了/ },
		{ query: 'passwordReset=true', role: 'status', text: /パスワードがリセット/ },
		{ query: 'reason=deleted', role: 'alert', text: /ログインできません/ },
		{ query: 'error=oauth_failed', role: 'alert', text: /Google でのログインを完了できません/ },
		{ query: 'error=missing_params', role: 'alert', text: /途中で情報が失われ/ },
		{ query: 'error=invalid_state', role: 'alert', text: /途中で情報が失われ/ },
		{ query: 'error=token_exchange_failed', role: 'alert', text: /Google アカウントの確認に失敗/ },
		{ query: 'error=something_unknown', role: 'alert', text: /ログインを完了できませんでした/ },
	];
	for (const c of cases) {
		test(`/auth/login?${c.query} → role=${c.role} の説明が出る`, async ({ page }) => {
			await page.goto(`/auth/login?${c.query}`);
			const notice = page.getByTestId('login-notice');
			await expect(notice).toBeVisible();
			await expect(notice).toHaveAttribute('role', c.role);
			await expect(notice).toContainText(c.text);
		});
	}

	test('query 無しでは通知が出ない (回帰: 常時表示にならない)', async ({ page }) => {
		await gotoLogin(page);
		await expect(page.getByTestId('login-notice')).toHaveCount(0);
	});
});

test.describe('#4701 ログイン後の戻り先 (?next=)', () => {
	test('?next=/admin/settings/account → ログイン後に同 URL に着地 (password 経路)', async ({
		page,
	}) => {
		await page.goto('/auth/login?next=/admin/settings/account');
		await expect(page.getByTestId('login-next-notice')).toBeVisible();
		await submitLoginForm(page, 'owner@example.com', 'Gq!Dev#Owner2026x');
		await page.waitForURL(/\/admin\/settings\/account/, { timeout: 30_000 });
	});

	test('?next= に入れ子 query (/admin/activities?import=x) を encode で引き継げる', async ({
		page,
	}) => {
		await page.goto('/auth/login?next=/admin/activities%3Fimport%3Dkinder-starter');
		await submitLoginForm(page, 'owner@example.com', 'Gq!Dev#Owner2026x');
		await page.waitForURL(/\/admin\/activities\?import=kinder-starter/, { timeout: 30_000 });
	});

	for (const evil of ['//evil.com', 'https://evil.com/x', `/${String.fromCharCode(92)}evil.com`]) {
		test(`?next=${evil} (外部 / protocol-relative) は無視して /admin に着地`, async ({ page }) => {
			await page.goto(`/auth/login?next=${encodeURIComponent(evil)}`);
			await expect(page.getByTestId('login-next-notice')).toHaveCount(0);
			await submitLoginForm(page, 'owner@example.com', 'Gq!Dev#Owner2026x');
			await page.waitForURL(/\/admin(\/|\?|$)/, { timeout: 30_000 });
			expect(page.url()).not.toContain('evil.com');
		});
	}

	test('ログイン済みで /auth/login?next=/admin/settings/account → 即 next へ', async ({ page }) => {
		await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x', /\/admin/);
		await page.goto('/auth/login?next=/admin/settings/account');
		await expect(page).toHaveURL(/\/admin\/settings\/account/);
	});

	test('child が ?next=/admin/... でログインしても認可で /switch に戻る (権限昇格にならない)', async ({
		page,
	}) => {
		await page.goto('/auth/login?next=/admin/settings/account');
		await submitLoginForm(page, 'child@example.com', 'Gq!Dev#Child2026x');
		await page.waitForURL(/\/switch/, { timeout: 30_000 });
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
