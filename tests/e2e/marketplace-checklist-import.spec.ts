// tests/e2e/marketplace-checklist-import.spec.ts
// #2137 (MP-2): event-checklist 一括追加フロー E2E
// #2362 PR-5 Phase 2 (ADR-0055 / CWE-598): marketplace 詳細ページから childId 排除、
//   admin/checklists?import= 経由の auto-open dialog 動線に rewrite。
// #2558 段階3 (PR #2773): admin/checklists 内 in-page UnifiedImportHub browse UI を撤去
//   (DESIGN.md §10「marketplace 取込はマーケットプレイス画面に一本化」)。
// #2774 (5 type 統一): marketplace 詳細 CTA は `<a href="/admin/<page>?import=<itemId>">` +
//   testid `<typeCode>-import-cta` 規約に統一。server action `?/importChecklist` 撤去。
//
// 検証対象 (新 flow):
// 1. /marketplace/checklist/event-pool 詳細ページに「取込」CTA (`checklist-import-cta`) が描画される
//    (ログイン済 = AUTH_MODE=local 認証通過後)
// 2. /admin/checklists に browse link (`/marketplace?type=checklist` 遷移) が visible
//    + in-page browse UI 不出 (二重 UI 不出 trip wire)
// 3. marketplace 詳細 → CTA click → admin/checklists?import= redirect →
//    ChildSelectionDialog auto-open → 全員選択 → confirm → 成功 action message 表示
// 4. 同 preset の重複取込でも action message 表示 (重複扱い、Strategy 経由 200 path)
//
// 認証: AUTH_MODE=local の自動セットアップで /admin 配下に到達できる前提
//   (hooks.server.ts + tests/e2e/global-setup.ts の tenant seed)。

import { expect, test } from '@playwright/test';

test.describe('#2137 マーケットプレイス checklist 一括追加', () => {
	test.setTimeout(180_000); // Vite dev コールドコンパイル耐性

	// ============================================================
	// 1. 詳細ページ CTA — checklist-import-cta (#2774 testid 規約統一)
	// ============================================================
	test('marketplace/checklist/event-pool 詳細ページに「一括追加」CTA が表示される', async ({
		page,
	}) => {
		test.slow();
		const res = await page.goto('/marketplace/checklist/event-pool', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		// AUTH_MODE=local ではログイン済 → 取込 CTA が表示される
		const cta = page.getByTestId('marketplace-detail-cta');
		await expect(cta).toBeVisible();

		// #2774: testid 規約 `<typeCode>-import-cta` 統一 (旧 `checklist-import-submit` 撤去)。
		// 「取込」CTA (childId 露出ゼロ) または signup redirect link のいずれか
		const importCta = page.getByTestId('checklist-import-cta');
		const signupLink = page.getByTestId('marketplace-signup-redirect');
		const eitherVisible = (await importCta.count()) > 0 || (await signupLink.count()) > 0;
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
	// 2. /admin/checklists に marketplace browse link visible + in-page browse UI 不出
	//    (二重 UI 不出 trip wire / #2558 段階3 / DESIGN.md §10)
	// ============================================================
	test('/admin/checklists に marketplace browse link visible + in-page browse UI 不出 (二重 UI 不出 trip wire)', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });

		// marketplace section (browse link container)
		const section = page.getByTestId('marketplace-import-section');
		await expect(section).toBeVisible({ timeout: 30_000 });

		// marketplace browse link (`/marketplace?type=checklist` 遷移)
		const browseLink = page.getByTestId('checklists-marketplace-browse-link');
		await expect(browseLink).toBeVisible();

		// 旧 in-page browse UI (UnifiedImportHub の per-preset button) は撤去済 (二重 UI 不出 trip wire)。
		// `marketplace-preset-import-*` testid は admin 画面側には存在しないこと。
		await expect(page.getByTestId('marketplace-preset-import-event-pool')).toHaveCount(0);
	});

	// ============================================================
	// 3. marketplace → admin/checklists CUJ goal 完遂 (新 flow #2774)
	// ============================================================
	test('marketplace → admin/checklists 取込貫通 → 成功 action message visible (goal 完遂)', async ({
		page,
	}) => {
		// #2774 5 type 統一 / #2362 PR-5 Phase 2 / #2558 段階3:
		//   旧 in-page UnifiedImportHub (admin/checklists 内 browse UI) は撤去済。
		//   新 flow: marketplace 詳細 → <a> click → admin/checklists?import=<itemId> →
		//   ChildSelectionDialog auto-open → 全員選択 → 確定 → success action message。
		test.slow();

		// 1) marketplace 詳細
		await page.goto('/marketplace/checklist/event-pool', { waitUntil: 'domcontentloaded' });
		const cta = page.getByTestId('checklist-import-cta');
		await expect(cta).toBeVisible({ timeout: 30_000 });

		// 2) <a> click → /admin/checklists?import=event-pool へ navigate
		await cta.click();
		await page.waitForURL(/\/admin\/checklists\?import=event-pool/, { timeout: 15_000 });

		// 3) ChildSelectionDialog auto-open
		const dialog = page.getByTestId('checklist-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });

		// 4) 全員選択 + 確定
		await page.getByTestId('child-selection-all').click();
		await page.getByTestId('child-selection-confirm').click();

		// 5) 成功 action message visible (goal 完遂、dead-end ならここで fail)
		await expect(page.getByTestId('checklists-action-message')).toBeVisible({ timeout: 15_000 });
	});

	// ============================================================
	// 4. 同 preset 重複取込 → success action message visible (alreadyImported handling)
	// ============================================================
	test('admin/checklists で同 preset を再度取込 → 重複扱い (alreadyImported)', async ({ page }) => {
		// #2774 / #2362 PR-5 Phase 2: ChildSelectionDialog 経由で 2 回目取込は alreadyImported
		// が含まれる成功 message が表示される (importToastDuplicate)。
		test.slow();

		// 1 回目: marketplace 詳細 → admin/checklists?import= → dialog auto-open → 確定
		await page.goto('/marketplace/checklist/event-school-start', { waitUntil: 'domcontentloaded' });
		const cta1 = page.getByTestId('checklist-import-cta');
		await expect(cta1).toBeVisible({ timeout: 30_000 });
		await cta1.click();
		await page.waitForURL(/\/admin\/checklists\?import=event-school-start/, { timeout: 15_000 });
		await expect(page.getByTestId('checklist-import-child-selection-dialog')).toBeVisible({
			timeout: 10_000,
		});
		await page.getByTestId('child-selection-all').click();
		await page.getByTestId('child-selection-confirm').click();
		await expect(page.getByTestId('checklists-action-message')).toBeVisible({ timeout: 15_000 });

		// 2 回目: 同 preset を再度取込
		await page.goto('/marketplace/checklist/event-school-start', { waitUntil: 'domcontentloaded' });
		const cta2 = page.getByTestId('checklist-import-cta');
		await expect(cta2).toBeVisible({ timeout: 30_000 });
		await cta2.click();
		await page.waitForURL(/\/admin\/checklists\?import=event-school-start/, { timeout: 15_000 });
		await expect(page.getByTestId('checklist-import-child-selection-dialog')).toBeVisible({
			timeout: 10_000,
		});
		await page.getByTestId('child-selection-all').click();
		await page.getByTestId('child-selection-confirm').click();
		// alreadyImported でも success action message は visible (importToastDuplicate)
		await expect(page.getByTestId('checklists-action-message')).toBeVisible({ timeout: 15_000 });
	});
});
