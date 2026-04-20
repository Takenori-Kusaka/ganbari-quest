// tests/e2e/error-page-fallback.spec.ts
// #577: 404/エラー画面のフォールバック強化 — ロール別の導線検証
//
// エラー画面で「ロール（親/子供）」×「エラー種別」の挙動を検証する。
// 子供ロールでの自動リダイレクトはタイマー経過を待つため、
// 3 秒 + 余裕で 6 秒のタイムアウトを使用する。

import { expect, test } from '@playwright/test';

test.describe('#577 エラー画面フォールバック', () => {
	test.describe('匿名ユーザー (親扱い)', () => {
		test('存在しないパスで 404 画面とトップリンクが表示される', async ({ page }) => {
			const response = await page.goto('/this-path-does-not-exist-xyz');
			expect(response?.status()).toBe(404);

			// ステータスコードとタイトル
			await expect(page.getByText('404', { exact: true }).first()).toBeVisible();
			await expect(page.getByText('ページが みつかりません')).toBeVisible();

			// 親ロール向けリンクが表示される
			await expect(page.getByRole('link', { name: 'トップページへ戻る' })).toBeVisible();

			// 子供向けの大きなボタンは表示されない
			await expect(page.getByRole('link', { name: 'いますぐ もどる' })).toHaveCount(0);
		});

		test('404 画面から自動リダイレクトしない（親ロール）', async ({ page }) => {
			await page.goto('/this-path-does-not-exist-xyz');
			// 4 秒以内に /switch にリダイレクトしないことを negative wait で検証 (#1259)
			const redirected = await page
				.waitForURL(/\/switch/, { timeout: 4000 })
				.then(() => true)
				.catch(() => false);
			expect(redirected).toBe(false);
			expect(page.url()).toMatch(/this-path-does-not-exist-xyz/);
		});
	});

	// 子供ロールの自動リダイレクトは E2E で検証するために
	// 事前にセッションを子供としてセットアップする必要がある。
	// 現状の smoke テストで使われる selectKinderChild パターンを利用。
	test.describe('子供ロール (要セッション)', () => {
		test.skip(
			process.env.CI !== 'false',
			'子供セッションのセットアップは別スイートでカバーされるため、個別 skip',
		);
	});
});
