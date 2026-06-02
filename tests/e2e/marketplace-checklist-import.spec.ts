// tests/e2e/marketplace-checklist-import.spec.ts
// #2137 (MP-2): event-checklist 一括追加フロー E2E
// #2362 PR-5 Phase 2 (ADR-0055 / CWE-598): marketplace 詳細ページから childId 排除、
//   admin/checklists?import= 経由の auto-open dialog 動線に rewrite。
// #2558 段階3 (PR #2773): admin/checklists 内 in-page UnifiedImportHub browse UI を撤去
//   (DESIGN.md §10「marketplace 取込はマーケットプレイス画面に一本化」)。
//   旧 `marketplace-preset-import-<itemId>` button 期待を撤去し、新 flow に rewrite:
//   marketplace 詳細 CTA → admin/checklists?import= → ChildSelectionDialog auto-open →
//   confirm → `?/importPresetToChildren` action → action message 表示。
//
// 検証対象 (新 flow):
// 1. /marketplace/checklist/event-pool 詳細ページに「取込」CTA が描画される
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

		// AUTH_MODE=local ではログイン済 → 取込 button が表示される
		// (未ログイン環境では login redirect になるため、別 spec で扱う)
		const cta = page.getByTestId('marketplace-detail-cta');
		await expect(cta).toBeVisible();

		// #2362 PR-5 Phase 2: 「取込」 button (childId 排除済) または signup redirect link のいずれか
		const importBtn = page.getByTestId('checklist-import-submit');
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
	// 2. admin/checklists の marketplace 取込 section (#2558 段階3 / PR #2773)
	//
	// PR #2773 で admin/checklists 内 in-page UnifiedImportHub browse UI を撤去
	// (DESIGN.md §10「marketplace 取込はマーケットプレイス画面に一本化」)。
	// 旧期待 (`marketplace-preset-import-<itemId>` button 3 件 visible) は永続的に廃止。
	// 新期待: `checklists-marketplace-browse-link` 経由で /marketplace?type=checklist へ画面遷移
	// する secondary link が visible (empty state / 運用期到達性、DESIGN.md §10 bridge ルール)。
	// in-page browse UI が再導入されないことを併せて担保 (二重 UI 不出 trip wire)。
	// ============================================================
	test('/admin/checklists に marketplace browse link visible + in-page browse UI 不出 (二重 UI 不出 trip wire)', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });

		// marketplace 取込 section (action message + browse link container) は visible
		const section = page.getByTestId('marketplace-import-section');
		await expect(section).toBeVisible({ timeout: 30_000 });

		// 新 secondary link → /marketplace?type=checklist
		const browseLink = page.getByTestId('checklists-marketplace-browse-link');
		await expect(browseLink, 'marketplace browse link が visible (運用期到達性)').toBeVisible({
			timeout: 10_000,
		});
		await expect(browseLink).toHaveAttribute('href', '/marketplace?type=checklist');

		// 旧 in-page browse UI (UnifiedImportHub preset 一覧 button) は撤去済 (DESIGN.md §10 禁忌)
		await expect(page.getByTestId('marketplace-preset-import-event-pool')).toHaveCount(0);
		await expect(page.getByTestId('marketplace-preset-import-event-school-start')).toHaveCount(0);
		await expect(page.getByTestId('marketplace-preset-import-event-field-trip')).toHaveCount(0);
	});

	// ============================================================
	// 3-4. marketplace 詳細 → CTA click → admin/checklists?import= redirect →
	//      ChildSelectionDialog auto-open → 全員選択 → 確定 → action message visible
	//      (goal 完遂貫通検証、dead-end なら必ず fail)
	// ============================================================
	test('marketplace → admin/checklists 取込貫通 → 成功 action message visible (goal 完遂)', async ({
		page,
	}) => {
		test.slow();
		// Step 1: marketplace 詳細から CTA click → admin/checklists?import=event-pool redirect
		await page.goto('/marketplace/checklist/event-pool', { waitUntil: 'domcontentloaded' });
		const cta = page.getByTestId('checklist-import-submit');
		await expect(cta).toBeVisible({ timeout: 30_000 });

		await Promise.all([
			page.waitForURL(/\/admin\/checklists\?import=event-pool/, { timeout: 30_000 }),
			cta.click(),
		]);

		// Step 2: ChildSelectionDialog auto-open
		const dialog = page.getByTestId('checklist-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 30_000 });

		// Step 3: default = 全員選択 → confirm → importPresetToChildren network 発火
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();

		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(
			resp.ok(),
			`importPresetToChildren response not OK (status ${resp.status()})`,
		).toBeTruthy();

		// Step 4: 成功 / 重複 action message が visible (永続反映、dead-end なら fail)
		const actionMessage = page.getByTestId('checklists-action-message');
		await expect(actionMessage).toBeVisible({ timeout: 30_000 });
		await expect(actionMessage).toContainText(/取込み|取込済|配信/);
	});

	test('admin/checklists で同 preset を再度取込 → 重複扱い (alreadyImported)', async ({ page }) => {
		test.slow();
		// Step 1: 1 回目取込 (event-school-start 経由)
		await page.goto('/marketplace/checklist/event-school-start', { waitUntil: 'domcontentloaded' });
		const cta1 = page.getByTestId('checklist-import-submit');
		await expect(cta1).toBeVisible({ timeout: 30_000 });
		await Promise.all([
			page.waitForURL(/\/admin\/checklists\?import=event-school-start/, { timeout: 30_000 }),
			cta1.click(),
		]);

		const dialog1 = page.getByTestId('checklist-import-child-selection-dialog');
		await expect(dialog1).toBeVisible({ timeout: 30_000 });
		const confirm1 = page.getByTestId('child-selection-confirm');
		await expect(confirm1).toBeEnabled();
		const [resp1] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm1.click(),
		]);
		expect(resp1.ok()).toBeTruthy();

		const msg1 = page.getByTestId('checklists-action-message');
		await expect(msg1).toBeVisible({ timeout: 30_000 });

		// Step 2: 2 回目取込 (重複) → action message に「取込済」相当が表示される
		await page.goto('/marketplace/checklist/event-school-start', { waitUntil: 'domcontentloaded' });
		const cta2 = page.getByTestId('checklist-import-submit');
		await expect(cta2).toBeVisible({ timeout: 30_000 });
		await Promise.all([
			page.waitForURL(/\/admin\/checklists\?import=event-school-start/, { timeout: 30_000 }),
			cta2.click(),
		]);

		const dialog2 = page.getByTestId('checklist-import-child-selection-dialog');
		await expect(dialog2).toBeVisible({ timeout: 30_000 });
		const confirm2 = page.getByTestId('child-selection-confirm');
		await expect(confirm2).toBeEnabled();
		const [resp2] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm2.click(),
		]);
		expect(resp2.ok()).toBeTruthy();

		// 重複扱い (`importToastDuplicate` / 「取込済」表記、imported === 0) も成功 path として 200
		// 返るため、action message の verify で「取込済」 or 「取込み...配信」のいずれかを assert。
		const msg2 = page.getByTestId('checklists-action-message');
		await expect(msg2).toBeVisible({ timeout: 30_000 });
		await expect(msg2).toContainText(/取込み|取込済|配信/);
	});
});
