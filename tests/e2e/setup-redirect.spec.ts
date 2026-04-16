// tests/e2e/setup-redirect.spec.ts
// #965: セットアップフロー回帰テスト
//
// Postmortem #962 では、findAllChildren のクエリ変更により既に子供登録済みの
// テナントでも isSetupRequired が true を誤返却し、/setup へ無限リダイレクトされる
// 事象が発生した。この spec は hooks.server.ts §セットアップチェック の挙動を
// 直接検証し、同種の回帰を E2E レベルで捕捉する。

import { expect, test } from '@playwright/test';
import { isAwsEnv } from './helpers';

// AWS (cognito) モードではセットアップリダイレクトは local モード専用のため skip。
test.describe('#965 セットアップリダイレクト回帰', () => {
	test.skip(
		isAwsEnv(),
		'セットアップチェックは local auth mode のみで動作する (hooks.server.ts L285)',
	);

	test('子供登録済みの状態で / にアクセスすると /setup にリダイレクトされない', async ({
		page,
	}) => {
		// global-setup.ts で複数の子供 (たろうくん, はなちゃん 等) がシード済み。
		// この状態で / にアクセスすると、isSetupRequired = false となり、
		// /setup ではなく /switch へ遷移するはず（#962 回帰の直接検証）。
		const response = await page.goto('/');
		expect(response?.status(), 'アクセスは成功するはず').toBeLessThan(400);
		await expect(page).not.toHaveURL(/\/setup/);
	});

	test('/ は /switch にリダイレクトされる（セットアップ完了済みテナント）', async ({ page }) => {
		await page.goto('/');
		// セットアップ済み → /switch が最終到達 URL
		await expect(page).toHaveURL(/\/switch/);
	});

	test('セットアップ完了済みで /setup へ直接アクセスすると / にリダイレクトされる', async ({
		page,
	}) => {
		// hooks.server.ts L304: セットアップ完了済みなら /setup への
		// 直接アクセスをブロックして / に戻す。
		await page.goto('/setup');
		// / へ戻り、さらに /switch へリダイレクトされる想定。
		await expect(page).not.toHaveURL(/\/setup$/);
	});

	test('/preschool/home へ直接アクセスしても /setup にリダイレクトされない', async ({ page }) => {
		// 子供 UI パスへの直接アクセスも、セットアップチェックで誤リダイレクトされないことを検証。
		const response = await page.goto('/preschool/home');
		expect(response?.status()).toBeLessThan(400);
		await expect(page).not.toHaveURL(/\/setup/);
	});
});
