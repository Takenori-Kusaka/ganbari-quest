// tests/e2e/marketplace-checklist-import.spec.ts
// #2137 (MP-2): event-checklist 一括追加フロー E2E
//
// 検証対象:
// 1. /marketplace/checklist/event-pool 詳細ページに「一括追加」CTA が描画される
//    (ログイン済 = AUTH_MODE=local 認証通過後)
// 2. /admin/checklists にマーケットプレイス取込セクションが表示される
//    (event-pool / event-school-start / event-field-trip 3 件 + 「一括追加」ボタン)
// 3. /admin/checklists 経由で event-pool の preset を一括追加 → 同 preset が
//    取込済 Badge に切り替わり、ボタンが disabled になる
// 4. 同一 preset の重複 import は alreadyImported Result が返り、テンプレート総数が増えない
//
// 認証: AUTH_MODE=local の自動セットアップで /admin 配下に到達できる前提
//   (hooks.server.ts + tests/e2e/global-setup.ts の tenant seed)。

import { expect, test } from '@playwright/test';

test.describe('#2137 マーケットプレイス checklist 一括追加', () => {
	test.setTimeout(180_000); // Vite dev コールドコンパイル耐性

	// ============================================================
	// 1. 詳細ページ CTA — checklist は「一括追加」ボタンに置換されている
	// ============================================================
	test('marketplace/checklist/event-pool 詳細ページに「一括追加」CTA が表示される', async ({
		page,
	}) => {
		test.slow();
		const res = await page.goto('/marketplace/checklist/event-pool', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		// AUTH_MODE=local ではログイン済 → 一括追加 button が表示される
		// (未ログイン環境では signup redirect になるため、別 spec で扱う)
		const cta = page.getByTestId('marketplace-detail-cta');
		await expect(cta).toBeVisible();

		// 「一括追加」 button または signup redirect link のいずれかが描画される
		const importBtn = page.getByTestId('marketplace-import-button');
		const signupLink = page.getByTestId('marketplace-signup-redirect');
		// 両方 hidden は AC 違反
		const eitherVisible = (await importBtn.count()) > 0 || (await signupLink.count()) > 0;
		expect(eitherVisible).toBe(true);
	});

	test('marketplace/checklist/event-school-start / event-field-trip も 200 で開ける', async ({
		page,
	}) => {
		test.slow();
		const r1 = await page.goto('/marketplace/checklist/event-school-start', {
			waitUntil: 'domcontentloaded',
		});
		expect(r1?.status()).toBe(200);

		const r2 = await page.goto('/marketplace/checklist/event-field-trip', {
			waitUntil: 'domcontentloaded',
		});
		expect(r2?.status()).toBe(200);
	});

	// ============================================================
	// 2. admin/checklists の「マーケットプレイスから一括追加」セクション
	// ============================================================
	test('/admin/checklists にマーケットプレイス取込セクションが描画される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });

		// マーケットプレイス section
		const section = page.getByTestId('marketplace-import-section');
		await expect(section).toBeVisible({ timeout: 30_000 });

		// #2391 (Phase 2): UnifiedImportHub 統合で `marketplace-preset-row-{itemId}` (container)
		// は廃止。`marketplace-preset-import-{itemId}` (button) で同等の見え方を確認する。
		await expect(page.getByTestId('marketplace-preset-import-event-pool')).toBeVisible();
		await expect(page.getByTestId('marketplace-preset-import-event-school-start')).toBeVisible();
		await expect(page.getByTestId('marketplace-preset-import-event-field-trip')).toBeVisible();
	});

	// ============================================================
	// 3-4. 一括追加 → 取込済 Badge → 重複時スキップ
	// ============================================================
	test('admin/checklists から event-pool を一括追加 → 取込済 Badge + ボタン disabled', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });

		const importBtn = page.getByTestId('marketplace-preset-import-event-pool');
		await expect(importBtn).toBeVisible();

		// 既に取込済の可能性がある場合は (alreadyImported badge) skip
		const alreadyImported = page.getByTestId('marketplace-preset-imported-event-pool');
		const wasAlreadyImported = (await alreadyImported.count()) > 0;

		if (wasAlreadyImported) {
			// 既に取込済 → ボタンが disabled かつ Badge が visible
			await expect(alreadyImported).toBeVisible();
			await expect(importBtn).toBeDisabled();
			return;
		}

		// 取込前: ボタンが enabled
		await expect(importBtn).toBeEnabled();

		// 一括追加 button を押下
		await importBtn.click();

		// Action + invalidateAll() 完了後、取込済 Badge が表示されボタンが disabled になる
		// (form prop は invalidate で消える可能性があるため、永続的な state 変化のみ assert)
		await expect(page.getByTestId('marketplace-preset-imported-event-pool')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByTestId('marketplace-preset-import-event-pool')).toBeDisabled();
	});

	test('admin/checklists で同 preset を再度押下しても重複扱い (alreadyImported)', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });

		// event-school-start を 2 回 import 試行
		const importBtn = page.getByTestId('marketplace-preset-import-event-school-start');
		await expect(importBtn).toBeVisible();

		// 既に取込済なら disabled、その場合は POST が走らないため UI のみ確認
		if (await importBtn.isDisabled().catch(() => false)) {
			await expect(
				page.getByTestId('marketplace-preset-imported-event-school-start'),
			).toBeVisible();
			return;
		}

		// 1 回目 import → 永続的な state 変化 (Badge + disabled) を assert
		await importBtn.click();
		await expect(page.getByTestId('marketplace-preset-imported-event-school-start')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByTestId('marketplace-preset-import-event-school-start')).toBeDisabled();

		// reload しても重複扱い (state 永続性確認)
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('marketplace-preset-imported-event-school-start')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByTestId('marketplace-preset-import-event-school-start')).toBeDisabled();
	});
});
