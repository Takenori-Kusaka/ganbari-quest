// tests/e2e/premium-welcome.spec.ts
// #778: 初回アップグレード時の歓迎モーダル E2E
//
// PremiumWelcome モーダル（src/lib/features/admin/components/PremiumWelcome.svelte）の
// トリガ条件と永続化動作を検証する。
//
// 表示条件:
//  - planTier が standard / family
//  - settings.premium_welcome_shown !== 'true'
// 非表示化:
//  - 「さっそく始める →」ボタン押下 → POST ?/dismissPremiumWelcome
//    → settings.premium_welcome_shown = 'true' で永続化
//
// 設計メモ:
//  - SQLite settings は tenantId 引数を無視するシングルテナント実装
//    （src/lib/server/db/sqlite/settings-repo.ts）。よって全プランユーザー
//    が同じ premium_welcome_shown を共有する。
//    ローカル E2E では beforeEach で settings 行を削除して初回表示状態を再現し、
//    afterEach で `'true'` に戻すことで他 spec への副作用を防ぐ。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts premium-welcome

import path from 'node:path';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { loginAsPlan, warmupAdminPages } from './plan-login-helpers';

const DB_PATH = path.resolve('data/ganbari-quest.db');

function resetWelcomeFlag(): void {
	const db = new Database(DB_PATH);
	try {
		db.prepare("DELETE FROM settings WHERE key = 'premium_welcome_shown'").run();
	} finally {
		db.close();
	}
}

function markWelcomeDismissed(): void {
	const db = new Database(DB_PATH);
	try {
		db.prepare(
			"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('premium_welcome_shown', 'true', datetime('now'))",
		).run();
	} finally {
		db.close();
	}
}

test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupAdminPages(browser, ['/admin']);
});

test.afterEach(() => {
	// 他 spec の /admin 訪問にモーダルがかぶらないよう必ず dismissed 状態に戻す
	markWelcomeDismissed();
});

test.describe('#778 PremiumWelcome モーダル', () => {
	test.beforeEach(() => {
		test.slow(); // Vite dev のコールドコンパイルでタイムアウトを 3x 延長
		resetWelcomeFlag();
	});

	test('standard プラン初回 /admin で歓迎モーダルが表示される', async ({ page }) => {
		await loginAsPlan(page, 'standard');
		await page.goto('/admin');
		const dialog = page.getByRole('dialog', { name: /スタンダード.*ようこそ/ });
		await expect(dialog).toBeVisible();
		// 「解放された機能」セクションが含まれる
		await expect(dialog.getByText('解放された機能')).toBeVisible();
		// standard 固有の項目（PREMIUM_UNLOCKED_FEATURES.standard より）
		await expect(dialog.getByText('AI による活動提案')).toBeVisible();
	});

	test('family プラン初回 /admin で歓迎モーダルが表示される', async ({ page }) => {
		await loginAsPlan(page, 'family');
		await page.goto('/admin');
		const dialog = page.getByRole('dialog', { name: /ファミリー.*ようこそ/ });
		await expect(dialog).toBeVisible();
		// family 固有の項目（PREMIUM_UNLOCKED_FEATURES.family より）
		await expect(dialog.getByText('きょうだいランキング')).toBeVisible();
		await expect(dialog.getByText('ひとことメッセージ（自由テキスト）')).toBeVisible();
	});

	test('「さっそく始める」で閉じた後はリロードしても表示されない', async ({ page }) => {
		await loginAsPlan(page, 'standard');
		await page.goto('/admin');
		const dialog = page.getByRole('dialog', { name: /スタンダード.*ようこそ/ });
		await expect(dialog).toBeVisible();
		await page.getByRole('button', { name: /さっそく始める/ }).click();
		await expect(dialog).toHaveCount(0);
		// リロード後も再表示されない（永続化されている）
		await page.reload();
		await expect(page.getByRole('dialog', { name: /ようこそ/ })).toHaveCount(0);
	});

	test('free プランでは歓迎モーダルは出ない（プラン条件ガード）', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin');
		// AdminHome の {#if welcomeVisible && (planTier === 'standard' || 'family')} ガード
		await expect(page.getByRole('dialog', { name: /ようこそ/ })).toHaveCount(0);
	});
});
